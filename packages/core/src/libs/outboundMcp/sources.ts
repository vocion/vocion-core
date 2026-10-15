import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

export const mcpConfigSchema = z.object({
  readTools: z.array(z.string().min(1)).default([]),
  writeTools: z.array(z.string().min(1)).default([]),
}).refine(config => !config.readTools.some(name => config.writeTools.includes(name)), 'A tool cannot be both read and write');

/**
 * Source ownership and connector type are enforced in the database query.
 * @param orgId - The owning workspace.
 * @param slugs - The permitted source slugs.
 */
export async function loadMcpSources(orgId: string, slugs: readonly string[]) {
  if (!slugs.length) {
    return [];
  }
  const rows = await db.select({ slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), inArray(knowledgeSourceSchema.slug, [...slugs]), sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'mcp'`));
  return rows.flatMap((row) => {
    const parsed = mcpConfigSchema.safeParse(row.config);
    return parsed.success ? [{ slug: row.slug, config: parsed.data }] : [];
  });
}
