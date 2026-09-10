import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseSlackPayload, postSlackReply, stripMentions, verifySlackSignature } from './slack';

const SECRET = 'shh';
const NOW = 1_700_000_000;

function sign(body: string, ts: number = NOW, secret = SECRET): Headers {
  const sig = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;
  return new Headers({ 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sig });
}

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

  it('treats a DM as inbound, and ignores bots, edits, other event types and empty text', () => {
    const dm = parseSlackPayload({ type: 'event_callback', team_id: 'T1', event: { type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', ts: '5', text: 'hi' } });

    expect(dm.kind).toBe('message');
    expect(dm.kind === 'message' && dm.inbound.isDirect).toBe(true);
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'message', channel_type: 'im', bot_id: 'B1', user: 'U1', channel: 'D1', ts: '6', text: 'x' } }).kind).toBe('ignore');
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'message', subtype: 'message_changed', user: 'U1', channel: 'C1', ts: '7', text: 'x' } }).kind).toBe('ignore');
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'reaction_added', user: 'U1', channel: 'C1', ts: '8' } }).kind).toBe('ignore');
    expect(parseSlackPayload({ type: 'event_callback', event: { type: 'app_mention', user: 'U1', channel: 'C1', ts: '9', text: '<@UBOT>' } }).kind).toBe('ignore');
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

    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it('posts as the persona when the target carries one', async () => {
    const body = await post({ channelId: 'C1', threadRef: '100.1', displayName: 'Sterling Banks', iconUrl: 'https://www.vocion.ai/personas/sterling.png' });

    expect(body).toEqual({
      channel: 'C1',
      thread_ts: '100.1',
      text: 'hello',
      username: 'Sterling Banks',
      icon_url: 'https://www.vocion.ai/personas/sterling.png',
    });
  });

  it('sends the pre-persona payload unchanged when the target has none', async () => {
    const body = await post({ channelId: 'C1', threadRef: '100.1' });

    // No `username`/`icon_url` keys at all — an empty username posts blank in Slack.
    expect(body).toEqual({ channel: 'C1', thread_ts: '100.1', text: 'hello' });
  });

  it('posts to the channel with no thread_ts when the target has no thread', async () => {
    expect(await post({ channelId: 'C1' })).toEqual({ channel: 'C1', text: 'hello' });
  });

  it('carries whichever half of the persona is set', async () => {
    expect(await post({ channelId: 'C1', threadRef: '1', displayName: 'Keel Marsden' })).toEqual({ channel: 'C1', thread_ts: '1', text: 'hello', username: 'Keel Marsden' });
    expect(await post({ channelId: 'C1', threadRef: '1', iconUrl: 'https://www.vocion.ai/personas/keel.png' })).toEqual({ channel: 'C1', thread_ts: '1', text: 'hello', icon_url: 'https://www.vocion.ai/personas/keel.png' });
  });
});

describe('stripMentions', () => {
  it('removes user mentions with and without labels', () => {
    expect(stripMentions('<@U1|bot> ping <@U2>  now')).toBe('ping now');
  });
});
