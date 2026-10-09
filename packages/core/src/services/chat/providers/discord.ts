/**
 * Discord as a chat provider (`services/chat/provider.ts`): the second one, after Slack.
 *
 * The constructs map like this. A Discord message id is the message's `ts`. A "thread" is a
 * message and what answers it: the replies that reference it, or — when someone opened a Discord
 * thread on it — that thread's messages. A reply in the thread is a message that references the
 * one it answers (`message_reference`), or a message in the thread channel when the "thread" is
 * one. A file is an attachment, named `<channel>:<message>:<attachment>` so it can be fetched
 * again from its message. Discord gives a bot no one's email, so `findUserByEmail` knows nobody
 * and `userInfo` has no email; the agent says so rather than guessing.
 */

import type { ChatMessageRead, ChatMessageRef, ChatProvider } from '../provider';
import type { DiscordMessage } from '@/libs/discord/client';
import { Buffer } from 'node:buffer';
import { channelMessages, discordApi } from '@/libs/discord/client';

/** `https://discord.com/channels/<guild|@me>/<channel>/<message>`, on any of Discord's hosts. */
const PERMALINK = /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(?:\d+|@me)\/(\d+)\/(\d+)\/?(?:[?#].*)?$/i;

/**
 * A Discord message link read back into its channel and message ids, or null for any other URL.
 * @param url - The link.
 */
export function parseDiscordPermalink(url: string): ChatMessageRef | null {
  const m = PERMALINK.exec(url.trim());
  return m ? { channelId: m[1]!, ts: m[2]!, kind: 'discord' } : null;
}

/**
 * Reactions are named the Slack way across the chat family (`eyes`, `white_check_mark`); Discord
 * takes the character itself, or `name:id` for a server's own emoji, which passes through.
 */
const EMOJI: Record<string, string> = {
  'eyes': '\u{1F440}',
  'white_check_mark': '\u2705',
  'heavy_check_mark': '\u2714\uFE0F',
  '+1': '\u{1F44D}',
  'thumbsup': '\u{1F44D}',
  'x': '\u274C',
  'rocket': '\u{1F680}',
  'tada': '\u{1F389}',
  'hourglass_flowing_sand': '\u23F3',
  'warning': '\u26A0\uFE0F',
  'memo': '\u{1F4DD}',
};

function read(m: DiscordMessage): ChatMessageRead {
  return {
    ts: m.id,
    author: { id: m.author?.id ?? null, name: m.author?.global_name || m.author?.username || null },
    text: m.content ?? '',
    files: (m.attachments ?? []).map(a => ({ id: `${m.channel_id}:${m.id}:${a.id}`, name: a.filename ?? a.id, mimeType: a.content_type ?? 'application/octet-stream', size: typeof a.size === 'number' ? a.size : null })),
  };
}

/**
 * The provider bound to one bot token.
 * @param token - The bot token: the discord source's, or the deployment's.
 * @param fetchImpl - Injectable for tests.
 */
export function discordChatProvider(token: string, fetchImpl: typeof fetch = fetch): ChatProvider {
  const api = <T>(path: string, init: Parameters<typeof discordApi>[2] = {}) => discordApi<T>(token, path, init, fetchImpl);
  const emoji = (name: string) => encodeURIComponent(EMOJI[name.replace(/^:|:$/g, '')] ?? name.replace(/^:|:$/g, ''));

  return {
    kind: 'discord',
    parsePermalink: parseDiscordPermalink,
    async readThread(opts) {
      const [channel, parent] = await Promise.all([
        api<{ id: string; name?: string }>(`/channels/${opts.channelId}`),
        api<DiscordMessage>(`/channels/${opts.channelId}/messages/${opts.threadTs}`),
      ]);
      if (!parent.ok) {
        return { ok: false, error: parent.message };
      }
      const limit = opts.limit ?? 50;
      let replies: DiscordMessage[] = [];
      if (parent.data.thread?.id) {
        // Someone opened a Discord thread on it: the thread channel holds the conversation.
        const inThread = await channelMessages(token, parent.data.thread.id, { after: parent.data.id, limit }, fetchImpl);
        replies = inThread.ok ? inThread.data : [];
      } else {
        const after = await channelMessages(token, opts.channelId, { after: parent.data.id, limit: 100 }, fetchImpl);
        replies = after.ok ? after.data.filter(m => m.message_reference?.message_id === parent.data.id).slice(0, limit - 1) : [];
      }
      return {
        ok: true,
        value: {
          channel: { id: opts.channelId, name: channel.ok ? channel.data.name ?? null : null },
          messages: [parent.data, ...replies].map(read),
        },
      };
    },
    async readFile(fileId) {
      const [channelId, messageId, attachmentId] = fileId.split(':');
      if (!channelId || !messageId || !attachmentId) {
        return { ok: false, error: `${fileId} is not a Discord file id; take it from chat_read_thread.` };
      }
      const message = await api<DiscordMessage>(`/channels/${channelId}/messages/${messageId}`);
      if (!message.ok) {
        return { ok: false, error: message.message };
      }
      const attachment = (message.data.attachments ?? []).find(a => a.id === attachmentId);
      if (!attachment?.url) {
        return { ok: false, error: `That message has no attachment ${attachmentId}.` };
      }
      const res = await fetchImpl(attachment.url);
      if (!res.ok) {
        return { ok: false, error: `Discord would not hand over the file: HTTP ${res.status}.` };
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      return { ok: true, value: { id: fileId, name: attachment.filename ?? attachmentId, mimeType: attachment.content_type ?? res.headers.get('content-type') ?? 'application/octet-stream', size: bytes.byteLength, bytes } };
    },
    async postInThread(opts) {
      const posted = await api<{ id?: string }>(`/channels/${opts.channelId}/messages`, {
        method: 'POST',
        json: { content: opts.text.slice(0, 2000), message_reference: { message_id: opts.threadTs, fail_if_not_exists: false }, allowed_mentions: { parse: [] } },
      });
      if (!posted.ok) {
        throw new Error(`Discord did not take the reply: ${posted.message}`);
      }
      return { ts: posted.data.id ?? '' };
    },
    async deleteMessage(opts) {
      const out = await api(`/channels/${opts.channelId}/messages/${opts.ts}`, { method: 'DELETE' });
      return out.ok || out.code === 10008 ? { ok: true } : { ok: false, error: out.message };
    },
    async addReaction(opts) {
      const out = await api(`/channels/${opts.channelId}/messages/${opts.ts}/reactions/${emoji(opts.name)}/@me`, { method: 'PUT' });
      // Discord answers a repeat reaction with 204 too: it cannot say whether it was already there.
      return out.ok ? { ok: true, already: false } : { ok: false, error: out.message };
    },
    async removeReaction(opts) {
      const out = await api(`/channels/${opts.channelId}/messages/${opts.ts}/reactions/${emoji(opts.name)}/@me`, { method: 'DELETE' });
      if (out.ok) {
        return { ok: true, absent: false };
      }
      return out.code === 10008 || out.code === 10014 ? { ok: true, absent: true } : { ok: false, error: out.message };
    },
    async findUserByEmail() {
      // A bot is never told anyone's email on Discord.
      return null;
    },
    async userInfo(id) {
      const out = await api<{ id?: string; username?: string; global_name?: string | null }>(`/users/${id}`);
      return out.ok && out.data.id ? { id: out.data.id, name: out.data.global_name || out.data.username || null, email: null } : null;
    },
  };
}
