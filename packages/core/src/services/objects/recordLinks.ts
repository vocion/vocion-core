import type { LinkMap } from '@/features/dashboard/pages/FieldValue';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { recordLinkKey } from '@/features/dashboard/pages/FieldValue';
import { db } from '@/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';

/**
 * Turning a reference into a link a person can read.
 *
 * A record carries its neighbours as bare handles — `requestId: 41`,
 * `repoSlug: squatch-core`, `taskIds: [12, 13]` — and every surface that
 * showed one showed the handle. This resolves a batch of them to
 * `{href, label}` in one query per target type, so "Asked by 41" becomes
 * the request someone actually filed, by its own title.
 *
 * A handle that resolves to nothing is simply absent from the map; the
 * cell then keeps showing the handle rather than a dead link.
 */

export type RecordRef = { to: string; value: unknown };

/**
 * A numeric id, or null when the handle is a slug.
 * @param value - The raw handle.
 */
function asId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
  return n !== null && Number.isSafeInteger(n) ? n : null;
}

/**
 * Resolve every reference in one pass — one query per distinct target type,
 * matching on the record's own id and on its `slug` metadata key, which is
 * how the registries (`repo`, `product`) are named.
 * @param orgId - The tenant.
 * @param refs - Every `{to, value}` the page is about to draw.
 */
export async function resolveRecordLinks(orgId: string, refs: RecordRef[]): Promise<LinkMap> {
  const byType = new Map<string, unknown[]>();
  for (const r of refs) {
    if (r.value === undefined || r.value === null || r.value === '') {
      continue;
    }
    byType.set(r.to, [...(byType.get(r.to) ?? []), r.value]);
  }
  if (byType.size === 0) {
    return {};
  }

  const types = await db.query.businessObjectTypeSchema.findMany({
    where: and(eq(businessObjectTypeSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, [...byType.keys()])),
  });

  const out: LinkMap = {};
  for (const type of types) {
    const values = byType.get(type.slug) ?? [];
    const ids = [...new Set(values.map(asId).filter((n): n is number => n !== null))];
    const slugs = [...new Set(values.filter(v => asId(v) === null).map(String))];
    const clauses = [
      ids.length > 0 ? inArray(businessObjectSchema.id, ids) : null,
      // `metadata ->> 'slug'` — a fixed key, never caller-supplied.
      slugs.length > 0 ? inArray(sql`${businessObjectSchema.metadata} ->> 'slug'`, slugs) : null,
    ].filter(c => c !== null);
    if (clauses.length === 0) {
      continue;
    }
    const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.typeId, type.id), clauses.length === 1 ? clauses[0] : or(...clauses)));
    for (const row of rows) {
      const link = { href: `/dashboard/objects/${row.id}`, label: row.title };
      out[recordLinkKey(type.slug, row.id)] = link;
      const slug = (row.metadata as Record<string, unknown> | null)?.slug;
      if (typeof slug === 'string' && slug !== '') {
        out[recordLinkKey(type.slug, slug)] = link;
      }
    }
  }
  return out;
}
