/**
 * WHAT THE ALL WORKSPACES PAGE KNOWS ABOUT EACH WORKSPACE (founder,
 * 2026-10-09: "This isn't a great UI" — big cards that said "No agents yet").
 *
 * The same workspaces the switcher lists (`listProjectsForUser`: someone
 * else's Personal never, a grant-less workspace never with enforcement on),
 * archived ones included and flagged, each with the three facts a person
 * picks a workspace by:
 *
 * - **who leads it** — the workspace lead (`project.lead_agent_slug`), named
 *   the way the chat names it (`libs/workspace/leadName.ts`), else the one
 *   agent with no parent when there is exactly one;
 * - **how much is there** — its agents;
 * - **when it was last used** — the latest conversation or recorded activity.
 *
 * One query for all of them (correlated subqueries on indexed `org_id`
 * columns), never one per workspace. What is waiting on the person is NOT
 * here: that is the cross-workspace badge's count (`inbox.mineCount`), read by
 * the page on its own so one definition of "needs you" serves both.
 */

import type { AccountSummary, ProjectSummary } from '@/services/ProjectService';
import { inArray, sql } from 'drizzle-orm';
import { brandView } from '@/libs/branding/orgBrand';
import { db } from '@/libs/DB';
import { leadName, leadWorkspaceLabel } from '@/libs/workspace/leadName';
import { projectSchema } from '@/models/Schema';
import { getOrgBrand } from '@/services/branding/OrgBrandService';
import { accountsForUser, listProjectsForUser } from '@/services/ProjectService';

export type WorkspaceOverview = ProjectSummary & {
  /** Who leads it, as the chat names them. Null when nobody does. */
  leadName: string | null;
  /** The latest conversation or recorded activity, ISO. Null when it has never been used. */
  lastActiveAt: string | null;
};

/** An Org's square mark, when its brand has one: the rows' avatar. */
export type OrgMark = { light: string; dark?: string };

type Facts = { id: string; leadAgentName: string | null; leadSlug: string | null; soleLeadName: string | null; lastActiveAt: string | null };

/**
 * The facts per workspace, in one round trip.
 * @param ids - The workspaces.
 */
async function factsFor(ids: string[]): Promise<Map<string, Facts>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: projectSchema.id,
      leadSlug: projectSchema.leadAgentSlug,
      leadAgentName: sql<string | null>`(select a."name" from "agent" a where a."org_id" = "project"."id" and a."slug" = "project"."lead_agent_slug" limit 1)`,
      soleLeadName: sql<string | null>`(select case when count(*) = 1 then min(a."name") end from "agent" a where a."org_id" = "project"."id" and a."parent_agent_slug" is null)`,
      // The columns are timestamps without a zone, written in UTC; read back
      // raw through `sql` they would parse as local time, so say UTC here.
      lastActiveAt: sql<string | null>`to_char(greatest(
        (select max(c."updated_at") from "conversation" c where c."org_id" = "project"."id"),
        (select max(e."created_at") from "user_activity_event" e where e."org_id" = "project"."id")
      ), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(projectSchema)
    .where(inArray(projectSchema.id, ids));
  return new Map(rows.map(r => [r.id, r]));
}

/**
 * Every workspace the person can open, with what the page shows of each, the
 * Orgs they belong to, and each Org's mark when it has one.
 * @param userId - The person.
 */
export async function workspaceOverviewForUser(userId: string): Promise<{ workspaces: WorkspaceOverview[]; accounts: AccountSummary[]; marks: Record<string, OrgMark> }> {
  const [projects, accounts] = await Promise.all([listProjectsForUser(userId), accountsForUser(userId)]);
  const facts = await factsFor(projects.map(p => p.id));
  const accountName = new Map(accounts.map(a => [a.id, a.name]));
  const workspaces = projects.map((p): WorkspaceOverview => {
    const f = facts.get(p.id);
    const agentName = f?.leadSlug ? f.leadAgentName : f?.soleLeadName ?? null;
    const at = f?.lastActiveAt ?? null;
    return {
      ...p,
      leadName: agentName === null || agentName === undefined ? null : leadName({ agentName, workspaceLabel: leadWorkspaceLabel(accountName.get(p.accountId), p.name) }).short,
      lastActiveAt: at === null ? null : new Date(at).toISOString(),
    };
  });
  const marks: Record<string, OrgMark> = {};
  await Promise.all(accounts.map(async (a) => {
    const brand = await getOrgBrand(a.id).catch(() => null);
    const mark = brand ? brandView(brand, { whiteLabel: false }).mark : null;
    if (mark?.light) {
      marks[a.id] = { light: mark.light, ...(mark.dark ? { dark: mark.dark } : {}) };
    }
  }));
  return { workspaces, accounts, marks };
}
