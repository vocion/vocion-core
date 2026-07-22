/**
 * freshen_source — a gen-time supplemental pull. Runs an INCREMENTAL sync of a
 * connected source (only what changed since the last watermark) so an answer
 * reflects up-to-the-minute data instead of a possibly-stale scheduled sync.
 * The founder-brief use case: freshen `gmail` right before a daily brief / a
 * "what should I do" overview so recent sent+received mail is in the index.
 *
 * Fast (incremental, not a full re-sync) and degrades gracefully when a source
 * has no credentials or the sync errors — the agent then works from the last
 * synced data and can say so.
 */
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

export function freshenSourceTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const slug = String((args as { source?: string }).source ?? 'gmail').trim();
      const [src] = await db
        .select({ id: knowledgeSourceSchema.id })
        .from(knowledgeSourceSchema)
        .where(and(eq(knowledgeSourceSchema.orgId, ctx.orgId), eq(knowledgeSourceSchema.slug, slug)))
        .limit(1);
      if (!src) {
        return `No "${slug}" source is connected for this workspace — nothing to freshen.`;
      }
      try {
        const { runSync } = await import('@/services/SourceSyncService');
        let fetched = 0;
        await runSync({
          orgId: ctx.orgId,
          sourceId: src.id,
          incremental: true,
          onProgress: (e) => { if (e.kind === 'fetched') { fetched += 1; } },
        });
        return fetched > 0
          ? `Freshened ${slug}: pulled ${fetched} new/updated item${fetched === 1 ? '' : 's'} since the last sync — search + records now reflect the latest.`
          : `Freshened ${slug}: already up to date (no new items since the last sync).`;
      } catch (err) {
        return `Couldn't freshen ${slug} just now (${String((err as Error).message).slice(0, 120)}). Working from the last synced data — flag to the user that recent items may be missing.`;
      }
    },
    {
      name: 'freshen_source',
      description: 'Pull the latest from a connected source (INCREMENTAL — only what changed since the last sync) so your answer reflects up-to-the-minute data. Use before a daily brief or a "what should I do" overview when recency matters — e.g. freshen "gmail" to catch sent+received mail from the last hours. Fast; degrades gracefully if the source lacks credentials.',
      schema: z.object({ source: z.string().optional().describe('Source slug to freshen, e.g. "gmail". Defaults to gmail.') }),
    },
  );
}
