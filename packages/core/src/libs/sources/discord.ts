/**
 * Discord connector — the messages in the channels a bot can read, as searchable documents, one
 * per message (the shape the Slack connector uses), so an agent can cite what was said and link
 * to it. The live reads (a thread whole, a file on it) and the writes (reply, react) are the chat
 * family's (`services/chat/providers/discord.ts`); the `/ask` command is the chat surface's.
 *
 * Auth: a bot token (`discord` platform). The bot must be in the server, see the channel, and
 * have the Message Content intent, or Discord hands it messages with empty text.
 *
 * Incremental: a run with a watermark reads only messages after the watermark's snowflake. A
 * full run (the weekly reconcile) re-reads the window, so a deleted message is tombstoned.
 * Rate limits are Discord's per-route buckets; `discordApi` waits out a 429.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { DiscordChannel } from '@/libs/discord/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { channelMessages, discordApi, discordCredentialsFrom, messageText, readableChannels, registerAskCommand, snowflakeAt } from '@/libs/discord/client';
import { InspectInputError } from './inspect';

const discordConfigSchema = z.object({
  /** Channel ids to sync. Empty: every text channel the bot can read. */
  channels: z.array(z.string().min(1)).default([]),
  /** How far back a full run reads. */
  pastDays: z.number().int().positive().max(365).default(30),
});

/** At most this many pages (100 messages each) per channel per run. */
const MAX_PAGES = 50;

/**
 * The channels a run covers: the configured ones, else every one the bot can read.
 * @param token - The bot token.
 * @param ids - The configured channel ids.
 * @param fetchImpl - Injectable for tests.
 */
async function channelsFor(token: string, ids: readonly string[], fetchImpl: typeof fetch): Promise<DiscordChannel[]> {
  if (ids.length === 0) {
    const all = await readableChannels(token, fetchImpl);
    if (!all.ok) {
      throw new Error(all.message);
    }
    return all.data;
  }
  const out: DiscordChannel[] = [];
  for (const id of ids) {
    const ch = await discordApi<DiscordChannel>(token, `/channels/${id}`, {}, fetchImpl);
    if (!ch.ok) {
      throw new Error(`Channel ${id}: ${ch.message}`);
    }
    out.push(ch.data);
  }
  return out;
}

/**
 * Every message in scope, as documents.
 * @param ctx - The run.
 * @param fetchImpl - Injectable for tests.
 * @yields Each document in scope.
 */
export async function* syncDiscord(ctx: SourceContext, fetchImpl: typeof fetch = fetch): AsyncIterable<IngestDoc> {
  const creds = discordCredentialsFrom(ctx.credentials);
  if (!creds) {
    throw new Error('No Discord bot token. Connect Discord with the bot token from the Developer Portal.');
  }
  const config = discordConfigSchema.parse(ctx.config ?? {});
  const floor = new Date(Date.now() - config.pastDays * 86_400_000);
  const start = ctx.since && ctx.since > floor ? ctx.since : floor;
  for (const channel of await channelsFor(creds.token, config.channels, fetchImpl)) {
    let after = snowflakeAt(start);
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await channelMessages(creds.token, channel.id, { after, limit: 100 }, fetchImpl);
      if (!batch.ok) {
        // One channel the bot lost access to should not cost the rest; reporting it also stops
        // this run from tombstoning documents it could not re-read.
        ctx.onProgress?.({ kind: 'error', uri: `discord:${channel.id}`, message: batch.message });
        break;
      }
      for (const m of batch.data) {
        const text = messageText(m);
        if (!m.content && (m.attachments ?? []).length === 0) {
          continue;
        }
        const uri = channel.guild_id ? `https://discord.com/channels/${channel.guild_id}/${channel.id}/${m.id}` : undefined;
        ctx.onProgress?.({ kind: 'fetched', uri });
        yield {
          externalId: `discord:${channel.id}:${m.id}`,
          title: channel.name ? `#${channel.name} · ${m.timestamp?.slice(0, 16).replace('T', ' ') ?? m.id}` : `Message ${m.id}`,
          content: text,
          ...(uri ? { uri } : {}),
          etag: m.edited_timestamp ?? m.timestamp ?? null,
          lastModifiedAt: m.edited_timestamp ? new Date(m.edited_timestamp) : m.timestamp ? new Date(m.timestamp) : null,
          metadata: { channelId: channel.id, channelName: channel.name ?? null, guildId: channel.guild_id ?? null, author: m.author?.global_name || m.author?.username || null, authorId: m.author?.id ?? null, ...(m.message_reference?.message_id ? { replyTo: m.message_reference.message_id } : {}) },
        };
      }
      if (batch.data.length < 100) {
        break;
      }
      after = batch.data[batch.data.length - 1]!.id;
    }
  }
}

/**
 * Test connection: the bot, the servers and channels it can read, and the `/ask` command.
 * @param input - The credential as typed or as vaulted, and the config.
 * @param input.credentials - The credential values.
 * @param input.config - The source's settings.
 * @param fetchImpl - Injectable for tests.
 */
export async function inspectDiscord(input: { credentials: Record<string, unknown>; config?: Record<string, unknown> }, fetchImpl: typeof fetch = fetch): Promise<ConnectorInspection> {
  const creds = discordCredentialsFrom(input.credentials);
  if (!creds) {
    throw new InspectInputError('No Discord bot token. Paste the bot token from the Developer Portal → your application → Bot.');
  }
  const checks: ConnectorCheck[] = [];
  const me = await discordApi<{ id?: string; username?: string }>(creds.token, '/users/@me', {}, fetchImpl);
  checks.push({ key: 'bot', label: 'Signs in as the bot', ok: me.ok, detail: me.ok ? `@${me.data.username ?? me.data.id}` : me.message });
  if (!me.ok) {
    return { reachable: me.status !== null, authorized: me.status !== 401, checks, note: null, error: me.message };
  }
  const channels = await readableChannels(creds.token, fetchImpl);
  const wanted = discordConfigSchema.safeParse(input.config ?? {});
  const ids = wanted.success ? wanted.data.channels : [];
  if (channels.ok) {
    const seen = new Set(channels.data.map(c => c.id));
    const missing = ids.filter(id => !seen.has(id));
    checks.push({
      key: 'channels',
      label: 'Reads its channels',
      ok: channels.data.length > 0 && missing.length === 0,
      detail: missing.length > 0
        ? `The bot cannot see channel ${missing.join(', ')}: add it to that server and let its role view the channel.`
        : channels.data.length > 0 ? `${channels.data.length} channel${channels.data.length === 1 ? '' : 's'}: ${channels.data.slice(0, 5).map(c => `#${c.name ?? c.id}`).join(', ')}${channels.data.length > 5 ? ', …' : ''}` : 'The bot is in no server yet. Invite it from the Developer Portal → OAuth2 → URL Generator (scope bot).',
    });
  } else {
    checks.push({ key: 'channels', label: 'Reads its channels', ok: false, detail: channels.message });
  }
  const command = await registerAskCommand(creds.token, fetchImpl);
  checks.push({ key: 'ask', label: 'Registers the /ask command', ok: command.ok, detail: command.ok ? (creds.publicKey ? 'Point the application\'s Interactions Endpoint URL at /api/webhooks/discord to answer it.' : 'Paste the application\'s public key too, so Vocion can answer it.') : command.message });
  const failed = checks.filter(c => !c.ok && c.key !== 'ask');
  return {
    reachable: true,
    authorized: true,
    checks,
    note: 'Registering /ask is the one change a test makes; it is idempotent.',
    error: failed.length > 0 ? failed.map(c => c.detail).join(' ') : null,
  };
}

export const discordConnector: SourceConnector<typeof discordConfigSchema> = {
  slug: 'discord',
  name: 'Discord',
  description: 'Messages in the Discord channels your bot can read, searchable and cited. Agents read a thread whole and reply or react in it, and people ask with /ask.',
  icon: 'MessageSquare',
  brand: 'discord',
  authKind: 'apikey',
  configSchema: discordConfigSchema,
  defaultReconcileCron: '0 4 * * 0',
  inspectNote: 'Reads the bot, its servers and channels, and registers the /ask command. Nothing is posted.',
  async inspect({ credentials, config }) {
    return inspectDiscord({ credentials, config });
  },
  sync: ctx => syncDiscord(ctx),
};
