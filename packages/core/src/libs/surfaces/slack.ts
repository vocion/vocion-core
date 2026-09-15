import type { ChatInbound, ChatParse, ChatReplyTarget, ChatSurfaceAdapter, ChatVerification } from './types';
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Slack as a chat surface. Events API in (`app_mention`, `message.im`,
 * `member_joined_channel` for the bot itself — never `message.channels` or
 * `message.groups`, which would stream every message in every channel),
 * `chat.postMessage` out, both over plain `fetch` like `libs/sources/slack.ts`
 * — no Slack SDK, by house precedent.
 *
 * Configuration is deployment-level for phase 1: one Slack app per Vocion
 * install, `SLACK_SIGNING_SECRET` + `SLACK_BOT_TOKEN` in the environment.
 * Per-org bot tokens through the credential vault are phase 2.
 */

/** Slack rejects replays older than five minutes; so do we. */
const MAX_SKEW_SECONDS = 300;

type SlackEvent = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
};

type SlackEnvelope = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: SlackEvent;
  authorizations?: { user_id?: string; is_bot?: boolean }[];
};

/**
 * Slack's v0 signature: HMAC-SHA256 of `v0:<timestamp>:<raw body>` with the
 * app's signing secret. Compared in constant time.
 * @param rawBody - The exact request body, unparsed.
 * @param headers - Request headers.
 * @param secret - The app's signing secret.
 * @param now - Clock, injectable for tests (seconds).
 */
export function verifySlackSignature(rawBody: string, headers: Headers, secret: string | undefined, now: number = Math.floor(Date.now() / 1000)): ChatVerification {
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  const ts = headers.get('x-slack-request-timestamp');
  const sig = headers.get('x-slack-signature');
  if (!ts || !sig) {
    return { ok: false, reason: 'missing_headers' };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale' };
  }
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

/**
 * Strip `<@U…>` mentions (the bot's own, and any others) so the agent sees the
 * question, not the addressing.
 * @param text - Raw Slack message text.
 */
export function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The bot's own Slack user id for this delivery. Slack stamps every
 * `event_callback` with the identities it was delivered for, so the envelope
 * usually answers this itself; `SLACK_BOT_USER_ID` is the fallback for the
 * events (and the tests) that carry no `authorizations` block.
 * @param env - The envelope.
 * @param configured - Deployment-configured bot user id, if any.
 */
function botUserIdFor(env: SlackEnvelope, configured?: string): string | undefined {
  const authed = env.authorizations?.find(a => a.is_bot && a.user_id)?.user_id;
  return authed ?? (configured || undefined);
}

/**
 * Classify an Events API envelope.
 * @param payload - Parsed JSON body.
 * @param configuredBotUserId - Bot user id from the environment, used when the
 * envelope carries no `authorizations` block.
 */
export function parseSlackPayload(payload: unknown, configuredBotUserId?: string): ChatParse {
  const env = (payload ?? {}) as SlackEnvelope;
  if (env.type === 'url_verification' && typeof env.challenge === 'string') {
    return { kind: 'challenge', challenge: env.challenge };
  }
  if (env.type !== 'event_callback' || !env.event) {
    return { kind: 'ignore', reason: `envelope type ${env.type ?? 'unknown'}` };
  }
  const ev = env.event;
  // The bot being added to a channel is the discovery signal, and it is the
  // one event with no `ts` and no human sender — so it is classified before
  // the message-shaped checks below, which would drop it as incomplete.
  if (ev.type === 'member_joined_channel') {
    const botUserId = botUserIdFor(env, configuredBotUserId);
    if (!ev.channel || !ev.user) {
      return { kind: 'ignore', reason: 'incomplete join event' };
    }
    if (!botUserId || ev.user !== botUserId) {
      return { kind: 'ignore', reason: 'another member joined' };
    }
    return { kind: 'joined', join: { surface: 'slack', teamId: env.team_id ?? null, channelId: ev.channel, botUserId } };
  }
  if (ev.bot_id || ev.subtype) {
    return { kind: 'ignore', reason: ev.bot_id ? 'bot message' : `subtype ${ev.subtype}` };
  }
  if (!ev.user || !ev.channel || !ev.ts) {
    return { kind: 'ignore', reason: 'incomplete event' };
  }
  const isMention = ev.type === 'app_mention';
  const isDirect = ev.type === 'message' && ev.channel_type === 'im';
  if (!isMention && !isDirect) {
    return { kind: 'ignore', reason: `event type ${ev.type ?? 'unknown'}` };
  }
  const text = stripMentions(ev.text ?? '');
  if (!text) {
    return { kind: 'ignore', reason: 'empty text' };
  }
  const inbound: ChatInbound = {
    surface: 'slack',
    teamId: env.team_id ?? null,
    channelId: ev.channel,
    threadRef: ev.thread_ts ?? ev.ts,
    messageRef: ev.ts,
    externalUserId: ev.user,
    text,
    isDirect,
  };
  return { kind: 'message', inbound };
}

/**
 * Post a reply into the thread. Two-layer error check (`res.ok` and `body.ok`)
 * is the Slack idiom the source connector already uses.
 *
 * A target that carries a persona is posted with Slack's `username` and
 * `icon_url` overrides, which need the `chat:write.customize` bot scope — one
 * app, N faces. Without a persona the payload is byte-identical to what it was
 * before personas existed: the keys are omitted, never sent as null, because
 * Slack treats an explicit empty `username` as a name and posts blank.
 * A target with no `threadRef` posts to the channel itself rather than into a
 * thread — the channel-join introduction, which has no thread to answer in.
 * @param target - Channel, optionally a thread, and optionally the persona to post as.
 * @param text - Plain text (Slack mrkdwn is fine).
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 */
export async function postSlackReply(target: ChatReplyTarget, text: string, token: string | undefined, baseUrl = 'https://slack.com/api'): Promise<void> {
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is not set; cannot reply');
  }
  const payload: Record<string, string> = { channel: target.channelId, text };
  if (target.threadRef) {
    payload.thread_ts = target.threadRef;
  }
  if (target.displayName) {
    payload.username = target.displayName;
  }
  if (target.iconUrl) {
    payload.icon_url = target.iconUrl;
  }
  const res = await fetch(`${baseUrl}/chat.postMessage`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack chat.postMessage failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!body.ok) {
    throw new Error(`Slack API error: ${body.error ?? 'unknown'}`);
  }
}

export const slackSurface: ChatSurfaceAdapter = {
  id: 'slack',
  verify: (rawBody, headers) => verifySlackSignature(rawBody, headers, process.env.SLACK_SIGNING_SECRET),
  parse: payload => parseSlackPayload(payload, process.env.SLACK_BOT_USER_ID),
  reply: (target, text) => postSlackReply(target, text, process.env.SLACK_BOT_TOKEN),
};
