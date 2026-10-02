import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { CANDIDATE_EXTRACTOR_SLUG } from '@/libs/processors/candidateExtractor/config';
import { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';

/**
 * Give every repeating calendar entry the candidate extractor already
 * finished on a revisit time of now.
 *
 * A run that finished before a processor could say when its output goes stale
 * stored no time, so an entry whose text never changes is never read again
 * and its dates stop at the horizon it was first read to. Marked due, the next
 * sync reads it once more, and that run stores its own revisit time.
 *
 * Idempotent (an entry with a revisit time is skipped; a re-run marks nothing)
 * and dry by default: without `apply` it only counts.
 */

export type RevisitBackfillCounts = {
  /** Repeating entries finished on their current text, with no revisit time. */
  matched: number;
  /** Given one (apply only). */
  marked: number;
  /** `matched` by `<org id>/<source slug>`. */
  bySource: Record<string, number>;
};

const BATCH = 500;

/**
 * Count, and with `apply` mark, the repeating entries to read again.
 * @param opts - What to do.
 * @param opts.orgId - One workspace; every workspace when omitted.
 * @param opts.apply - Set their revisit time to now; otherwise only count.
 */
export async function backfillProcessorRevisits(opts: { orgId?: string; apply?: boolean } = {}): Promise<RevisitBackfillCounts> {
  const doc = knowledgeDocumentSchema;
  const chunk = knowledgeChunkSchema;
  const rows = await db
    .select({ id: doc.id, orgId: doc.orgId, sourceSlug: knowledgeSourceSchema.slug })
    .from(doc)
    .innerJoin(knowledgeSourceSchema, eq(knowledgeSourceSchema.id, doc.sourceId))
    .where(and(
      opts.orgId ? eq(doc.orgId, opts.orgId) : undefined,
      sql`${knowledgeSourceSchema.configJson} -> '_processor' ->> 'slug' = ${CANDIDATE_EXTRACTOR_SLUG}`,
      sql`jsonb_typeof(${doc.metadata} -> 'feedUrl') = 'string'`,
      sql`${doc.metadata} -> 'endsOn' is null`,
      eq(doc.processedHash, doc.contentHash),
      isNull(doc.processorRevisitAt),
      sql`exists (select 1 from ${chunk} where ${chunk.documentId} = ${doc.id} and ${chunk.chunkIdx} = 0 and ${chunk.content} ~* '^BEGIN:VEVENT')`,
      sql`exists (select 1 from ${chunk} where ${chunk.documentId} = ${doc.id} and ${chunk.content} ~* ${'(^|\n)RRULE[:;]'})`,
    ))
    .orderBy(doc.id);
  const counts: RevisitBackfillCounts = { matched: rows.length, marked: 0, bySource: {} };
  for (const row of rows) {
    const key = `${row.orgId}/${row.sourceSlug}`;
    counts.bySource[key] = (counts.bySource[key] ?? 0) + 1;
  }
  if (!opts.apply) {
    return counts;
  }
  for (let i = 0; i < rows.length; i += BATCH) {
    const marked = await db
      .update(doc)
      .set({ processorRevisitAt: new Date() })
      .where(and(inArray(doc.id, rows.slice(i, i + BATCH).map(r => r.id)), isNull(doc.processorRevisitAt)))
      .returning({ id: doc.id });
    counts.marked += marked.length;
  }
  return counts;
}
