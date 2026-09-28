/**
 * Projects (workspaces) as a signed-in user may see them.
 *
 * One tenant_account owns the projects; a user reaches them through their
 * account membership. The sidebar switcher (`routers/Projects.ts`) and the
 * proxy that resolves `/w/<slug>/…` (`src/proxy.ts`) both ask "may this user
 * make that project active?" here, so the two cannot drift apart on the
 * membership rule.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';
import { accessibleProjectIds, effectiveRole, enforcementEnabled } from '@/services/WorkspaceAccessService';

export type ProjectSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Agents registered in the project — 0 means "nothing lives here yet" (the switcher hides those by default). */
  agentCount: number;
};

/** The account a user's workspaces belong to — the switcher's eyebrow. */
export type AccountSummary = { id: string; name: string; slug: string };

const summaryColumns = {
  id: projectSchema.id,
  slug: projectSchema.slug,
  name: projectSchema.name,
  description: projectSchema.description,
  // Qualified by hand: inside the subquery drizzle would render `"id"`, which
  // resolves to agent.id (integer), not project.id.
  agentCount: sql<number>`(select count(*)::int from "agent" a where a."org_id" = "project"."id")`.as('agent_count'),
};

/**
 * The account the user belongs to, or null.
 * @param userId - Auth.js user id.
 */
async function accountIdForUser(userId: string): Promise<string | null> {
  const [membership] = await db
    .select({ accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .limit(1);
  return membership?.accountId ?? null;
}

/**
 * The account the user belongs to, named — the eyebrow above the workspace
 * switcher ("Metacto"). Null when the user has no membership.
 * @param userId - Auth.js user id.
 */
export async function accountForUser(userId: string): Promise<AccountSummary | null> {
  const accountId = await accountIdForUser(userId);
  if (!accountId) {
    return null;
  }
  const [row] = await db
    .select({ id: tenantAccountSchema.id, name: tenantAccountSchema.name, slug: tenantAccountSchema.slug })
    .from(tenantAccountSchema)
    .where(eq(tenantAccountSchema.id, accountId))
    .limit(1);
  return row ?? null;
}

/**
 * Every project on the user's account — what the switcher lists.
 * @param userId - Auth.js user id.
 */
export async function listProjectsForUser(userId: string): Promise<ProjectSummary[]> {
  const accountId = await accountIdForUser(userId);
  if (!accountId) {
    return [];
  }
  const all = await db.select(summaryColumns).from(projectSchema).where(eq(projectSchema.accountId, accountId));
  if (!enforcementEnabled()) {
    return all;
  }
  // The switcher shows what a person holds, not what the account owns.
  const reachable = new Set(await accessibleProjectIds(userId));
  return all.filter(p => reachable.has(p.id));
}

/**
 * Resolve one project the user may make active, by id or by slug.
 *
 * Slug matching is case-insensitive (`Vocion-Workforce` finds
 * `vocion-workforce`) because slugs travel in mails and chat where people
 * retype them. Returns null when the project does not exist or belongs to an
 * account the user is not a member of — the caller cannot tell the two apart,
 * on purpose.
 * @param userId - Auth.js user id.
 * @param selector - `{ id }` or `{ slug }`.
 */
export async function resolveProjectForUser(userId: string, selector: { id: string } | { slug: string }): Promise<ProjectSummary | null> {
  const accountId = await accountIdForUser(userId);
  if (!accountId) {
    return null;
  }
  const match = 'id' in selector
    ? eq(projectSchema.id, selector.id)
    : eq(sql`lower(${projectSchema.slug})`, selector.slug.trim().toLowerCase());
  const [project] = await db
    .select(summaryColumns)
    .from(projectSchema)
    .where(and(eq(projectSchema.accountId, accountId), match))
    .limit(1);
  if (!project) {
    return null;
  }
  if (enforcementEnabled() && !(await effectiveRole(userId, project.id))) {
    // Null, exactly as for a project on another account — the caller turns
    // both into the same 404, so "not yours" and "no such thing" are one
    // answer. On a deployment where workspaces are named after people, the
    // difference between them is itself a disclosure.
    return null;
  }
  return project;
}

/**
 * The workspace a bare `/dashboard/…` request belongs to, for the redirect
 * that makes every URL canonical (`src/proxy.ts`).
 *
 * "Last active" is the `vocion_active_project` cookie when it names a project
 * on the user's account; otherwise the account's first project — the same
 * order `resolveTenancyForUser` uses, so the redirect can never send a reader
 * to a workspace the page would then resolve differently. Null when the user
 * has no workspace at all (onboarding), which the caller reads as "leave the
 * URL alone".
 * @param userId - Auth.js user id.
 * @param preferredProjectId - `project.id` from the cookie, if any.
 */
export async function activeWorkspaceForUser(userId: string, preferredProjectId?: string | null): Promise<{ id: string; accountId: string; slug: string } | null> {
  const accountId = await accountIdForUser(userId);
  if (!accountId) {
    return null;
  }
  const columns = { id: projectSchema.id, slug: projectSchema.slug };
  const enforced = enforcementEnabled();
  const preferred = preferredProjectId?.trim();
  if (preferred) {
    const [chosen] = await db
      .select(columns)
      .from(projectSchema)
      .where(and(eq(projectSchema.id, preferred), eq(projectSchema.accountId, accountId)))
      .limit(1);
    if (chosen && (!enforced || await effectiveRole(userId, chosen.id))) {
      return { ...chosen, accountId };
    }
  }
  if (enforced) {
    // The first workspace they actually hold, ordered so a person's landing
    // workspace does not change between requests.
    const reachable = (await accessibleProjectIds(userId)).sort();
    const firstId = reachable[0];
    if (!firstId) {
      return null;
    }
    const [row] = await db.select(columns).from(projectSchema).where(eq(projectSchema.id, firstId)).limit(1);
    return row ? { ...row, accountId } : null;
  }
  // Ordered for the same reason as `resolveTenancyForUser`: an unordered
  // "first project" is whatever the planner returns, which stops being a
  // harmless detail as soon as an account holds more than a handful.
  const [first] = await db
    .select(columns)
    .from(projectSchema)
    .where(eq(projectSchema.accountId, accountId))
    .orderBy(asc(projectSchema.createdAt), asc(projectSchema.id))
    .limit(1);
  return first ? { ...first, accountId } : null;
}

/**
 * The slug of a project by id — what every outbound link builder needs once
 * per message. Null when the project is gone.
 * @param projectId - `project.id` (what services still call `orgId`).
 */
export async function projectSlugById(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: projectSchema.slug })
    .from(projectSchema)
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  return row?.slug ?? null;
}
