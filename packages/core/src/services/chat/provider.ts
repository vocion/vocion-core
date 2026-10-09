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
 * (`providers/slack.ts`) and Discord the second (`providers/discord.ts`);
 * Microsoft Teams (a reply chain) is a later one. The provider is chosen by
 * the source the workspace connected, or by the link an agent was handed.
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
import process from 'node:process';
import { familySourcesForOrg } from '@/libs/connectors/families';
import { slackToken } from '@/libs/notifications/slack';
import { getCredentialsForConnector } from '@/services/SourceCredentialService';
import { parseAnyChatPermalink } from './permalinks';
import { discordChatProvider } from './providers/discord';
import { slackChatProvider } from './providers/slack';

/** The chat connector kinds there is a provider for. */
export type ChatKind = 'slack' | 'discord';

/** A message in a channel, and the thread it belongs to when it is a reply. */
export type ChatMessageRef = {
  channelId: string;
  ts: string;
  threadTs?: string;
  /** Which chat the ids belong to, when a link said so. */
  kind?: ChatKind;
};

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
  kind: ChatKind;
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

/** Which token answers for a workspace, which chat it is for, and where it came from. */
export type ChatToken = { token: string; kind: ChatKind; from: 'source' | 'deployment'; sourceSlug: string | null };

/**
 * The deployment's own bot for each chat, read from the env.
 * @param kind - Which chat.
 */
function deploymentToken(kind: ChatKind): string | null {
  return kind === 'slack' ? slackToken() : process.env.DISCORD_BOT_TOKEN?.trim() || null;
}

/**
 * The token the chat family uses for a workspace: the first chat source's bot
 * token when one is stored — of `kind` when the caller names one — else the
 * deployment's own. Null when there is neither, which is "this deployment has
 * no chat".
 * @param orgId - The workspace.
 * @param kind - The chat the caller needs, when a link already said which.
 */
export async function chatTokenFor(orgId: string, kind?: ChatKind): Promise<ChatToken | null> {
  const sources = await familySourcesForOrg(orgId, 'chat').catch(() => []);
  for (const source of sources) {
    const sourceKind = source.kind as ChatKind;
    if (kind && sourceKind !== kind) {
      continue;
    }
    const creds = await getCredentialsForConnector({ orgId, connectorSlug: source.kind, apiTokenId: source.apiTokenId }).catch(() => undefined);
    const token = creds?.token ?? creds?.accessToken;
    if (typeof token === 'string' && token.trim()) {
      return { token: token.trim().replace(/^Bot\s+/i, ''), kind: sourceKind, from: 'source', sourceSlug: source.slug };
    }
  }
  for (const candidate of kind ? [kind] : (['slack', 'discord'] as const)) {
    const deployment = deploymentToken(candidate);
    if (deployment) {
      return { token: deployment, kind: candidate, from: 'deployment', sourceSlug: null };
    }
  }
  return null;
}

/**
 * The provider for one chat, bound to a token.
 * @param token - The token and the chat it is for.
 */
function providerFor(token: ChatToken): ChatProvider {
  return token.kind === 'discord' ? discordChatProvider(token.token) : slackChatProvider(token.token);
}

/**
 * The chat provider for a workspace: the one the source it connected is for,
 * or — when a link names the chat (`ref.kind`) — that chat's.
 * @param orgId - The workspace.
 * @param kind - The chat the caller needs, when a link already said which.
 * @throws {Error} When neither a chat source nor the deployment holds a token.
 */
export async function chatProviderFor(orgId: string, kind?: ChatKind): Promise<ChatProvider> {
  const token = await chatTokenFor(orgId, kind);
  if (!token) {
    throw new Error(`This workspace has no ${kind ?? 'chat'} connected: no chat source holds a token and the deployment has none. Connect ${kind === 'discord' ? 'Discord' : 'Slack or Discord'} at /dashboard/connectors.`);
  }
  return providerFor(token);
}

/**
 * A message link read back into ids by whichever provider writes links that
 * way — pure, so a dedup key or a precheck can use it without a token.
 * @param url - A permalink to a message.
 */
export function parseChatPermalink(url: string): ChatMessageRef | null {
  return parseAnyChatPermalink(url);
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
