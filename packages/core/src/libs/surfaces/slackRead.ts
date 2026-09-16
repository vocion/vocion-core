/**
 * Reading Slack — the channel a mention came from, the thread it sits in, and
 * who is in it.
 *
 * Every call here can come back `missing_scope`, and that is the normal case
 * rather than the exceptional one: the scopes a workspace granted are decided
 * by whoever installed the app, months before an agent needed to read a
 * thread. So nothing throws on a missing scope. Each function returns either
 * the answer or the NAME of the scope that would have produced it, and the
 * caller turns that into a sentence a person can act on ("I can't read this
 * thread — that needs `groups:history` on the Slack app") instead of a shrug.
 *
 * Plain `fetch` through `slackApi`, no Slack SDK, by house precedent
 * (`libs/sources/slack.ts`).
 */

import { SLACK_API_BASE, slackApi } from './slack';

/**
 * An answer, or the scope that was missing. `null` for a call that failed for
 * some other reason — a transient API error is not a capability gap and must
 * not be reported as one.
 */
export type Scoped<T>
  = | { ok: true; value: T }
    | { ok: false; missingScope: string }
    | { ok: false; error: string };

/**
 * Which scope reads history in this channel — public and private differ.
 * @param channelId
 */
export function historyScopeFor(channelId: string): 'channels:history' | 'groups:history' {
  // Slack ids are prefixed by conversation type: C = public channel,
  // G = private channel/group. Anything else (D = DM) reads with `im:history`,
  // which this app already holds, so the private-channel scope is the
  // conservative answer for the rest.
  return channelId.startsWith('C') ? 'channels:history' : 'groups:history';
}

/**
 * Which scope names a channel — public and private differ the same way.
 * @param channelId
 */
export function infoScopeFor(channelId: string): 'channels:read' | 'groups:read' {
  return channelId.startsWith('C') ? 'channels:read' : 'groups:read';
}

/** One message as Slack returns it in a thread. */
export type SlackThreadMessage = {
  ts: string;
  text: string;
  user?: string;
  botId?: string;
  threadTs?: string;
};

/**
 * The channel's human name. Costs `channels:read` / `groups:read`.
 * @param channelId - Slack channel id.
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 */
export async function conversationInfo(channelId: string, token: string | undefined, baseUrl = SLACK_API_BASE, fetchImpl: typeof fetch = fetch): Promise<Scoped<{ name: string; isPrivate: boolean }>> {
  const res = await slackApi<{ channel?: { name?: string; is_private?: boolean } }>('conversations.info', { channel: channelId }, token, baseUrl, fetchImpl);
  if (!res.ok) {
    return res.error === 'missing_scope' ? { ok: false, missingScope: infoScopeFor(channelId) } : { ok: false, error: res.error };
  }
  return { ok: true, value: { name: res.body.channel?.name ?? '', isPrivate: res.body.channel?.is_private ?? false } };
}

/**
 * The messages in a thread, oldest first. Costs `channels:history` /
 * `groups:history` — the scope the live app does not have, which is the whole
 * reason `slack_post` exists.
 * @param opts - Channel and the thread's parent ts.
 * @param opts.channelId
 * @param opts.threadTs
 * @param opts.limit - Messages to read, newest-capped by Slack.
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 */
export async function conversationReplies(opts: { channelId: string; threadTs: string; limit?: number }, token: string | undefined, baseUrl = SLACK_API_BASE, fetchImpl: typeof fetch = fetch): Promise<Scoped<SlackThreadMessage[]>> {
  const res = await slackApi<{ messages?: { ts?: string; text?: string; user?: string; bot_id?: string; thread_ts?: string }[] }>(
    'conversations.replies',
    { channel: opts.channelId, ts: opts.threadTs, limit: opts.limit ?? 30 },
    token,
    baseUrl,
    fetchImpl,
  );
  if (!res.ok) {
    return res.error === 'missing_scope' ? { ok: false, missingScope: historyScopeFor(opts.channelId) } : { ok: false, error: res.error };
  }
  const messages = (res.body.messages ?? [])
    .filter(m => typeof m.ts === 'string')
    .map(m => ({ ts: m.ts!, text: m.text ?? '', ...(m.user ? { user: m.user } : {}), ...(m.bot_id ? { botId: m.bot_id } : {}), ...(m.thread_ts ? { threadTs: m.thread_ts } : {}) }));
  return { ok: true, value: messages };
}

/**
 * Display names for Slack user ids. Costs `users:read`, which the app holds,
 * so a poster's name is the one piece of thread context that never degrades.
 * Ids that cannot be resolved are simply absent from the map.
 * @param userIds - Slack user ids; duplicates and blanks are ignored.
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 */
export async function resolveUserNames(userIds: string[], token: string | undefined, baseUrl = SLACK_API_BASE, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of [...new Set(userIds.filter(Boolean))]) {
    const res = await slackApi<{ user?: { real_name?: string; profile?: { display_name?: string; real_name?: string }; name?: string } }>('users.info', { user: id }, token, baseUrl, fetchImpl);
    if (!res.ok) {
      continue;
    }
    const u = res.body.user;
    const name = u?.profile?.display_name || u?.profile?.real_name || u?.real_name || u?.name;
    if (name) {
      out.set(id, name);
    }
  }
  return out;
}

/**
 * A permalink to one message — the link that carries a thread back to the
 * people who were in it. `chat.getPermalink` needs no scope beyond the token
 * itself, so this is the one piece of Slack provenance that never degrades.
 * @param opts - Channel and the message's ts.
 * @param opts.channelId
 * @param opts.messageTs
 * @param token - Bot token.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 * @returns The permalink, or null when Slack would not give one.
 */
export async function chatPermalink(opts: { channelId: string; messageTs: string }, token: string | undefined, baseUrl = SLACK_API_BASE, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await slackApi<{ permalink?: string }>('chat.getPermalink', { channel: opts.channelId, message_ts: opts.messageTs }, token, baseUrl, fetchImpl);
  return res.ok ? (res.body.permalink ?? null) : null;
}
