import type { ChatInbound, ChatMessage, ChatParse, ChatPostRef, ChatReplyTarget, ChatSurfaceAdapter, ChatVerification } from './types';
import { discordApi, discordCredentialsFor, envDiscordCredentials, verifyDiscordSignature } from '@/libs/discord/client';
import { absoluteAppLinks } from '@/libs/links';

/**
 * DISCORD AS A CHAT SURFACE — a person asks with `/ask <question>` in a channel a workspace
 * bound (surface `discord`, the channel id; or `*` with the server id as the team, for the whole
 * server), and the channel's agent answers in the channel. Discord delivers a slash command to an
 * HTTP endpoint (the application's Interactions Endpoint URL, `/api/webhooks/discord`) signed
 * with Ed25519; ordinary messages only reach a bot over a gateway socket, which this server does
 * not hold open, so `/ask` is the front door and the source (`libs/sources/discord.ts`) is how
 * the rest of a channel is read.
 *
 * A command starts no Discord thread, so the conversation is the person in that channel:
 * `discord:<channel>:<user>@<server>`. The server rides in the thread key so a reply finds the
 * bot of the workspace that bound the server. Replies, the working line and its edits go out as
 * the bot (`discordApi`), with no pings.
 */

/** Discord takes 2000 characters a message. */
export const DISCORD_MAX = 2000;

type Interaction = {
  type?: number;
  id?: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id?: string };
  member?: { user?: { id?: string; username?: string; global_name?: string | null } };
  user?: { id?: string; username?: string; global_name?: string | null };
  data?: { name?: string; options?: { name?: string; value?: unknown }[] };
};

/**
 * A Discord interaction, as a challenge (the endpoint check), a message, or a reason to ignore it.
 * @param payload - The parsed JSON body.
 */
export function parseDiscord(payload: unknown): ChatParse {
  const i = (payload ?? {}) as Interaction;
  if (i.type === 1) {
    return { kind: 'challenge', challenge: 'pong' };
  }
  if (i.type !== 2) {
    return { kind: 'ignore', reason: `interaction type ${i.type ?? 'unknown'}` };
  }
  if (i.data?.name !== 'ask') {
    return { kind: 'ignore', reason: `command /${i.data?.name ?? '?'} is not Vocion's` };
  }
  const channelId = i.channel_id ?? i.channel?.id;
  const user = i.member?.user ?? i.user;
  const text = String(i.data.options?.find(o => o.name === 'question')?.value ?? '').trim();
  if (!channelId || !user?.id || !i.id) {
    return { kind: 'ignore', reason: 'no channel or user' };
  }
  if (!text) {
    return { kind: 'ignore', reason: 'empty question' };
  }
  const inbound: ChatInbound = {
    surface: 'discord',
    teamId: i.guild_id ?? null,
    channelId,
    threadRef: i.guild_id ? `${user.id}@${i.guild_id}` : user.id,
    messageRef: i.id,
    externalUserId: user.id,
    text,
    isDirect: !i.guild_id,
  };
  return { kind: 'message', inbound };
}

/**
 * The words of a Discord message: Discord renders markdown, so links are made whole and the
 * message is cut to one.
 * @param message - What to say.
 */
export function discordText(message: string | ChatMessage): string {
  const m = typeof message === 'string' ? { text: message } : message;
  const links = (m.images ?? []).map(i => `${i.caption}: ${absoluteAppLinks(i.url.startsWith('/api/') ? '/dashboard' : i.url)}`);
  const all = [absoluteAppLinks(m.text), ...links].join('\n');
  return all.length > DISCORD_MAX ? `${all.slice(0, DISCORD_MAX - 1).trimEnd()}…` : all;
}

/**
 * The server an interaction or a thread key names.
 * @param threadRef - `<user>@<server>`, or a bare user id in a DM.
 */
function serverOf(threadRef: string | undefined): string | null {
  const at = (threadRef ?? '').indexOf('@');
  return at > 0 ? threadRef!.slice(at + 1) : null;
}

/**
 * The bot that answers in a channel: the binding workspace's own, else the server's.
 * @param channelId - The channel.
 * @param serverId - Its server, when known.
 */
async function botFor(channelId: string, serverId: string | null): Promise<string | null> {
  const { resolveBinding } = await import('@/services/ChatSurfaceService');
  const binding = await resolveBinding('discord', serverId, channelId).catch(() => null);
  const creds = binding ? await discordCredentialsFor(binding.orgId) : envDiscordCredentials();
  return creds?.token ?? null;
}

/**
 * Check an interaction against the server's public key, then the bound workspace's.
 * @param rawBody - The body as received.
 * @param headers - The request headers.
 */
async function verifyForChannel(rawBody: string, headers: Headers): Promise<ChatVerification> {
  const env = verifyDiscord(rawBody, headers, envDiscordCredentials()?.publicKey ?? null);
  if (env.ok || env.reason === 'missing_headers') {
    return env;
  }
  let i: Interaction = {};
  try {
    i = JSON.parse(rawBody) as Interaction;
  } catch {
    return env;
  }
  const channelId = i.channel_id ?? i.channel?.id;
  if (!channelId) {
    return env;
  }
  const { resolveBinding } = await import('@/services/ChatSurfaceService');
  const binding = await resolveBinding('discord', i.guild_id ?? null, channelId).catch(() => null);
  const creds = binding ? await discordCredentialsFor(binding.orgId) : null;
  return creds?.publicKey ? verifyDiscord(rawBody, headers, creds.publicKey) : env;
}

/**
 * Check an interaction was signed by Discord.
 * @param rawBody - The body.
 * @param headers - The headers.
 * @param publicKey - The application's public key.
 */
export function verifyDiscord(rawBody: string, headers: Headers, publicKey: string | null): ChatVerification {
  if (!publicKey) {
    return { ok: false, reason: 'missing_secret' };
  }
  const signature = headers.get('x-signature-ed25519');
  const timestamp = headers.get('x-signature-timestamp');
  if (!signature || !timestamp) {
    return { ok: false, reason: 'missing_headers' };
  }
  return verifyDiscordSignature(rawBody, signature, timestamp, publicKey) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/**
 * A post's address: the channel, and the server in the thread key so the right bot acts on it.
 * @param post - The post.
 */
async function botForPost(post: ChatPostRef): Promise<string | null> {
  return botFor(post.channelId, serverOf(post.threadRef));
}

export const discordSurface: ChatSurfaceAdapter = {
  id: 'discord',
  verify: (rawBody, headers) => verifyDiscord(rawBody, headers, envDiscordCredentials()?.publicKey ?? null),
  verifyAsync: verifyForChannel,
  parse: parseDiscord,
  answerStyle: 'This arrived as a Discord /ask. Answer as a chat message: short, markdown is fine, no tables, links written out in full.',
  reply: async (target: ChatReplyTarget, message): Promise<ChatPostRef | null> => {
    const token = await botFor(target.channelId, serverOf(target.threadRef));
    if (!token) {
      throw new Error('No Discord bot: connect Discord for this workspace, or set DISCORD_BOT_TOKEN; cannot reply');
    }
    const posted = await discordApi<{ id?: string }>(token, `/channels/${target.channelId}/messages`, { method: 'POST', json: { content: discordText(message), allowed_mentions: { parse: [] } } });
    if (!posted.ok) {
      throw new Error(`Discord did not take the reply: ${posted.message}`);
    }
    return posted.data.id ? { channelId: target.channelId, ts: posted.data.id, ...(target.threadRef ? { threadRef: target.threadRef } : {}), media: 'none' } : null;
  },
  retract: async (post) => {
    const token = await botForPost(post);
    if (token) {
      await discordApi(token, `/channels/${post.channelId}/messages/${post.ts}`, { method: 'DELETE' });
    }
  },
  edit: async (post, text) => {
    const token = await botForPost(post);
    if (token) {
      await discordApi(token, `/channels/${post.channelId}/messages/${post.ts}`, { method: 'PATCH', json: { content: discordText(text) } });
    }
  },
};
