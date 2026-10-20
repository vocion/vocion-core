/**
 * How many live records each of several object types holds in an org — one
 * query, keyed by type slug. Live is `active` or `approved`: a record filed
 * through Review lands `approved` (`objects.propose_candidate`), and counting
 * only `active` left Finance's setup saying "create the first entity" beside
 * an approved one (2026-10-20). Candidates and rejected records do not count.
 * Used where a page or a judgement needs "does this type have anything yet"
 * without loading rows (`services/plugins/setupState.ts`).
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';

const LIVE_STATUSES = ['active', 'approved'];

/**
 * Live record counts by type slug. A type with no rows, or no type row at
 * all in this org, is simply absent from the result.
 * @param orgId - Tenant.
 * @param typeSlugs - The type slugs to count; empty returns `{}` without a query.
 */
export async function countActiveRecordsByType(orgId: string, typeSlugs: readonly string[]): Promise<Record<string, number>> {
  if (typeSlugs.length === 0) {
    return {};
  }
  const rows = await db
    .select({
      slug: businessObjectTypeSchema.slug,
      count: sql<number>`count(${businessObjectSchema.id})::int`,
    })
    .from(businessObjectTypeSchema)
    .leftJoin(businessObjectSchema, and(
      eq(businessObjectSchema.typeId, businessObjectTypeSchema.id),
      eq(businessObjectSchema.orgId, orgId),
      inArray(businessObjectSchema.status, LIVE_STATUSES),
    ))
    .where(and(eq(businessObjectTypeSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, [...typeSlugs])))
    .groupBy(businessObjectTypeSchema.slug);
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.slug] = Number(row.count) || 0;
  }
  return out;
}
