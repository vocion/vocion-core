/**
 * The source read the connect routes need: a row by slug within an org.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

export type ConnectableSource = {
  id: number;
  slug: string;
  connectorSlug: string;
};

/**
 * The org's source with this slug, or null.
 * @param orgId - The workspace.
 * @param slug - The source slug.
 */
export async function findSourceBySlug(orgId: string, slug: string): Promise<ConnectableSource | null> {
  const [row] = await db
    .select({
      id: knowledgeSourceSchema.id,
      slug: knowledgeSourceSchema.slug,
      configJson: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, slug)))
    .limit(1);
  if (!row) {
    return null;
  }
  const connector = (row.configJson as Record<string, unknown> | null)?._connector;
  return { id: row.id, slug: row.slug, connectorSlug: typeof connector === 'string' ? connector : row.slug };
}
