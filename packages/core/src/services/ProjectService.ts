/**
 * Projects (workspaces) as a signed-in user may see them.
 *
 * A tenant_account owns the projects; a user reaches them through a membership
 * in that account. A person can belong to several accounts (a consultant in two
 * clients'), and the workspace they pick decides which account a request runs
 * in (`libs/tenancy.ts`, vocion-core#128). The sidebar switcher
 * (`routers/Projects.ts`) and the proxy that resolves `/w/<slug>/…`
 * (`src/proxy.ts`) both ask "may this user make that project active?" here, so
 * the two cannot drift apart on the membership rule.
 */

import type { SQL } from 'drizzle-orm';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';
import { accessibleProjectIds, effectiveRole, enforcementEnabled, resolveActiveWorkspace } from '@/services/WorkspaceAccessService';

export type ProjectSummary = {
  id: string;
  /** The account that owns it — what the switcher groups by. */
  accountId: string;
  slug: string;
  name: string;
  description: string | null;
  /** Agents registered in the project — 0 means "nothing lives here yet" (the switcher hides those by default). */
  agentCount: number;
};

/** An account a user belongs to — the switcher's eyebrow and its group headings. */
export type AccountSummary = { id: string; name: string; slug: string };

/**
 * Which account a slug should resolve in when more than one of the person's
 * accounts has a workspace with it. Slugs are only unique inside an account,
 * so `/w/sales` can mean two workspaces for a person in two accounts.
 */
export type AccountPreference = {
  /**
   * `tenant_account.slug` the link names (`?account=`, set by a switch that
   * crosses accounts). A hard filter, not a hint: a link that names an account
   * resolves there or nowhere, rather than quietly opening a same-named
   * workspace in a different client's account.
   */
  accountSlug?: string | null;
  /** The last-active workspace (the `vocion_active_project` cookie). With no account named, its account wins, so a person stays where they are. */
  lastActiveProjectId?: string | null;
};

const summaryColumns = {
  id: projectSchema.id,
  accountId: projectSchema.accountId,
  slug: projectSchema.slug,
  name: projectSchema.name,
  description: projectSchema.description,
  // Qualified by hand: inside the subquery drizzle would render `"id"`, which
  // resolves to agent.id (integer), not project.id.
  agentCount: sql<number>`(select count(*)::int from "agent" a where a."org_id" = "project"."id")`.as('agent_count'),
};

/**
 * The join condition every lookup below goes through: this person's membership
 * in the project's OWN account. A project on an account they are not in finds
 * no membership row and so is never returned.
 * @param userId - Auth.js user id.
 */
function membershipInProjectAccount(userId: string): SQL | undefined {
  return and(eq(accountMembershipSchema.accountId, projectSchema.accountId), eq(accountMembershipSchema.userId, userId));
}

/**
 * Sort key: 0 for a project on the same account as the last-active workspace,
 * 1 otherwise. A subquery rather than a second round trip, because the proxy
 * runs this on every page navigation.
 * @param lastActiveProjectId - `project.id` from the cookie, or null.
 */
function lastActiveAccountFirst(lastActiveProjectId: string | null): SQL {
  return sql`case when ${projectSchema.accountId} = (select last_active."account_id" from "project" last_active where last_active."id" = ${lastActiveProjectId}) then 0 else 1 end`;
}

/**
 * Every account the user belongs to, oldest membership first — the switcher's
 * groups. Empty when the user has no membership.
 * @param userId - Auth.js user id.
 */
export async function accountsForUser(userId: string): Promise<AccountSummary[]> {
  return db
    .select({ id: tenantAccountSchema.id, name: tenantAccountSchema.name, slug: tenantAccountSchema.slug })
    .from(tenantAccountSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.accountId, tenantAccountSchema.id))
    .where(eq(accountMembershipSchema.userId, userId))
    .orderBy(asc(accountMembershipSchema.createdAt), asc(tenantAccountSchema.id));
}

/**
 * Every project the user can open, across every account they belong to — what
 * the switcher lists. Each carries its `accountId` so the switcher can group
 * them and knows when a switch crosses accounts.
 * @param userId - Auth.js user id.
 */
export async function listProjectsForUser(userId: string): Promise<ProjectSummary[]> {
  const all = await db
    .select(summaryColumns)
    .from(projectSchema)
    .innerJoin(accountMembershipSchema, membershipInProjectAccount(userId));
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
 * retype them. A slug can exist on more than one of the person's accounts, and
 * it resolves on ONE of them: the account a link names
 * (`preference.accountSlug`), else the account of the last-active workspace,
 * else the account they joined first. If they cannot open the workspace on
 * that account, the answer is null — never a quiet move to a same-named
 * workspace in a different client's account. Returns null when the project
 * does not exist or belongs to an account the user is not a member of — the
 * caller cannot tell the two apart, on purpose.
 * @param userId - Auth.js user id.
 * @param selector - `{ id }` or `{ slug }`.
 * @param preference - Which account wins when a slug is on several of them.
 */
export async function resolveProjectForUser(
  userId: string,
  selector: { id: string } | { slug: string },
  preference: AccountPreference = {},
): Promise<ProjectSummary | null> {
  const match = 'id' in selector
    ? eq(projectSchema.id, selector.id)
    : eq(sql`lower(${projectSchema.slug})`, selector.slug.trim().toLowerCase());
  // Account slugs travel in links people retype, like workspace slugs.
  const namedAccount = preference.accountSlug?.trim().toLowerCase();
  const [project] = await db
    .select(summaryColumns)
    .from(projectSchema)
    .innerJoin(accountMembershipSchema, membershipInProjectAccount(userId))
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId))
    .where(namedAccount ? and(match, eq(sql`lower(${tenantAccountSchema.slug})`, namedAccount)) : match)
    .orderBy(
      lastActiveAccountFirst(preference.lastActiveProjectId?.trim() || null),
      asc(accountMembershipSchema.createdAt),
      asc(projectSchema.accountId),
    )
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
 * The same decision tenancy makes (`resolveActiveWorkspace`), so the redirect
 * can never send a reader to a workspace the page would then resolve
 * differently: the `vocion_active_project` cookie's workspace when it is on one
 * of the user's accounts and they may open it, otherwise the first workspace
 * they can open. Null when the user has no workspace at all (onboarding), which
 * the caller reads as "leave the URL alone".
 * @param userId - Auth.js user id.
 * @param preferredProjectId - `project.id` from the cookie, if any.
 * @param preferredAccountId - With no usable cookie, look in this account first.
 */
export async function activeWorkspaceForUser(userId: string, preferredProjectId?: string | null, preferredAccountId?: string | null): Promise<{ id: string; accountId: string; slug: string } | null> {
  const active = await resolveActiveWorkspace(userId, preferredProjectId, preferredAccountId);
  if (!active?.projectId) {
    return null;
  }
  const slug = await projectSlugById(active.projectId);
  return slug ? { id: active.projectId, accountId: active.accountId, slug } : null;
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
