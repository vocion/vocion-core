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
import { and, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

export function freshenSourceTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const slug = String((args as { source?: string }).source ?? 'gmail').trim();
      // Match the slug exactly, OR treat it as a CONNECTOR family and freshen
      // every source built on that connector. HubSpot is split across three
      // sources — deals (`hubspot`), `hubspot-contacts`, `hubspot-companies` —
      // so freshening only the exact slug left contacts and companies stale
      // while reporting success. The connector identity lives in
      // `config_json->>'_connector'`; `kind` is always `plugin`.
      const rows = await db
        .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug })
        .from(knowledgeSourceSchema)
        .where(and(
          eq(knowledgeSourceSchema.orgId, ctx.orgId),
          or(
            eq(knowledgeSourceSchema.slug, slug),
            sql`${knowledgeSourceSchema.configJson} ->> '_connector' = ${slug}`,
          ),
        ));
      if (rows.length === 0) {
        return `No "${slug}" source is connected for this workspace — nothing to freshen.`;
      }
      const { runSync } = await import('@/services/SourceSyncService');
      const done: string[] = [];
      const failed: string[] = [];
      let fetched = 0;
      for (const src of rows) {
        try {
          await runSync({
            orgId: ctx.orgId,
            sourceId: src.id,
            incremental: true,
            onProgress: (e) => {
              if (e.kind === 'fetched') {
                fetched += 1;
              }
            },
          });
          done.push(src.slug);
        } catch (err) {
          failed.push(`${src.slug} (${String((err as Error).message).slice(0, 80)})`);
        }
      }
      if (done.length === 0) {
        return `Couldn't freshen ${slug} just now: ${failed.join('; ')}. Working from the last synced data — flag to the user that recent items may be missing.`;
      }
      const scope = done.join(', ');
      const tail = failed.length > 0 ? ` Could not freshen ${failed.join('; ')}, so data from those may be stale.` : '';
      return fetched > 0
        ? `Freshened ${scope}: pulled ${fetched} new/updated item${fetched === 1 ? '' : 's'} since the last sync — search + records now reflect the latest.${tail}`
        : `Freshened ${scope}: already up to date (no new items since the last sync).${tail}`;
    },
    {
      name: 'freshen_source',
      description: 'Pull the latest from a connected source (INCREMENTAL — only what changed since the last sync) so your answer reflects up-to-the-minute data. Use before a daily brief or a "what should I do" overview when recency matters — e.g. freshen "gmail" to catch sent+received mail from the last hours, or "hubspot" before a CRM count that has to be current. Accepts a source FAMILY: "hubspot" freshens deals, contacts, and companies together. Fast; degrades gracefully if the source lacks credentials.',
      schema: z.object({ source: z.string().optional().describe('Source slug or family to freshen, e.g. "gmail" or "hubspot". Defaults to gmail.') }),
    },
  );
}
