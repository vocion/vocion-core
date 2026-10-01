/**
 * THE CHAT FAMILY — where people talk, as one set of constructs.
 *
 * A factory's requests arrive in a chat thread and its answers go back to
 * the same thread. The constructs are the same whoever hosts the chat: a
 * channel, a thread in it, a message with an author and files, a reaction
 * on a message. An agent's tools and actions are named for those constructs
 * (`chat_read_thread`, `chat.reply_in_thread`, `chat.add_reaction`) and never
 * for a vendor, so a skill written for one workspace reads unchanged in a
 * workspace on another chat. Slack is the first provider
 * (`providers/slack.ts`); Microsoft Teams (a reply chain) and Discord (a
 * thread) are later providers of the same interface, chosen by the source
 * the workspace connected.
 *
 * TWO TOKENS, ONE RULE. A workspace's `slack` SOURCE holds the bot token of
 * the app installed in the workspace being read — for a client, their own
 * Slack, where the thread the ask came from lives. The deployment's
 * `SLACK_BOT_TOKEN` is the app the channel BINDINGS use for posts Vocion
 * makes on its own behalf (`chat.post_message`, announcements). The family
 * reads and replies with the source token when the org has a slack source
 * holding one, and falls back to the deployment token when it does not, so a
 * thread in the client's Slack is read with the app that is in it.
 */

import type { Buffer } from 'node:buffer';
import { familySourcesForOrg } from '@/libs/connectors/families';
import { slackToken } from '@/libs/notifications/slack';
import { getCredentialsForConnector } from '@/services/SourceCredentialService';
import { slackChatProvider } from './providers/slack';

/** A message in a channel, and the thread it belongs to when it is a reply. */
export type ChatMessageRef = { channelId: string; ts: string; threadTs?: string };

/** One file on a message, named so a reader can decide whether to fetch it. */
export type ChatFileMeta = { id: string; name: string; mimeType: string; size: number | null };

/** One message as a reader sees it: who, when (the platform's id), what, with which files. */
export type ChatMessageRead = {
  ts: string;
  author: { id: string | null; name: string | null };
  text: string;
  files: ChatFileMeta[];
};

/** A thread, oldest message first; the channel named when the token may name it. */
export type ChatThread = {
  channel: { id: string; name: string | null };
  messages: ChatMessageRead[];
};

/** A file's bytes, with what the platform says about them. */
export type ChatFile = { id: string; name: string; mimeType: string; size: number; bytes: Buffer };

/**
 * A read that may fail for a reason a person can act on — a scope the app
 * was not granted, a channel the app is not in — rather than throw.
 */
export type ChatRead<T> = { ok: true; value: T } | { ok: false; error: string };

export type ChatProvider = {
  /** The connector kind this provider answers for. */
  kind: 'slack';
  /** A link to a message, as the platform writes it, read back into channel and message ids; null for anything else. */
  parsePermalink: (url: string) => ChatMessageRef | null;
  /** A thread, oldest first: the parent and its replies, or one message when it started no thread. */
  readThread: (opts: { channelId: string; threadTs: string; limit?: number }) => Promise<ChatRead<ChatThread>>;
  /** One file on a message, downloaded with the token. */
  readFile: (fileId: string) => Promise<ChatRead<ChatFile>>;
  /** A reply in a thread; the platform's id for the new message. */
  postInThread: (opts: { channelId: string; threadTs: string; text: string }) => Promise<{ ts: string }>;
  /** Take a message back; one already gone counts as deleted. */
  deleteMessage: (opts: { channelId: string; ts: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** A reaction on a message; one already there counts as added. */
  addReaction: (opts: { channelId: string; ts: string; name: string }) => Promise<{ ok: true; already: boolean } | { ok: false; error: string }>;
  /** The reaction taken back; one not there counts as removed. */
  removeReaction: (opts: { channelId: string; ts: string; name: string }) => Promise<{ ok: true; absent: boolean } | { ok: false; error: string }>;
  /** The person behind an email on this chat, or null when the platform knows none. */
  findUserByEmail: (email: string) => Promise<{ id: string; name: string | null } | null>;
  /** A user by id: their display name and, when the token may read it, email. */
  userInfo: (id: string) => Promise<{ id: string; name: string | null; email: string | null } | null>;
};

/** Which token answers for a workspace, and where it came from. */
export type ChatToken = { token: string; from: 'source' | 'deployment'; sourceSlug: string | null };

/**
 * The token the chat family uses for a workspace: the first `slack` source's
 * bot token when one is stored, else the deployment's own. Null when there is
 * neither, which is "this deployment has no chat".
 * @param orgId - The workspace.
 */
export async function chatTokenFor(orgId: string): Promise<ChatToken | null> {
  const sources = await familySourcesForOrg(orgId, 'chat').catch(() => []);
  for (const source of sources) {
    const creds = await getCredentialsForConnector({ orgId, connectorSlug: source.kind, apiTokenId: source.apiTokenId }).catch(() => undefined);
    const token = creds?.token ?? creds?.accessToken;
    if (typeof token === 'string' && token.trim()) {
      return { token: token.trim(), from: 'source', sourceSlug: source.slug };
    }
  }
  const deployment = slackToken();
  return deployment ? { token: deployment, from: 'deployment', sourceSlug: null } : null;
}

/**
 * The chat provider for a workspace. Slack today; the source's kind picks the
 * provider once there is more than one.
 * @param orgId - The workspace.
 * @throws {Error} When neither a slack source nor the deployment holds a token.
 */
export async function chatProviderFor(orgId: string): Promise<ChatProvider> {
  const token = await chatTokenFor(orgId);
  if (!token) {
    throw new Error('This workspace has no chat connected: no slack source holds a token and the deployment has no SLACK_BOT_TOKEN. Connect Slack at /dashboard/connectors.');
  }
  return slackChatProvider(token.token);
}

/**
 * A message link read back into ids by whichever provider writes links that
 * way — pure, so a dedup key or a precheck can use it without a token.
 * @param url - A permalink to a message.
 */
export function parseChatPermalink(url: string): ChatMessageRef | null {
  return slackChatProvider('').parsePermalink(url);
}

/**
 * The message a tool or action was pointed at: a permalink, or a channel id
 * and the message's id. Null when neither names one.
 * @param input - What the caller gave.
 * @param input.permalink - A link to the message.
 * @param input.channelId - The channel, when no link.
 * @param input.ts - The message's id, when no link.
 * @param input.threadTs - The thread the message is in, when known.
 */
export function messageRefOf(input: { permalink?: string | null; channelId?: string | null; ts?: string | null; threadTs?: string | null }): ChatMessageRef | null {
  if (input.permalink) {
    const parsed = parseChatPermalink(input.permalink);
    if (parsed) {
      return parsed;
    }
  }
  if (input.channelId && input.ts) {
    return { channelId: input.channelId, ts: input.ts, ...(input.threadTs ? { threadTs: input.threadTs } : {}) };
  }
  return null;
}
