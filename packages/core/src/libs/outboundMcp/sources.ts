import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

export const mcpConfigSchema = z.object({
  // Declared by a workspace adapter; onboarding only, never a native-tool grant.
  providesFamilies: z.array(z.string().min(1)).default([]),
  readTools: z.array(z.string().min(1)).default([]),
  writeTools: z.array(z.string().min(1)).default([]),
  // `token`: one vaulted endpoint and bearer token for the whole workspace.
  // `person`: each person signs in to the server's own OAuth and every call
  // runs as the person in the turn (`services/outboundMcp/personSignIn.ts`).
  auth: z.enum(['token', 'person']).default('token'),
  // The endpoint of a `person` source. A `token` source keeps it in the vault.
  url: z.string().url().refine(url => url.startsWith('https://'), 'The MCP endpoint must be HTTPS').optional(),
})
  .refine(config => !config.readTools.some(name => config.writeTools.includes(name)), 'A tool cannot be both read and write')
  .refine(config => config.auth !== 'person' || config.url, 'A per-person MCP source names its endpoint in url')
  // A write runs when a reviewer approves it, not as the person who asked.
  .refine(config => config.auth !== 'person' || config.writeTools.length === 0, 'A per-person MCP source cannot declare writes');

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
    return parsed.success ? [{ slug: row.slug, name: typeof row.config._name === 'string' && row.config._name.trim() ? row.config._name : row.slug, config: parsed.data }] : [];
  });
}
