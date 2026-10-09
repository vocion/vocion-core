/**
 * The seeded lead's name on a server-rendered page: "Ava · Revenue lead", or
 * "Revenue lead", computed from the workspace's current name
 * (`libs/workspace/leadName.ts`). One read of the workspace and its Org per
 * page; every other agent keeps its own name.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { isSeededLead, LEAD_PLACEHOLDER_NAME, leadName, leadWorkspaceLabel } from '@/libs/workspace/leadName';
import { WORKSPACE_LEAD_SLUG } from '@/libs/workspace/workspaceLead';
import { agentSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';

/**
 * The workspace's short name a lead's role is built from.
 * @param orgId - The workspace.
 */
export async function leadWorkspaceLabelFor(orgId: string): Promise<string> {
  const [row] = await db
    .select({ projectName: projectSchema.name, accountName: tenantAccountSchema.name })
    .from(projectSchema)
    .innerJoin(tenantAccountSchema, eq(projectSchema.accountId, tenantAccountSchema.id))
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return leadWorkspaceLabel(row?.accountName, row?.projectName);
}

/**
 * A namer for this workspace's agents: the seeded lead's label, every other
 * agent's own name.
 * @param orgId - The workspace.
 */
export async function agentNamer(orgId: string): Promise<{ name: (agent: { slug: string; name: string }) => string; role: string }> {
  const workspaceLabel = await leadWorkspaceLabelFor(orgId);
  return {
    name: agent => (isSeededLead(agent.slug) ? leadName({ agentName: agent.name, workspaceLabel }).label : agent.name),
    role: `${workspaceLabel} lead`,
  };
}

/** The longest given name a lead takes. */
export const LEAD_GIVEN_NAME_MAX = 40;

/**
 * Give the workspace's seeded lead a first name ("Ava"), or take it away
 * (empty): stored as the agent's own `name`, where an empty one is the
 * placeholder that reads as the role. Returns what the lead is now called.
 * @param orgId - The workspace.
 * @param given - The first name, or empty for none.
 */
export async function setSeededLeadName(orgId: string, given: string): Promise<{ label: string; given: string | null } | null> {
  const name = given.trim().replace(/\s+/g, ' ').slice(0, LEAD_GIVEN_NAME_MAX);
  const [row] = await db
    .update(agentSchema)
    .set({ name: name || LEAD_PLACEHOLDER_NAME })
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, WORKSPACE_LEAD_SLUG)))
    .returning({ name: agentSchema.name });
  if (!row) {
    return null;
  }
  const n = leadName({ agentName: row.name, workspaceLabel: await leadWorkspaceLabelFor(orgId) });
  return { label: n.label, given: n.given };
}

/**
 * This workspace's seeded lead as Brand offers to name it: its role and given
 * name, or null when the workspace has no seeded lead.
 * @param orgId - The workspace.
 */
export async function seededLeadNameFor(orgId: string): Promise<{ role: string; given: string | null } | null> {
  const [row] = await db
    .select({ name: agentSchema.name })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, WORKSPACE_LEAD_SLUG)))
    .limit(1);
  if (!row) {
    return null;
  }
  const n = leadName({ agentName: row.name, workspaceLabel: await leadWorkspaceLabelFor(orgId) });
  return { role: n.role, given: n.given };
}
