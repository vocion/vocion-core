/**
 * Slack as the chat family's first provider: permalinks read back into ids,
 * a thread read with its authors and files, a missing scope named rather than
 * swallowed, a file downloaded with the token. Slack is a fake `fetch`; every
 * id is invented.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { parseSlackPermalink, slackChatProvider } from './slack';

const BASE = 'https://slack.test/api';

type Answer = Record<string, unknown> | ((body: Record<string, unknown>) => Record<string, unknown>);

/**
 * A Slack that answers each method from a table; a file URL answers bytes.
 * @param answers - Method → JSON answer.
 * @param files - File URL → bytes.
 */
function fakeSlack(answers: Record<string, Answer>, files: Record<string, { bytes: string; type: string }> = {}) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(BASE)) {
      const method = url.slice(BASE.length + 1);
      const raw = String(init?.body ?? '{}');
      // Reads go to Slack as a form (it refuses JSON there); writes as JSON.
      const body = (raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))) as Record<string, unknown>;
      calls.push({ method, body });
      const answer = answers[method];
      const json = typeof answer === 'function' ? answer(body) : (answer ?? { ok: false, error: 'unknown_method' });
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const file = files[url];
    return file ? new Response(Buffer.from(file.bytes), { status: 200, headers: { 'content-type': file.type } }) : new Response('', { status: 404 });
  };
  return { fetchImpl, calls };
}

describe('parseSlackPermalink', () => {
  it('reads channel, message id and thread out of a permalink', () => {
    expect(parseSlackPermalink('https://northwind.slack.com/archives/C0DELIVERY/p1727700000000100')).toEqual({ channelId: 'C0DELIVERY', ts: '1727700000.000100' });
    expect(parseSlackPermalink('https://northwind.slack.com/archives/C0DELIVERY/p1727700100000200?thread_ts=1727700000.000100&cid=C0DELIVERY'))
      .toEqual({ channelId: 'C0DELIVERY', ts: '1727700100.000200', threadTs: '1727700000.000100' });
  });

  it('is null for anything that is not a message link', () => {
    expect(parseSlackPermalink('https://northwind.slack.com/archives/C0DELIVERY')).toBeNull();
    expect(parseSlackPermalink('https://github.com/Acme/northwind-core/pull/7')).toBeNull();
    expect(parseSlackPermalink('not a url')).toBeNull();
  });
});

describe('slackChatProvider', () => {
  it('reads a thread oldest first with authors named and files listed', async () => {
    const slack = fakeSlack({
      'conversations.replies': { ok: true, messages: [
        { ts: '1727700000.000100', text: 'Export is broken', user: 'U0ASKER', files: [{ id: 'F0SHOT', name: 'export.png', mimetype: 'image/png', size: 2048 }] },
        { ts: '1727700100.000200', text: 'Looking', user: 'U0PM', thread_ts: '1727700000.000100' },
      ] },
      'users.info': body => ({ ok: true, user: { id: body.user, real_name: body.user === 'U0ASKER' ? 'Dana Asker' : 'Pat Manager' } }),
      'conversations.info': { ok: true, channel: { name: 'noco-requests', is_private: false } },
    });
    const read = await slackChatProvider('xoxb-source', BASE, slack.fetchImpl).readThread({ channelId: 'C0REQ', threadTs: '1727700000.000100' });

    expect(read).toEqual({ ok: true, value: {
      channel: { id: 'C0REQ', name: 'noco-requests' },
      messages: [
        { ts: '1727700000.000100', author: { id: 'U0ASKER', name: 'Dana Asker' }, text: 'Export is broken', files: [{ id: 'F0SHOT', name: 'export.png', mimeType: 'image/png', size: 2048 }] },
        { ts: '1727700100.000200', author: { id: 'U0PM', name: 'Pat Manager' }, text: 'Looking', files: [] },
      ],
    } });
  });

  it('names the scope that stopped a read', async () => {
    const slack = fakeSlack({ 'conversations.replies': { ok: false, error: 'missing_scope' } });
    const read = await slackChatProvider('xoxb', BASE, slack.fetchImpl).readThread({ channelId: 'G0PRIVATE', threadTs: '1.000001' });

    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.error).toContain('groups:history');
  });

  it('falls back to the channel history for a message that started no thread', async () => {
    const slack = fakeSlack({
      'conversations.replies': { ok: false, error: 'thread_not_found' },
      'conversations.history': { ok: true, messages: [{ ts: '1727700000.000100', text: 'Just a message', user: 'U0ASKER' }] },
      'users.info': { ok: true, user: { id: 'U0ASKER', name: 'dana' } },
      'conversations.info': { ok: false, error: 'missing_scope' },
    });
    const read = await slackChatProvider('xoxb', BASE, slack.fetchImpl).readThread({ channelId: 'C0REQ', threadTs: '1727700000.000100' });

    expect(read).toMatchObject({ ok: true, value: { channel: { id: 'C0REQ', name: null }, messages: [{ text: 'Just a message', author: { name: 'dana' } }] } });
    expect(slack.calls.find(c => c.method === 'conversations.history')?.body).toMatchObject({ channel: 'C0REQ', latest: '1727700000.000100', oldest: '1727700000.000100', inclusive: 'true' });
  });

  it('downloads a file with the token', async () => {
    const slack = fakeSlack(
      { 'files.info': { ok: true, file: { id: 'F0SHOT', name: 'export.png', mimetype: 'image/png', url_private_download: 'https://files.slack.test/F0SHOT/download' } } },
      { 'https://files.slack.test/F0SHOT/download': { bytes: 'PNGBYTES', type: 'image/png' } },
    );
    const got = await slackChatProvider('xoxb-source', BASE, slack.fetchImpl).readFile('F0SHOT');

    expect(got.ok).toBe(true);

    if (got.ok) {
      expect(got.value).toMatchObject({ id: 'F0SHOT', name: 'export.png', mimeType: 'image/png', size: 8 });
      expect(got.value.bytes.toString()).toBe('PNGBYTES');
    }
  });

  it('posts a reply in the thread, deletes it, and treats a reaction already there as added', async () => {
    const slack = fakeSlack({
      'chat.postMessage': { ok: true, ts: '1727700200.000300' },
      'chat.delete': { ok: false, error: 'message_not_found' },
      'reactions.add': { ok: false, error: 'already_reacted' },
      'reactions.remove': { ok: false, error: 'no_reaction' },
    });
    const provider = slackChatProvider('xoxb', BASE, slack.fetchImpl);

    await expect(provider.postInThread({ channelId: 'C0REQ', threadTs: '1727700000.000100', text: 'Filed as request #12.' })).resolves.toEqual({ ts: '1727700200.000300' });
    expect(slack.calls[0]!.body).toMatchObject({ channel: 'C0REQ', thread_ts: '1727700000.000100', text: 'Filed as request #12.' });
    await expect(provider.deleteMessage({ channelId: 'C0REQ', ts: '1727700200.000300' })).resolves.toEqual({ ok: true });
    await expect(provider.addReaction({ channelId: 'C0REQ', ts: '1727700000.000100', name: 'eyes' })).resolves.toEqual({ ok: true, already: true });
    await expect(provider.removeReaction({ channelId: 'C0REQ', ts: '1727700000.000100', name: 'eyes' })).resolves.toEqual({ ok: true, absent: true });
  });
});

describe('chatTokenFor', () => {
  it('prefers the slack source\'s own token over the deployment\'s', async () => {
    vi.resetModules();
    vi.doMock('@/libs/connectors/families', () => ({ familySourcesForOrg: async () => [{ id: 1, slug: 'slack', kind: 'slack', config: {}, apiTokenId: 'tok_1' }] }));
    vi.doMock('@/services/SourceCredentialService', () => ({ getCredentialsForConnector: async () => ({ token: 'xoxb-client' }) }));
    vi.doMock('@/libs/notifications/slack', () => ({ slackToken: () => 'xoxb-deployment' }));
    const { chatTokenFor } = await import('../provider');

    await expect(chatTokenFor('org_noco')).resolves.toEqual({ token: 'xoxb-client', kind: 'slack', from: 'source', sourceSlug: 'slack' });
  });

  it('falls back to the deployment token when no source holds one, and to nothing when neither does', async () => {
    vi.resetModules();
    vi.doMock('@/libs/connectors/families', () => ({ familySourcesForOrg: async () => [] }));
    vi.doMock('@/services/SourceCredentialService', () => ({ getCredentialsForConnector: async () => undefined }));
    const token = { value: 'xoxb-deployment' as string | null };
    vi.doMock('@/libs/notifications/slack', () => ({ slackToken: () => token.value }));
    const { chatTokenFor, chatProviderFor } = await import('../provider');

    await expect(chatTokenFor('org_1')).resolves.toEqual({ token: 'xoxb-deployment', kind: 'slack', from: 'deployment', sourceSlug: null });

    token.value = null;

    await expect(chatTokenFor('org_1')).resolves.toBeNull();
    await expect(chatProviderFor('org_1')).rejects.toThrow(/no chat connected/);
  });
});
