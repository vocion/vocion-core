/**
 * Discord, as one bot a workspace holds: its bot token, and the application's public key the
 * `/ask` command is checked with (`discord` platform, `libs/platforms/registry.ts`). The source
 * (`libs/sources/discord.ts`), the chat family provider (`services/chat/providers/discord.ts`)
 * and the chat surface (`libs/surfaces/discord.ts`) all talk to Discord through here.
 *
 * WHICH BOT. The workspace's stored token first, the server's `DISCORD_BOT_TOKEN` /
 * `DISCORD_PUBLIC_KEY` second.
 *
 * RATE LIMITS. Discord answers 429 with `retry_after` seconds; a call waits that long (capped)
 * and tries again, up to three times, so a sync paces itself to the bucket it is in.
 *
 * Errors are data: a person-readable sentence, never the token.
 */

import { Buffer } from 'node:buffer';
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

export const DISCORD_API = 'https://discord.com/api/v10';

export type DiscordCredentials = { token: string; publicKey: string | null };

export type DiscordResult<T> = { ok: true; data: T } | { ok: false; status: number | null; code: number | null; message: string };

/**
 * The bot in a credential document, or null when it holds no token.
 * @param values - A decrypted `discord` credential, or a source's credential bag.
 */
export function discordCredentialsFrom(values: Record<string, unknown> | null | undefined): DiscordCredentials | null {
  const token = typeof values?.token === 'string' ? values.token.trim().replace(/^Bot\s+/i, '') : '';
  const publicKey = typeof values?.publicKey === 'string' && values.publicKey.trim() ? values.publicKey.trim() : null;
  return token ? { token, publicKey } : null;
}

/** The server's own bot, or null when it has none. */
export function envDiscordCredentials(): DiscordCredentials | null {
  return discordCredentialsFrom({ token: process.env.DISCORD_BOT_TOKEN, publicKey: process.env.DISCORD_PUBLIC_KEY });
}

/**
 * The bot a workspace's calls use: its own stored one, else the server's.
 * @param orgId - The workspace.
 */
export async function discordCredentialsFor(orgId: string): Promise<DiscordCredentials | null> {
  const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
  return discordCredentialsFrom(await resolvePlatformCredential(orgId, 'discord').catch(() => null)) ?? envDiscordCredentials();
}

const MAX_WAIT_MS = 10_000;

/**
 * One call to Discord's REST API as the bot.
 * @param token - The bot token.
 * @param path - Under `/api/v10`, e.g. `/users/@me`.
 * @param init - Method and JSON body.
 * @param init.method - Default GET.
 * @param init.json - A JSON body.
 * @param fetchImpl - Injectable for tests.
 */
export async function discordApi<T>(token: string, path: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; json?: unknown } = {}, fetchImpl: typeof fetch = fetch): Promise<DiscordResult<T>> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(`${DISCORD_API}${path}`, {
        method: init.method ?? 'GET',
        headers: { 'authorization': `Bot ${token}`, 'user-agent': 'DiscordBot (https://vocion.ai, 1)', ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
      });
    } catch (error) {
      return { ok: false, status: null, code: null, message: `Discord could not be reached (${error instanceof Error ? error.message : String(error)}).` };
    }
    if (res.status === 204) {
      return { ok: true, data: undefined as T };
    }
    const body = await res.json().catch(() => ({})) as T & { message?: string; code?: number; retry_after?: number };
    if (res.ok) {
      return { ok: true, data: body };
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(Math.min(MAX_WAIT_MS, Math.ceil((body.retry_after ?? 1) * 1000)));
      continue;
    }
    return { ok: false, status: res.status, code: body.code ?? null, message: discordError(res.status, body.code ?? null, body.message ?? null) };
  }
}

/**
 * Discord's refusal as a sentence a person can act on.
 * @param status - HTTP status.
 * @param code - Discord's JSON error code.
 * @param message - Discord's own message.
 */
function discordError(status: number, code: number | null, message: string | null): string {
  if (status === 401) {
    return 'Discord refused the bot token. Reset it on the Developer Portal (your application → Bot) and paste it again.';
  }
  if (code === 50001 || code === 50013) {
    return 'The bot cannot see or act in that channel: add it to the server, and give its role View Channel, Read Message History and Send Messages there.';
  }
  if (code === 10003) {
    return 'Discord has no such channel, or the bot is not in its server.';
  }
  if (code === 10008) {
    return 'Discord has no such message in that channel.';
  }
  if (status === 429) {
    return 'Discord is rate limiting the bot; try again in a minute.';
  }
  return `Discord answered ${status}${message ? `: ${message}` : ''}.`;
}

/** The epoch Discord's ids count from. */
const DISCORD_EPOCH = BigInt(1_420_070_400_000);
const SHIFT = BigInt(22);

/**
 * A message id (snowflake) at a moment: every message after it is newer.
 * @param at - The moment.
 */
export function snowflakeAt(at: Date): string {
  return String((BigInt(Math.max(0, at.getTime())) - DISCORD_EPOCH) << SHIFT);
}

/**
 * When a message (or any snowflake) was made.
 * @param id - The snowflake.
 */
export function snowflakeTime(id: string): Date {
  return new Date(Number((BigInt(id) >> SHIFT) + DISCORD_EPOCH));
}

/** A message, as the bot reads it. */
export type DiscordMessage = {
  id: string;
  channel_id: string;
  content?: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean };
  attachments?: { id: string; filename?: string; content_type?: string; size?: number; url?: string }[];
  message_reference?: { message_id?: string; channel_id?: string };
  thread?: { id: string; name?: string };
  type?: number;
};

export type DiscordChannel = { id: string; name?: string; type?: number; guild_id?: string; parent_id?: string | null };

/** Text-bearing channel types: a text channel, an announcement channel, and their threads. */
export const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);

/**
 * Messages in a channel, oldest first, after a message id (or the newest page when none).
 * @param token - The bot token.
 * @param channelId - The channel.
 * @param opts - Paging.
 * @param opts.after - Only messages after this id.
 * @param opts.limit - At most 100.
 * @param fetchImpl - Injectable for tests.
 */
export async function channelMessages(token: string, channelId: string, opts: { after?: string; limit?: number } = {}, fetchImpl: typeof fetch = fetch): Promise<DiscordResult<DiscordMessage[]>> {
  const q = new URLSearchParams({ limit: String(Math.min(opts.limit ?? 100, 100)) });
  if (opts.after) {
    q.set('after', opts.after);
  }
  const out = await discordApi<DiscordMessage[]>(token, `/channels/${channelId}/messages?${q.toString()}`, {}, fetchImpl);
  return out.ok ? { ok: true, data: [...(out.data ?? [])].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)) } : out;
}

/**
 * Every channel the bot can read text in, across the servers it is in.
 * @param token - The bot token.
 * @param fetchImpl - Injectable for tests.
 */
export async function readableChannels(token: string, fetchImpl: typeof fetch = fetch): Promise<DiscordResult<DiscordChannel[]>> {
  const guilds = await discordApi<{ id: string; name?: string }[]>(token, '/users/@me/guilds', {}, fetchImpl);
  if (!guilds.ok) {
    return guilds;
  }
  const out: DiscordChannel[] = [];
  for (const guild of guilds.data ?? []) {
    const channels = await discordApi<DiscordChannel[]>(token, `/guilds/${guild.id}/channels`, {}, fetchImpl);
    if (!channels.ok) {
      return channels;
    }
    out.push(...(channels.data ?? []).filter(c => TEXT_CHANNEL_TYPES.has(c.type ?? -1)).map(c => ({ ...c, guild_id: c.guild_id ?? guild.id })));
  }
  return { ok: true, data: out };
}

/** The `/ask` command, as Discord registers it. */
export const ASK_COMMAND = {
  name: 'ask',
  description: 'Ask this channel\'s Vocion agent',
  type: 1,
  options: [{ type: 3, name: 'question', description: 'What you want to know or have done', required: true }],
} as const;

/**
 * Register (or update — Discord upserts by name) the `/ask` command on the bot's application.
 * @param token - The bot token.
 * @param fetchImpl - Injectable for tests.
 */
export async function registerAskCommand(token: string, fetchImpl: typeof fetch = fetch): Promise<DiscordResult<{ applicationId: string }>> {
  const app = await discordApi<{ id?: string }>(token, '/oauth2/applications/@me', {}, fetchImpl);
  if (!app.ok) {
    return app;
  }
  if (!app.data.id) {
    return { ok: false, status: null, code: null, message: 'Discord did not say which application the bot belongs to.' };
  }
  const out = await discordApi<{ id?: string }>(token, `/applications/${app.data.id}/commands`, { method: 'POST', json: ASK_COMMAND }, fetchImpl);
  return out.ok ? { ok: true, data: { applicationId: app.data.id } } : out;
}

/** DER prefix that makes a raw 32-byte Ed25519 key an SPKI public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Whether an interaction was signed by Discord: Ed25519 over the timestamp header followed by
 * the raw body, against the application's public key.
 * @param rawBody - The body as received.
 * @param signatureHex - `X-Signature-Ed25519`.
 * @param timestamp - `X-Signature-Timestamp`.
 * @param publicKeyHex - The application's public key.
 */
export function verifyDiscordSignature(rawBody: string, signatureHex: string, timestamp: string, publicKeyHex: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verifySignature(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * A message's text for a reader: the author, then the words, then each attachment by name.
 * @param m - The message.
 */
export function messageText(m: DiscordMessage): string {
  const who = m.author?.global_name || m.author?.username || 'someone';
  const files = (m.attachments ?? []).map(a => `[attachment: ${a.filename ?? a.id}]`);
  return [`${who}: ${m.content ?? ''}`.trim(), ...files].join('\n');
}
