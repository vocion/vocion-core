/**
 * Slack connector — ingest channel messages as retrievable documents (RevOps).
 *
 * Auth: bot/user token in `ctx.credentials.token`. Incremental: when `ctx.since`
 * is set, `oldest` is that epoch second. Paginates `response_metadata.next_cursor`.
 * Slack returns `ok: false` on error.
 *
 * `config.channel` names ONE channel. Omit it and the connector sweeps every
 * channel the bot is a member of, which is what "all of Slack" has to mean
 * here: `conversations.history` answers `not_in_channel` for anything the bot
 * was never invited to, so the bot's membership IS the reachable set, and
 * listing channels it cannot read would only manufacture errors.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';

const slackConfigSchema = z.object({
  /**
   * Channel id to read history from (e.g. `C0123ABCD`). Omit to sweep every
   * channel the bot belongs to — a new channel is then picked up on the next
   * sync with no YAML edit, which a fixed list cannot do.
   */
  channel: z.string().min(1).optional(),
  /**
   * Include private channels the bot is in. Public only when absent.
   *
   * `.optional()` rather than `.default(false)` on purpose: a default is
   * written into every existing slack source's stored config on the next
   * apply, and a changed config is what triggers a full re-sync. The Revenue
   * workspace's #revenue source would have re-ingested and re-embedded its
   * whole history to record a field meaning "carry on as before".
   */
  includePrivate: z.boolean().optional(),
  baseUrl: z.string().url().default('https://slack.com/api'),
});

type SlackMessage = { ts: string; user?: string; text?: string; subtype?: string };
type SlackHistory = {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};
type SlackChannel = { id: string; name?: string; is_member?: boolean };
type SlackConversations = {
  ok: boolean;
  error?: string;
  channels?: SlackChannel[];
  response_metadata?: { next_cursor?: string };
};

async function slackGet<T>(url: string, headers: Record<string, string>, what: string): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Slack ${what} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as T & { ok: boolean; error?: string };
  if (!body.ok) {
    throw new Error(`Slack API error: ${body.error ?? 'unknown'}`);
  }
  return body;
}

/**
 * Every channel the bot is a member of. Membership is the filter because
 * `conversations.history` refuses anything else.
 * @param baseUrl - Slack API base.
 * @param headers - Auth header for the bot token.
 * @param includePrivate - Include private channels the bot was invited to.
 */
async function memberChannels(baseUrl: string, headers: Record<string, string>, includePrivate: boolean): Promise<SlackChannel[]> {
  const types = includePrivate ? 'public_channel,private_channel' : 'public_channel';
  const out: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ types, limit: '200', exclude_archived: 'true' });
    if (cursor) {
      params.set('cursor', cursor);
    }
    const body = await slackGet<SlackConversations>(`${baseUrl}/conversations.list?${params.toString()}`, headers, 'conversations.list');
    out.push(...(body.channels ?? []).filter(c => c.is_member));
    cursor = body.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

export const slackConnector: SourceConnector<typeof slackConfigSchema> = {
  slug: 'slack',
  name: 'Slack',
  description: 'Messages from Slack. One channel, or every channel the bot is in, synced incrementally by timestamp.',
  icon: 'MessageSquare',
  category: 'chat-meetings',
  brand: 'slack',
  authKind: 'oauth',
  configSchema: slackConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = slackConfigSchema.parse(ctx.config);
    const token = ctx.credentials?.token as string | undefined;
    if (!token) {
      throw new Error('Slack connector requires credentials.token');
    }
    const headers = { authorization: `Bearer ${token}` };

    const channels = cfg.channel
      ? [{ id: cfg.channel } as SlackChannel]
      : await memberChannels(cfg.baseUrl, headers, cfg.includePrivate === true);

    for (const ch of channels) {
      // `ctx.cursor` is one channel's pagination cursor, so it only means
      // anything for the single-channel form. Sweeping many, each channel
      // paginates from the start and `ctx.since` carries the incrementality.
      let cursor = cfg.channel ? (ctx.cursor ?? undefined) : undefined;
      do {
        const params = new URLSearchParams({ channel: ch.id, limit: '200' });
        if (ctx.since) {
          params.set('oldest', String(Math.floor(ctx.since.getTime() / 1000)));
        }
        if (cursor) {
          params.set('cursor', cursor);
        }
        const body = await slackGet<SlackHistory>(`${cfg.baseUrl}/conversations.history?${params.toString()}`, headers, 'history');
        for (const m of body.messages ?? []) {
          ctx.onProgress?.({ kind: 'fetched', uri: m.ts });
          yield {
            externalId: `slack:${ch.id}:${m.ts}`,
            title: ch.name ? `#${ch.name} · ${m.ts}` : `Message ${m.ts}`,
            content: m.text ?? '',
            lastModifiedAt: new Date(Number(m.ts) * 1000),
            metadata: { kind: 'slack-message', channel: ch.id, channelName: ch.name, user: m.user },
          };
        }
        cursor = body.response_metadata?.next_cursor || undefined;
      } while (cursor);
    }
  },
};
