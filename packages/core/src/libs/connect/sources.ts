/**
 * The two source reads the connect routes need: a row by slug within an org,
 * and clearing a workspace-credential link so the grant just stored is the
 * one the connector uses (`getCredentialsForSource` prefers a linked
 * `api_token` row over the install's `source_credential`).
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

/**
 * Forget a pasted workspace credential the source pointed at, so the grant
 * stored on its install is what resolves next.
 * @param orgId - The workspace.
 * @param sourceId - The source row.
 */
export async function clearLinkedCredential(orgId: string, sourceId: number): Promise<void> {
  await db
    .update(knowledgeSourceSchema)
    .set({ apiTokenId: null, apiTokenExclusive: false })
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId)));
}
