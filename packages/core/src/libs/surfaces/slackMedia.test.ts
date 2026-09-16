import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isPubliclyFetchable, postSlackReply, resetSlackScopeCache, slackBlocks, uploadSlackImages } from './slack';

/**
 * The media ladder, against a mocked Slack API. Verified on the live app
 * 2026-09-15: a Block Kit `image` block renders inline with only `chat:write`,
 * while a plain link to an image does NOT unfurl in a private channel even
 * with `unfurl_media: true`. So links are not a rung, and the tests say so.
 */

const BASE = 'https://slack.test/api';
const PUBLIC_IMAGE = 'https://cdn.example.test/shots/inbox.png';
const PRIVATE_IMAGE = 'https://app.example.test/api/artifacts/abc/inbox.png';

type Call = { url: string; body: unknown };

/**
 * A Slack stand-in that records every call.
 * @param answers - Method name → response body; anything unlisted answers ok.
 */
function slackMock(answers: Record<string, Record<string, unknown>> = {}) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = u.split('/').pop() ?? '';
    const raw = init?.body;
    calls.push({ url: u, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
    if (!u.startsWith(BASE)) {
      return new Response('', { status: 200 }); // the upload PUT target
    }
    return new Response(JSON.stringify(answers[method] ?? { ok: true, ts: '900.1', channel: 'C1' }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

beforeEach(() => {
  resetSlackScopeCache();
  vi.restoreAllMocks();
});

describe('slackBlocks', () => {
  it('puts the caption in alt_text and in a section above the image, never in `title`', () => {
    const blocks = slackBlocks('Release 2.80.1 is out.', [{ url: PUBLIC_IMAGE, caption: 'the inbox, now one list' }]);

    expect(blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'Release 2.80.1 is out.' } },
      { type: 'section', text: { type: 'mrkdwn', text: 'the inbox, now one list' } },
      { type: 'image', image_url: PUBLIC_IMAGE, alt_text: 'the inbox, now one list' },
    ]);
    // Slack warns `ignored_extra_attributes_for_image_block` and drops it.
    expect(JSON.stringify(blocks)).not.toContain('"title"');
  });
});

describe('isPubliclyFetchable', () => {
  it('knows Slack cannot fetch an image behind Vocion sign-in', () => {
    expect(isPubliclyFetchable(PUBLIC_IMAGE)).toBe(true);
    expect(isPubliclyFetchable(PRIVATE_IMAGE)).toBe(false);
    expect(isPubliclyFetchable('http://insecure.example.test/a.png')).toBe(false);
  });
});

describe('postSlackReply media ladder', () => {
  it('rung 1: uploads the bytes when `files:write` is granted', async () => {
    const { calls, impl } = slackMock({
      'files.getUploadURLExternal': { ok: true, upload_url: 'https://files.slack.test/upload/1', file_id: 'F1' },
      'files.completeUploadExternal': { ok: true },
    });

    const ref = await postSlackReply(
      { channelId: 'C1', threadRef: '100.1' },
      { text: 'here you go', images: [{ url: PRIVATE_IMAGE, caption: 'the inbox' }] },
      'xoxb-test',
      BASE,
      { scopes: new Set(['chat:write', 'files:write']), fetchImage: async () => new Uint8Array(Buffer.from('png')), fetchImpl: impl },
    );

    expect(ref?.media).toBe('uploaded');
    expect(calls.map(c => c.url)).toEqual([
      `${BASE}/files.getUploadURLExternal`,
      'https://files.slack.test/upload/1',
      `${BASE}/files.completeUploadExternal`,
    ]);
    // The file lands in the thread, under the message text.
    expect(calls[2]!.body).toMatchObject({ channel_id: 'C1', thread_ts: '100.1', initial_comment: 'here you go', files: [{ id: 'F1', title: 'the inbox' }] });
    // An image behind our own auth still reaches the channel: we send bytes.
    expect(calls.some(c => c.url === `${BASE}/chat.postMessage`)).toBe(false);
  });

  it('rung 2: renders an image block from a public URL when `files:write` is absent', async () => {
    const { calls, impl } = slackMock();

    const ref = await postSlackReply(
      { channelId: 'C1', threadRef: '100.1' },
      { text: 'here you go', images: [{ url: PUBLIC_IMAGE, caption: 'the inbox' }] },
      'xoxb-test',
      BASE,
      { scopes: new Set(['chat:write']), fetchImpl: impl },
    );

    expect(ref?.media).toBe('blocks');

    const body = calls[0]!.body as Record<string, unknown>;

    expect(calls[0]!.url).toBe(`${BASE}/chat.postMessage`);
    expect(body.blocks).toEqual(slackBlocks('here you go', [{ url: PUBLIC_IMAGE, caption: 'the inbox' }]));
    // Never a bare link, and never `unfurl_media` — neither shows the picture.
    expect(body.unfurl_media).toBeUndefined();
    expect(String(body.text)).toBe('here you go');
  });

  it('never falls back to a bare link: an unreachable image is named as needing a sign-in', async () => {
    const { calls, impl } = slackMock();

    const ref = await postSlackReply(
      { channelId: 'C1' },
      { text: 'here you go', images: [{ url: PRIVATE_IMAGE, caption: 'the inbox' }] },
      'xoxb-test',
      BASE,
      { scopes: new Set(['chat:write']), fetchImpl: impl },
    );

    expect(ref?.media).toBe('unreachable');

    const body = calls[0]!.body as Record<string, unknown>;

    // No image block pointing at a URL Slack cannot fetch — that renders grey.
    expect(body.blocks).toBeUndefined();
    // And the text says why, rather than pasting a link that looks like a picture.
    expect(String(body.text)).toContain('sign-in required');
    expect(String(body.text)).toContain('Slack cannot show it inline');
  });

  it('downgrades to a block rather than failing when the upload does', async () => {
    const { calls, impl } = slackMock({ 'files.getUploadURLExternal': { ok: false, error: 'invalid_auth' } });

    const ref = await postSlackReply(
      { channelId: 'C1' },
      { text: 'here you go', images: [{ url: PUBLIC_IMAGE, caption: 'the inbox' }] },
      'xoxb-test',
      BASE,
      { scopes: new Set(['chat:write', 'files:write']), fetchImage: async () => new Uint8Array(Buffer.from('png')), fetchImpl: impl },
    );

    expect(ref?.media).toBe('blocks');
    expect(calls.at(-1)!.url).toBe(`${BASE}/chat.postMessage`);
  });

  it('is byte-identical to the pre-images payload when a message carries none', async () => {
    const { calls, impl } = slackMock();

    const ref = await postSlackReply({ channelId: 'C1', threadRef: '100.1' }, 'plain reply', 'xoxb-test', BASE, { scopes: new Set(['chat:write']), fetchImpl: impl });

    expect(ref?.media).toBe('none');
    expect(calls[0]!.body).toEqual({ channel: 'C1', thread_ts: '100.1', text: 'plain reply' });
  });
});

describe('uploadSlackImages', () => {
  it('reports the API error rather than throwing, so the caller can downgrade', async () => {
    const { impl } = slackMock({ 'files.getUploadURLExternal': { ok: false, error: 'missing_scope' } });

    const result = await uploadSlackImages(
      { channelId: 'C1', files: [{ filename: 'a.png', title: 'a', bytes: new Uint8Array([1]) }] },
      'xoxb-test',
      BASE,
      impl,
    );

    expect(result).toEqual({ ok: false, error: 'missing_scope' });
  });
});
