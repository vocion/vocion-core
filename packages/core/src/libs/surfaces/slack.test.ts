import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { inboundFiles, isSlackRead, parseSlackPayload, postSlackReply, stripMentions, verifySlackSignature } from './slack';

const SECRET = 'shh';
const NOW = 1_700_000_000;

function sign(body: string, ts: number = NOW, secret = SECRET): Headers {
  const sig = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;
  return new Headers({ 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sig });
}

/**
 * A Slack call's arguments, sent as JSON (structured) or as a form (plain values).
 * @param init - The request.
 */
function bodyOf(init: RequestInit): Record<string, unknown> {
  const raw = String(init.body);
  return raw.startsWith('{') ? JSON.parse(raw) as Record<string, unknown> : Object.fromEntries(new URLSearchParams(raw));
}

describe('isSlackRead', () => {
  it('sends reads as a form, which is all Slack accepts there, and writes as JSON', () => {
    expect(isSlackRead('conversations.replies')).toBe(true);
    expect(isSlackRead('users.info')).toBe(true);
    expect(isSlackRead('chat.postMessage')).toBe(false);
    expect(isSlackRead('chat.delete')).toBe(false);
    // Not a read, but form-only all the same: a JSON body is "missing required field: filename".
    expect(isSlackRead('files.getUploadURLExternal')).toBe(true);
    expect(isSlackRead('files.completeUploadExternal')).toBe(false);
  });
});

describe('verifySlackSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    const body = '{"type":"url_verification","challenge":"abc"}';

    expect(verifySlackSignature(body, sign(body), SECRET, NOW)).toEqual({ ok: true });
  });

  it('rejects a body that was tampered with after signing', () => {
    const body = '{"a":1}';

    expect(verifySlackSignature('{"a":2}', sign(body), SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects the wrong secret, a stale timestamp, missing headers, and an unconfigured secret', () => {
    const body = '{}';

    expect(verifySlackSignature(body, sign(body, NOW, 'other'), SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifySlackSignature(body, sign(body, NOW - 600), SECRET, NOW)).toEqual({ ok: false, reason: 'stale' });
    expect(verifySlackSignature(body, new Headers(), SECRET, NOW)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifySlackSignature(body, sign(body), undefined, NOW)).toEqual({ ok: false, reason: 'missing_secret' });
  });
});

describe('parseSlackPayload', () => {
  it('answers the URL verification handshake', () => {
    expect(parseSlackPayload({ type: 'url_verification', challenge: 'xyz' })).toEqual({ kind: 'challenge', challenge: 'xyz' });
  });

  it('turns an app_mention into an inbound message with the mention stripped and the thread as the key', () => {
    const parsed = parseSlackPayload({
      type: 'event_callback',
      team_id: 'T1',
      event: { type: 'app_mention', user: 'U9', channel: 'C7', ts: '1.002', thread_ts: '1.001', text: '<@UBOT> how is the quarter?' },
    });

    expect(parsed).toEqual({
      kind: 'message',
      inbound: { surface: 'slack', teamId: 'T1', channelId: 'C7', threadRef: '1.001', messageRef: '1.002', externalUserId: 'U9', text: 'how is the quarter?', isDirect: false },
    });
  });

  it('carries the pictures on a mention, images only, and keeps a mention that is only a picture (backlog 057)', () => {
    const files = [
      { id: 'F1', name: 'bug.png', title: 'The broken header', mimetype: 'image/png', size: 4321, url_private: 'https://files.slack.example/f1', url_private_download: 'https://files.slack.example/f1/download' },
      { id: 'F2', name: 'notes.pdf', mimetype: 'application/pdf', size: 99, url_private: 'https://files.slack.example/f2' },
    ];
    const parsed = parseSlackPayload({ type: 'event_callback', team_id: 'T1', event: { type: 'app_mention', user: 'U9', channel: 'C7', ts: '1.002', text: '<@UBOT> the header overflows on my phone', files } });

    expect(parsed.kind === 'message' && parsed.inbound.files).toEqual([{ id: 'F1', name: 'The broken header', contentType: 'image/png', bytes: 4321, url: 'https://files.slack.example/f1/download' }]);

    const pictureOnly = parseSlackPayload({ type: 'event_callback', team_id: 'T1', event: { type: 'app_mention', user: 'U9', channel: 'C7', ts: '1.003', text: '<@UBOT>', files: [files[0]] } });

    expect(pictureOnly.kind === 'message' && pictureOnly.inbound.text).toBe('See the attached picture.');
    expect(inboundFiles(undefined)).toEqual([]);
  });

  it('keeps a bare mention inside a thread: the ask is the thread above it, picture and all (Chris, 2026-10-05)', () => {
    const bare = parseSlackPayload({ type: 'event_callback', team_id: 'T1', event: { type: 'app_mention', user: 'U9', channel: 'C7', ts: '1.005', thread_ts: '1.001', text: '<@UBOT>' } });

    expect(bare).toEqual({ kind: 'message', inbound: { surface: 'slack', teamId: 'T1', channelId: 'C7', threadRef: '1.001', messageRef: '1.005', externalUserId: 'U9', text: 'See this thread.', isDirect: false } });
  });

  it('treats a DM as inbound, and ignores bots, edits, other event types and empty text', () => {
    const dm = parseSlackPayload({ type: 'event_callback', team_id: 'T1', event: { type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', ts: '5', text: 'hi' } });

    expect(dm.kind).toBe('message');
    expect(dm.kind === 'message' && dm.inbound.isDirect).toBe(true);
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'message', channel_type: 'im', bot_id: 'B1', user: 'U1', channel: 'D1', ts: '6', text: 'x' } }).kind).toBe('ignore');
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'message', subtype: 'message_changed', user: 'U1', channel: 'C1', ts: '7', text: 'x' } }).kind).toBe('ignore');
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'reaction_added', user: 'U1', channel: 'C1', ts: '8' } }).kind).toBe('ignore');
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'app_mention', user: 'U1', channel: 'C1', ts: '9', text: '<@UBOT>' } }).kind).toBe('ignore');
  });

  it('takes a reply in a channel thread with no mention as a follow-up, and leaves a mention to app_mention (Chris, 2026-10-06: "Do that")', () => {
    const reply = { type: 'event_callback', team_id: 'T1', authorizations: [{ user_id: 'UBOT', is_bot: true }], event: { type: 'message', channel_type: 'group', user: 'U1', channel: 'G1', ts: '20.2', thread_ts: '20.1', text: 'Do that' } };
    const parsed = parseSlackPayload(reply);

    expect(parsed.kind === 'message' && parsed.inbound).toMatchObject({ channelId: 'G1', threadRef: '20.1', messageRef: '20.2', text: 'Do that', followUp: true, isDirect: false });
    // The same reply naming the bot comes again as app_mention; answering both would answer twice.
    expect(parseSlackPayload({ ...reply, event: { ...reply.event, text: '<@UBOT> do that' } })).toMatchObject({ kind: 'ignore', reason: expect.stringMatching(/app_mention/) });
    // A top-level channel message is not a follow-up of anything.
    expect(parseSlackPayload({ ...reply, event: { ...reply.event, thread_ts: undefined } }).kind).toBe('ignore');
    // Without knowing which user is ours, a mention cannot be told apart, so nothing is claimed.
    expect(parseSlackPayload({ ...reply, authorizations: undefined }).kind).toBe('ignore');

    // An app_mention is never marked a follow-up.
    const mention = parseSlackPayload({ ...reply, event: { ...reply.event, type: 'app_mention', text: '<@UBOT> do that' } });

    expect(mention.kind === 'message' && mention.inbound.followUp).toBeUndefined();
  });

  it('reads a person pressing stop on an agent session as a stop for that thread', () => {
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'agent_session_stopped', channel: 'C7', thread_ts: '20.1', user: 'U1', event_ts: '21.0', streaming_message_ts: [] } }))
      .toEqual({ kind: 'stop', stop: { surface: 'slack', channelId: 'C7', threadRef: '20.1', externalUserId: 'U1' } });
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'agent_session_stopped', channel: 'C7' } }).kind).toBe('ignore');
  });

  it('parses the bot being added to a channel as a join, and ignores anyone else joining', () => {
    const join = { type: 'event_callback', team_id: 'T1', authorizations: [{ user_id: 'UBOT', is_bot: true }], event: { type: 'member_joined_channel', user: 'UBOT', channel: 'C9', channel_type: 'C', inviter: 'U1', event_ts: '10.1' } };
    const parsed = parseSlackPayload(join);

    expect(parsed).toEqual({ kind: 'joined', join: { surface: 'slack', teamId: 'T1', channelId: 'C9', botUserId: 'UBOT' } });

    // A human joining the same channel is not our event.
    expect(parseSlackPayload({ ...join, event: { ...join.event, user: 'U1' } }).kind).toBe('ignore');
    // No authorizations block: the configured bot user id decides.
    expect(parseSlackPayload({ ...join, authorizations: undefined }, 'UBOT').kind).toBe('joined');
    expect(parseSlackPayload({ ...join, authorizations: undefined }, 'UOTHER').kind).toBe('ignore');
    // Nothing says which id is ours, so nothing is claimed.
    expect(parseSlackPayload({ ...join, authorizations: undefined }).kind).toBe('ignore');
  });
});

describe('postSlackReply', () => {
  /**
   * Capture the one chat.postMessage body the call sends.
   * @param target
   */
  async function post(target: Parameters<typeof postSlackReply>[0]): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await postSlackReply(target, 'hello', 'xoxb-test', 'https://slack.test/api');
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://slack.test/api/chat.postMessage');

    return bodyOf(init);
  }

  it('puts a link under the words as a button, and keeps the URL in the fallback text (2026-10-26)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await postSlackReply({ channelId: 'C1', threadRef: '100.1' }, { text: 'Not connected yet.', link: { label: 'Connect this channel', url: 'https://app.example.test/dashboard/connect-channel?surface=slack&channel=C1' } }, 'xoxb-test', 'https://slack.test/api');
    } finally {
      vi.unstubAllGlobals();
    }
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = bodyOf(init);

    expect(body.text).toBe('Not connected yet.\nhttps://app.example.test/dashboard/connect-channel?surface=slack&channel=C1');
    expect(body.blocks).toEqual([
      { type: 'markdown', text: 'Not connected yet.' },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Connect this channel' }, url: 'https://app.example.test/dashboard/connect-channel?surface=slack&channel=C1', action_id: 'vocion_open_link' }] },
    ]);
  });

  it('posts as the persona when the target carries one', async () => {
    const body = await post({ channelId: 'C1', threadRef: '100.1', displayName: 'Sterling Banks', iconUrl: 'https://www.vocion.ai/personas/sterling.png' });

    expect(body).toEqual({
      channel: 'C1',
      thread_ts: '100.1',
      text: 'hello',
      unfurl_links: true,
      blocks: [{ type: 'markdown', text: 'hello' }],
      username: 'Sterling Banks',
      icon_url: 'https://www.vocion.ai/personas/sterling.png',
    });
  });

  it('sends the pre-persona payload unchanged when the target has none', async () => {
    const body = await post({ channelId: 'C1', threadRef: '100.1' });

    // No `username`/`icon_url` keys at all — an empty username posts blank in Slack.
    expect(body).toEqual({ channel: 'C1', thread_ts: '100.1', text: 'hello', unfurl_links: true, blocks: [{ type: 'markdown', text: 'hello' }] });
  });

  it('posts to the channel with no thread_ts when the target has no thread', async () => {
    expect(await post({ channelId: 'C1' })).toEqual({ channel: 'C1', text: 'hello', unfurl_links: true, blocks: [{ type: 'markdown', text: 'hello' }] });
  });

  it('carries whichever half of the persona is set', async () => {
    expect(await post({ channelId: 'C1', threadRef: '1', displayName: 'Keel Marsden' })).toEqual({ channel: 'C1', thread_ts: '1', text: 'hello', unfurl_links: true, blocks: [{ type: 'markdown', text: 'hello' }], username: 'Keel Marsden' });
    expect(await post({ channelId: 'C1', threadRef: '1', iconUrl: 'https://www.vocion.ai/personas/keel.png' })).toEqual({ channel: 'C1', thread_ts: '1', text: 'hello', unfurl_links: true, blocks: [{ type: 'markdown', text: 'hello' }], icon_url: 'https://www.vocion.ai/personas/keel.png' });
  });
});

describe('stripMentions', () => {
  it('removes user mentions with and without labels', () => {
    expect(stripMentions('<@U1|bot> ping <@U2>  now')).toBe('ping now');
  });
});

// Chris, 2026-11-10, reading a thread on his phone: "Too long to read and answer. Links? ... I
// don't need instructions on how to use chat in every message."
describe('how an answer reads in Slack', () => {
  it('turns markdown into what Slack shows: a labelled link, one-asterisk bold, no heading marks', async () => {
    const { slackMrkdwn } = await import('./slack');

    expect(slackMrkdwn('[SL-16](https://factory.example/#/t/acme/k/SL-16) needs **Chris**.')).toBe('<https://factory.example/#/t/acme/k/SL-16|SL-16> needs *Chris*.');
    expect(slackMrkdwn('## What shipped\nSee <https://a.example|this> and https://b.example/x')).toBe('*What shipped*\nSee <https://a.example|this> and https://b.example/x');
    expect(slackMrkdwn('[a|b](https://c.example)')).toBe('<https://c.example|a b>');
    expect(slackMrkdwn('no links [here] (or here)')).toBe('no links [here] (or here)');
  });

  it('posts markdown as written in a markdown block, asks for link previews, and converts only beside a picture', async () => {
    const { postSlackReply, slackSurface } = await import('./slack');
    const sent: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));

      return new Response(JSON.stringify({ ok: true, ts: '1.2', channel: 'C1' }));
    }) as unknown as typeof fetch;
    const words = 'Filed **[SL-16](https://factory.example/t/SL-16)**.';
    await postSlackReply({ channelId: 'C1', threadRef: '1.1' }, words, 'xoxb-test', undefined, { fetchImpl });

    // Slack's markdown block renders standard markdown: bold stays bold and the link keeps its label.
    expect(sent[0]?.blocks).toEqual([{ type: 'markdown', text: words }]);
    // The page behind a link is previewed: an app's own posts do not unfurl text links unless they ask.
    expect(sent[0]).toMatchObject({ unfurl_links: true });

    await postSlackReply({ channelId: 'C1' }, { text: words, images: [{ url: 'https://factory.example/shot.png', caption: 'After' }] }, 'xoxb-test', undefined, { fetchImpl, scopes: new Set() });

    expect((sent.at(-1)?.blocks as Array<{ text?: { text?: string } }>)[0]?.text?.text).toBe('Filed *<https://factory.example/t/SL-16|SL-16>*.');
    expect(slackSurface.answerStyle).toMatch(/at most five short lines/);
    expect(slackSurface.answerStyle).toMatch(/Never explain how to reply/);
    expect(slackSurface.answerStyle).toMatch(/markdown link with a short label/);
  });
});

// Chris, 2026-11-10: "I want to see the og preview unfurl in slack for the brief." Slack previews no
// link in an app's own post, so the page is drawn as a card of ours.
describe('the page a message is about, as a card', () => {
  it('is a section with the linked title, the opening lines and the picture as a small accessory', async () => {
    const { postSlackReply, slackPreviewBlock } = await import('./slack');
    const preview = { title: 'SL-16 · Brief ready for approval: Mic audio', url: 'https://factory.example/r/ticket/ts_x', description: 'Jamie recorded on the phone app and the recording has no voice.', imageUrl: 'https://cdn.example/poster.jpg' };

    expect(slackPreviewBlock(preview)).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '*<https://factory.example/r/ticket/ts_x|SL-16 · Brief ready for approval: Mic audio>*\nJamie recorded on the phone app and the recording has no voice.' },
      accessory: { type: 'image', image_url: 'https://cdn.example/poster.jpg', alt_text: 'SL-16 · Brief ready for approval: Mic audio' },
    });
    // A picture Slack cannot fetch is left off; the card still stands.
    expect(slackPreviewBlock({ ...preview, imageUrl: '/api/artifacts/9' })).not.toHaveProperty('accessory');

    const sent: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));

      return new Response(JSON.stringify({ ok: true, ts: '1.2', channel: 'C1' }));
    }) as unknown as typeof fetch;
    await postSlackReply({ channelId: 'C1', threadRef: '1.1' }, { text: '🟠 **[SL-16](https://factory.example/t/SL-16)** Brief ready for approval', preview }, 'xoxb-test', undefined, { fetchImpl });
    const blocks = sent[0]?.blocks as Array<{ type: string }>;

    expect(blocks.map(b => b.type)).toEqual(['markdown', 'section']);
    expect(sent[0]?.text).toContain('SL-16 · Brief ready for approval: Mic audio: https://factory.example/r/ticket/ts_x');
  });
});
