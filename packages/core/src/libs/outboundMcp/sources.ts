import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

export const mcpConfigSchema = z.object({
  // Declared by a workspace adapter; onboarding only, never a native-tool grant.
  providesFamilies: z.array(z.string().min(1)).default([]),
  readTools: z.array(z.string().min(1)).default([]),
  writeTools: z.array(z.string().min(1)).default([]),
  // Requests rather than changes of record (file a ticket, answer a question
  // the other system asked): run on the person's word, and for an agent on
  // its own under the workspace's trust rule `mcp.act.<source>.<tool>`.
  actTools: z.array(z.string().min(1)).default([]),
  // A declared read that returns what the people who asked should hear now:
  // `{updates: [{id, conversation, text, url?, asks?}]}`, acknowledged by
  // calling it again with `{ack: [ids]}` (`services/jobs/mcpUpdates.ts`).
  updatesTool: z.string().min(1).optional(),
  // The provider's tool that takes `{url}`: where it should say "check now"
  // the moment it has an update (`services/outboundMcp/updatesPing.ts`).
  // With it the source is event-driven and the schedule is only a sweep.
  updatesWatchTool: z.string().min(1).optional(),
  // `token`: one vaulted endpoint and bearer token for the whole workspace.
  // `person`: each person signs in to the server's own OAuth and every call
  // runs as the person in the turn (`services/outboundMcp/personSignIn.ts`).
  auth: z.enum(['token', 'person']).default('token'),
  // The endpoint of a `person` source. A `token` source keeps it in the vault.
  url: z.string().url().refine(url => url.startsWith('https://'), 'The MCP endpoint must be HTTPS').optional(),
})
  .refine(config => !config.readTools.some(name => config.writeTools.includes(name)), 'A tool cannot be both read and write')
  .refine(config => !config.actTools.some(name => config.readTools.includes(name) || config.writeTools.includes(name)), 'An act tool cannot also be a read or a reviewed write')
  .refine(config => !config.updatesTool || config.readTools.includes(config.updatesTool), 'The updates tool must be one of the declared reads')
  .refine(config => !config.updatesWatchTool || (Boolean(config.updatesTool) && config.actTools.includes(config.updatesWatchTool)), 'The updates watch tool must be one of the declared act tools, on a source that names an updates tool')
  .refine(config => config.auth !== 'person' || config.actTools.length === 0, 'A per-person MCP source cannot declare act tools')
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

/**
 * Every MCP source of a workspace, for work that serves no one agent (the updates job).
 * @param orgId - The owning workspace.
 */
export async function listMcpSources(orgId: string) {
  const rows = await db.select({ slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'mcp'`));
  return rows.flatMap((row) => {
    const parsed = mcpConfigSchema.safeParse(row.config);
    return parsed.success ? [{ slug: row.slug, name: typeof row.config._name === 'string' && row.config._name.trim() ? row.config._name : row.slug, config: parsed.data }] : [];
  });
}
