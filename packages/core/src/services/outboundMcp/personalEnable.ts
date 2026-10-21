/**
 * A per-person MCP server in a person's Personal workspace.
 *
 * A server declared `auth: person` in any workspace the person belongs to can
 * be enabled in their Personal with one press: the source is copied in as
 * declared and the personal assistant is given it. The grant is already kept
 * in Personal (`personSignIn.ts`), so a sign-in made from a team workspace
 * serves it too, and every read is still the person's own.
 */

import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { storedProcessorNames, upsertSourceRow } from '@/libs/sources/upsert';
import { agentSchema, knowledgeSourceSchema, projectSchema } from '@/models/Schema';
import { ownPersonalWorkspace } from '@/services/personal/connections';
import { personalAssistantSlug } from '@/services/workspace/personalAssistant';
import { accessibleProjectIds } from '@/services/WorkspaceAccessService';

/** A server the person could enable in Personal, and the workspace that declares it. */
export type PersonalMcpOffer = { fromOrgId: string; fromWorkspace: string; slug: string; name: string; url: string };

/**
 * The per-person MCP servers of the person's other workspaces that their
 * Personal does not have yet, one per endpoint.
 * @param userId - The person.
 * @param personalId - Their Personal workspace.
 */
export async function personalMcpOffers(userId: string, personalId: string): Promise<PersonalMcpOffer[]> {
  if (!(await ownPersonalWorkspace(personalId, userId))) {
    return [];
  }
  const others = (await accessibleProjectIds(userId)).filter(id => id !== personalId);
  if (others.length === 0) {
    return [];
  }
  const rows = await db
    .select({ orgId: knowledgeSourceSchema.orgId, slug: knowledgeSourceSchema.slug, workspace: projectSchema.name })
    .from(knowledgeSourceSchema)
    .innerJoin(projectSchema, eq(projectSchema.id, knowledgeSourceSchema.orgId))
    .where(and(inArray(knowledgeSourceSchema.orgId, others), ne(knowledgeSourceSchema.enabled, 'false')));
  const have = new Set((await loadMcpSources(personalId, await mcpSlugs(personalId))).map(s => s.config.url));
  const offers = new Map<string, PersonalMcpOffer>();
  for (const orgId of new Set(rows.map(r => r.orgId))) {
    const inOrg = rows.filter(r => r.orgId === orgId);
    for (const source of await loadMcpSources(orgId, inOrg.map(r => r.slug))) {
      const url = source.config.url;
      if (source.config.auth !== 'person' || !url || have.has(url) || offers.has(url)) {
        continue;
      }
      offers.set(url, { fromOrgId: orgId, fromWorkspace: inOrg[0]!.workspace, slug: source.slug, name: source.name, url });
    }
  }
  return [...offers.values()];
}

/**
 * Slugs of the MCP sources a workspace holds.
 * @param orgId - The workspace.
 */
async function mcpSlugs(orgId: string): Promise<string[]> {
  const rows = await db.select({ slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId));
  return rows.filter(r => r.config._connector === 'mcp').map(r => r.slug);
}

/**
 * Enable one offered server in the person's Personal: the source as declared,
 * given to their assistant. Refuses anything not on the offer list.
 * @param input - The person, their Personal, and the offer.
 * @param input.userId - The person.
 * @param input.personalId - Their Personal workspace.
 * @param input.fromOrgId - The workspace that declares the server.
 * @param input.slug - Its source slug there.
 */
export async function enablePersonalMcp(input: { userId: string; personalId: string; fromOrgId: string; slug: string }): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const offer = (await personalMcpOffers(input.userId, input.personalId)).find(o => o.fromOrgId === input.fromOrgId && o.slug === input.slug);
  if (!offer) {
    return { ok: false, error: 'That server is not one you can enable in Personal, or it is already enabled.' };
  }
  const [source] = await loadMcpSources(input.fromOrgId, [input.slug]);
  if (!source) {
    return { ok: false, error: 'That server is no longer declared.' };
  }
  await upsertSourceRow(input.personalId, { slug: source.slug, name: source.name, kind: 'mcp', config: { auth: 'person', url: offer.url, readTools: source.config.readTools, writeTools: [] }, enabled: true }, { known: await storedProcessorNames(input.personalId) });
  const assistant = personalAssistantSlug();
  const [agent] = await db.select({ id: agentSchema.id, connectorSources: agentSchema.connectorSources }).from(agentSchema).where(and(eq(agentSchema.orgId, input.personalId), eq(agentSchema.slug, assistant))).limit(1);
  if (agent && !(agent.connectorSources ?? []).includes(source.slug)) {
    await db.update(agentSchema).set({ connectorSources: [...(agent.connectorSources ?? []), source.slug] }).where(eq(agentSchema.id, agent.id));
  }
  return { ok: true, name: source.name };
}
