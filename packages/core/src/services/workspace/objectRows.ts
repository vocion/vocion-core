import type { PageRow } from '@/libs/workspace/pageFields';
import { and, eq } from 'drizzle-orm';
import { recordCode } from '@/libs/codes';
import { db } from '@/libs/DB';
import { businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';
import { typeCodesForOrg } from '@/services/codes';

/**
 * Every record of one object type in a workspace, as page rows — the shape
 * a list page, a derivation and a record's own overview all read. One
 * loader, so the Products board and a product's overview count the same
 * requests and releases the same way.
 *
 * Scoped by the TYPE, which is the org's own row: a type slug that another
 * workspace also uses resolves to this org's type and nothing else.
 * @param orgId - The workspace.
 * @param typeSlug - The object type's slug (`product`, `request`, `release`).
 */
export async function loadObjectRows(orgId: string, typeSlug: string): Promise<PageRow[]> {
  const objType = await db.query.businessObjectTypeSchema.findFirst({
    where: and(eq(businessObjectTypeSchema.slug, typeSlug), eq(businessObjectTypeSchema.orgId, orgId)),
  });
  if (!objType) {
    return [];
  }
  const rows = await db.query.businessObjectSchema.findMany({
    where: eq(businessObjectSchema.typeId, objType.id),
  });
  // Every row carries the code a person reads it by (FE-294, `libs/codes.ts`).
  const codes = await typeCodesForOrg(orgId).catch(() => null);
  return rows.map(r => ({
    id: r.id,
    code: recordCode(codes, typeSlug, r.id),
    title: r.title,
    status: r.status ?? null,
    createdAt: r.createdAt ?? null,
    meta: (r.metadata ?? {}) as Record<string, unknown>,
  }));
}
