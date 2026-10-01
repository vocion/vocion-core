/**
 * Slack as a chat provider (`services/chat/provider.ts`): the first one.
 *
 * Built on the surface's own helpers (`libs/surfaces/slack.ts`,
 * `libs/surfaces/slackRead.ts`) so auth, missing-scope handling and the API
 * shape exist once. A missing scope is the normal failure here, not the
 * exceptional one — the scopes a workspace granted were decided by whoever
 * installed the app — so every read answers with the scope's NAME when that
 * is what stopped it, and the agent can say "that needs `groups:history`"
 * instead of "I could not read it".
 */

import type { ChatMessageRef, ChatProvider, ChatThread } from '../provider';
import { Buffer } from 'node:buffer';
import { SLACK_API_BASE, slackApi } from '@/libs/surfaces/slack';
import { conversationInfo, conversationReplies, historyScopeFor, resolveUserNames } from '@/libs/surfaces/slackRead';

/**
 * `https://<team>.slack.com/archives/<channel>/p<16 digits>[?thread_ts=<ts>[&cid=…]]`.
 * The `p` segment is the message's `ts` without its dot: the last six digits
 * are the fraction.
 */
const PERMALINK = /^https?:\/\/[\w-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d{10,})(?:[/?#].*)?$/i;

/**
 * A Slack message permalink read back into its channel and message ids, or
 * null for any other URL.
 * @param url - The permalink.
 */
export function parseSlackPermalink(url: string): ChatMessageRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const m = PERMALINK.exec(parsed.href);
  if (!m) {
    return null;
  }
  const digits = m[2]!;
  const ts = `${digits.slice(0, -6)}.${digits.slice(-6)}`;
  const threadTs = parsed.searchParams.get('thread_ts');
  return { channelId: m[1]!.toUpperCase(), ts, ...(threadTs && /^\d+\.\d+$/.test(threadTs) ? { threadTs } : {}) };
}

type SlackFile = { id?: string; name?: string; title?: string; mimetype?: string; size?: number; url_private_download?: string; url_private?: string };

/**
 * The provider bound to one token.
 * @param token - A bot token: the slack source's, or the deployment's.
 * @param baseUrl - Overridable for tests.
 * @param fetchImpl - Injectable for tests.
 */
export function slackChatProvider(token: string, baseUrl = SLACK_API_BASE, fetchImpl: typeof fetch = fetch): ChatProvider {
  const api = <T extends Record<string, unknown>>(method: string, body: Record<string, unknown>) => slackApi<T>(method, body, token, baseUrl, fetchImpl);

  const readThread: ChatProvider['readThread'] = async (opts) => {
    let replies = await conversationReplies({ channelId: opts.channelId, threadTs: opts.threadTs, limit: opts.limit ?? 50 }, token, baseUrl, fetchImpl);
    if (!replies.ok && 'error' in replies && replies.error === 'thread_not_found') {
      // Not a thread's parent: one message, read from the channel's history.
      const one = await api<{ messages?: { ts?: string; text?: string; user?: string; bot_id?: string; files?: SlackFile[] }[] }>('conversations.history', { channel: opts.channelId, latest: opts.threadTs, oldest: opts.threadTs, inclusive: true, limit: 1 });
      if (!one.ok) {
        replies = one.error === 'missing_scope' ? { ok: false, missingScope: historyScopeFor(opts.channelId) } : { ok: false, error: one.error };
      } else {
        replies = { ok: true, value: (one.body.messages ?? []).filter(m => typeof m.ts === 'string').map(m => ({ ts: m.ts!, text: m.text ?? '', ...(m.user ? { user: m.user } : {}), ...(m.bot_id ? { botId: m.bot_id } : {}), ...(m.files?.length ? { files: m.files.filter(f => typeof f.id === 'string').map(f => ({ id: f.id!, name: f.name ?? f.title ?? f.id!, mimeType: f.mimetype ?? 'application/octet-stream', size: typeof f.size === 'number' ? f.size : null })) } : {}) })) };
      }
    }
    if (!replies.ok) {
      return { ok: false, error: 'missingScope' in replies ? `Reading this thread needs the \`${replies.missingScope}\` scope on the Slack app; it was not granted.` : slackError(replies.error, opts.channelId) };
    }
    const messages = replies.value;
    const [names, info] = await Promise.all([
      resolveUserNames(messages.map(m => m.user ?? '').filter(Boolean), token, baseUrl, fetchImpl),
      conversationInfo(opts.channelId, token, baseUrl, fetchImpl),
    ]);
    const thread: ChatThread = {
      channel: { id: opts.channelId, name: info.ok ? info.value.name || null : null },
      messages: messages.map(m => ({
        ts: m.ts,
        author: { id: m.user ?? m.botId ?? null, name: m.user ? (names.get(m.user) ?? null) : (m.botId ? 'bot' : null) },
        text: m.text,
        files: m.files ?? [],
      })),
    };
    return { ok: true, value: thread };
  };

  const readFile: ChatProvider['readFile'] = async (fileId) => {
    const info = await api<{ file?: SlackFile }>('files.info', { file: fileId });
    if (!info.ok) {
      return { ok: false, error: info.error === 'missing_scope' ? 'Reading a file needs the `files:read` scope on the Slack app; it was not granted.' : slackError(info.error) };
    }
    const file = info.body.file;
    const url = file?.url_private_download ?? file?.url_private;
    if (!file || !url) {
      return { ok: false, error: `Slack has no downloadable file ${fileId}.` };
    }
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return { ok: false, error: `Slack would not hand over file ${fileId}: HTTP ${res.status}.` };
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { ok: true, value: { id: file.id ?? fileId, name: file.name ?? file.title ?? fileId, mimeType: file.mimetype ?? res.headers.get('content-type') ?? 'application/octet-stream', size: bytes.byteLength, bytes } };
  };

  return {
    kind: 'slack',
    parsePermalink: parseSlackPermalink,
    readThread,
    readFile,
    async postInThread(opts) {
      const posted = await api<{ ts?: string }>('chat.postMessage', { channel: opts.channelId, text: opts.text, thread_ts: opts.threadTs });
      if (!posted.ok) {
        throw new Error(`Slack did not take the reply: ${slackError(posted.error, opts.channelId)}`);
      }
      return { ts: posted.body.ts ?? '' };
    },
    async deleteMessage(opts) {
      const out = await api('chat.delete', { channel: opts.channelId, ts: opts.ts });
      if (out.ok || out.error === 'message_not_found') {
        return { ok: true };
      }
      return { ok: false, error: slackError(out.error, opts.channelId) };
    },
    async addReaction(opts) {
      const out = await api('reactions.add', { channel: opts.channelId, timestamp: opts.ts, name: opts.name });
      if (out.ok) {
        return { ok: true, already: false };
      }
      if (out.error === 'already_reacted') {
        return { ok: true, already: true };
      }
      return { ok: false, error: out.error === 'missing_scope' ? 'Adding a reaction needs the `reactions:write` scope on the Slack app; it was not granted.' : slackError(out.error, opts.channelId) };
    },
    async removeReaction(opts) {
      const out = await api('reactions.remove', { channel: opts.channelId, timestamp: opts.ts, name: opts.name });
      if (out.ok) {
        return { ok: true, absent: false };
      }
      if (out.error === 'no_reaction' || out.error === 'message_not_found') {
        return { ok: true, absent: true };
      }
      return { ok: false, error: slackError(out.error, opts.channelId) };
    },
    async findUserByEmail(email) {
      const out = await api<{ user?: { id?: string; real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } } }>('users.lookupByEmail', { email });
      if (!out.ok || !out.body.user?.id) {
        return null;
      }
      const u = out.body.user;
      return { id: u.id!, name: u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || null };
    },
    async userInfo(id) {
      const out = await api<{ user?: { id?: string; real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string; email?: string } } }>('users.info', { user: id });
      if (!out.ok || !out.body.user?.id) {
        return null;
      }
      const u = out.body.user;
      return { id: u.id!, name: u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || null, email: u.profile?.email ?? null };
    },
  };
}

/**
 * Slack's error code as a sentence a person can act on.
 * @param error - The `error` field Slack returned.
 * @param channelId - The channel, when the call named one.
 */
function slackError(error: string, channelId?: string): string {
  switch (error) {
    case 'not_in_channel':
    case 'channel_not_found':
      return `The Slack app is not in channel ${channelId ?? ''}: invite it there first.`.replace('  ', ' ');
    case 'missing_token':
      return 'No Slack token is configured.';
    case 'invalid_auth':
    case 'token_revoked':
    case 'account_inactive':
      return `Slack rejected the token (${error}); reconnect the slack source.`;
    default:
      return `Slack answered ${error}.`;
  }
}
