/**
 * Slack connector — ingest channel messages as retrievable documents (RevOps).
 *
 * Auth: bot/user token in `ctx.credentials.token`. Incremental: when `ctx.since`
 * is set, `oldest` is that epoch second. Paginates `response_metadata.next_cursor`.
 * Slack returns `ok: false` on error.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';

const slackConfigSchema = z.object({
  /** Channel id to read history from (e.g. `C0123ABCD`). */
  channel: z.string().min(1),
  baseUrl: z.string().url().default('https://slack.com/api'),
});

type SlackMessage = { ts: string; user?: string; text?: string; subtype?: string };
type SlackHistory = {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

export const slackConnector: SourceConnector<typeof slackConfigSchema> = {
  slug: 'slack',
  name: 'Slack',
  description: 'Ingest messages from a Slack channel — incremental by timestamp.',
  icon: 'MessageSquare',
  authKind: 'oauth',
  configSchema: slackConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = slackConfigSchema.parse(ctx.config);
    const token = ctx.credentials?.token as string | undefined;
    if (!token) {
      throw new Error('Slack connector requires credentials.token');
    }
    const headers = { authorization: `Bearer ${token}` };

    let cursor = ctx.cursor ?? undefined;
    do {
      const params = new URLSearchParams({ channel: cfg.channel, limit: '200' });
      if (ctx.since) {
        params.set('oldest', String(Math.floor(ctx.since.getTime() / 1000)));
      }
      if (cursor) {
        params.set('cursor', cursor);
      }
      const res = await fetch(`${cfg.baseUrl}/conversations.history?${params.toString()}`, { headers });
      if (!res.ok) {
        throw new Error(`Slack history failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const body = (await res.json()) as SlackHistory;
      if (!body.ok) {
        throw new Error(`Slack API error: ${body.error ?? 'unknown'}`);
      }
      for (const m of body.messages ?? []) {
        ctx.onProgress?.({ kind: 'fetched', uri: m.ts });
        yield {
          externalId: `slack:${cfg.channel}:${m.ts}`,
          title: `Message ${m.ts}`,
          content: m.text ?? '',
          lastModifiedAt: new Date(Number(m.ts) * 1000),
          metadata: { kind: 'slack-message', channel: cfg.channel, user: m.user },
        };
      }
      cursor = body.response_metadata?.next_cursor || undefined;
    } while (cursor);
  },
};
