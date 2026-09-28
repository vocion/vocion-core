import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactSchema, businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';
import { recordBody } from './recordBody';
import { RECORD_BODY_ROLE, recordBodyEnabled } from './recordBodyFormat';

/**
 * Give every existing record its body artifact (backlog 035).
 *
 * #815 created a body on a record's first write, and only for `request`.
 * Every type now carries one, and a record nobody has written since has no
 * v1 — no history to read, nothing for the artifact path to revise. This
 * creates the missing bodies from the rows, exactly as `recordBody` would on
 * first use, so v1 is what the record says today.
 *
 * Idempotent (a record with a body is skipped; a re-run creates nothing) and
 * dry by default: without `apply` it only counts. Additive: it writes
 * artifacts and touches no row.
 */

export type BackfillCounts = {
  /** Records looked at. */
  records: number;
  /** Already had a body. */
  withBody: number;
  /** Of a type that opts out (`x-record-body: false`). */
  optedOut: number;
  /** Had no body and would get one (dry run) / got one (apply). */
  missing: number;
  created: number;
  failed: number;
  /** `missing` by type slug. */
  byType: Record<string, number>;
};

/**
 * Count, and with `apply` create, the missing record bodies.
 * @param opts - What to do.
 * @param opts.orgId - One workspace; every workspace when omitted.
 * @param opts.apply - Create the bodies; otherwise only count.
 * @param opts.log - Where failures are said.
 */
export async function backfillRecordBodies(opts: { orgId?: string; apply?: boolean; log?: (line: string) => void } = {}): Promise<BackfillCounts> {
  const log = opts.log ?? (() => {});
  const rows = await db
    .select({ id: businessObjectSchema.id, orgId: businessObjectSchema.orgId, typeSlug: businessObjectTypeSchema.slug, schema: businessObjectTypeSchema.schema })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(opts.orgId ? eq(businessObjectSchema.orgId, opts.orgId) : undefined)
    .orderBy(businessObjectSchema.id);
  const bodies = await db
    .select({ orgId: artifactSchema.orgId, recordId: artifactSchema.recordId })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.recordType, 'object'), eq(artifactSchema.recordRole, RECORD_BODY_ROLE), opts.orgId ? eq(artifactSchema.orgId, opts.orgId) : undefined));
  const has = new Set(bodies.map(b => `${b.orgId}:${b.recordId}`));
  const counts: BackfillCounts = { records: rows.length, withBody: 0, optedOut: 0, missing: 0, created: 0, failed: 0, byType: {} };
  for (const row of rows) {
    if (has.has(`${row.orgId}:${row.id}`)) {
      counts.withBody += 1;
      continue;
    }
    if (!recordBodyEnabled(row.typeSlug, row.schema as Record<string, unknown> | null)) {
      counts.optedOut += 1;
      continue;
    }
    counts.missing += 1;
    counts.byType[row.typeSlug] = (counts.byType[row.typeSlug] ?? 0) + 1;
    if (!opts.apply) {
      continue;
    }
    try {
      const body = await recordBody(row.orgId, row.id);
      if (body) {
        counts.created += 1;
      } else {
        counts.failed += 1;
        log(`record #${row.id} (${row.typeSlug}): no body was created`);
      }
    } catch (err) {
      counts.failed += 1;
      log(`record #${row.id} (${row.typeSlug}): ${(err as Error).message}`);
    }
  }
  return counts;
}
