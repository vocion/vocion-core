/**
 * Which workspaces a person reaches, and at what role.
 *
 * One answer, one place. Account membership says a person is in the
 * deployment; this says which of its workspaces they may open. Before it,
 * `listProjectsForUser` returned every project on the account and the role fed
 * to `services/authz.ts` was derived from the account role, which carries
 * `'*'` grants either way — so everyone held everything everywhere.
 *
 * Access comes from four places and the strongest wins:
 *
 *   1. **Owning a personal workspace.** `project.kind = 'personal'` and
 *      `owner_user_id` is you: `owner`, and nobody else gets in, admins
 *      included.
 *   2. **A direct grant.** A `project_member` row.
 *   3. **A group grant.** `user_group_member` -> `group_project_grant`,
 *      resolved HERE rather than expanded into `project_member` rows, so
 *      removing someone from a group takes effect on their next request.
 *   4. **Account admin, on shared workspaces only.** Preserves exactly what
 *      admins can do today, and deliberately stops at the edge of a personal
 *      workspace — see below.
 *
 * `null` means no access, and every caller must make it indistinguishable from
 * "does not exist": a 404, never a 403. `resolveProjectForUser` already does
 * this for the wrong-account case and says why.
 *
 * `ProjectService` and `resolveTenancyForUser` consult the grant rules behind
 * `VOCION_ENFORCE_WORKSPACE_ACCESS`, so the query is proven against production
 * data before it can lock anyone out of a SHARED workspace.
 *
 * Personal workspaces do not wait for the flag. Hiding someone's own mail from
 * their colleagues is not a rollout decision, so every lookup here and in
 * `ProjectService` refuses another person's personal workspace with the flag
 * on or off ({@link visibleWorkspace}).
 */

import type { SQL } from 'drizzle-orm';
import type { WorkspaceRole } from '@/services/authz';
import process from 'node:process';
import { and, asc, eq, inArray, ne, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  groupProjectGrantSchema,
  projectMemberSchema,
  projectSchema,
  userGroupMemberSchema,
} from '@/models/Schema';

/**
 * Strength order. Both carry `'*'` in `ROLE_GRANTS`, so the distinction is
 * about who may administer the workspace, not about what they may draft —
 * which is why admin still outranks member here.
 */
const RANK: Record<WorkspaceRole, number> = {
  member: 1,
  admin: 2,
};

/**
 * The stronger of two roles; `null` loses to anything.
 * @param a
 * @param b
 */
export function strongerRole(a: WorkspaceRole | null, b: WorkspaceRole | null): WorkspaceRole | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return RANK[a] >= RANK[b] ? a : b;
}

export type WorkspaceAccess = {
  projectId: string;
  /** The account that owns the workspace. A person in two accounts reaches workspaces on both. */
  accountId: string;
  role: WorkspaceRole;
  /** Why they have it, for the access list in the UI. Strongest source wins. */
  via: 'owner' | 'direct' | 'group' | 'account-admin';
};

/**
 * Whether access is enforced on this deployment.
 *
 * One definition, because the flag has to cover every seam at once. A flag that
 * reaches `ProjectService` but not `resolveTenancyForUser` hides workspaces
 * from the switcher while leaving them reachable by naming one in a header,
 * which is worse than not enforcing at all: it looks enforced.
 */
export function enforcementEnabled(): boolean {
  return process.env.VOCION_ENFORCE_WORKSPACE_ACCESS === '1';
}

/**
 * The SQL condition every project lookup for a person carries: a shared
 * workspace, or a personal one they own. Another person's personal workspace
 * fails it whatever the enforcement flag says, so it is never listed, never
 * resolved by slug or id, and never landed on — and the caller cannot tell it
 * from a workspace that does not exist.
 *
 * A personal row with no owner (its owner was deleted, `ON DELETE set null`)
 * fails it too: `owner_user_id = $1` is NULL there, and NULL is not true.
 * @param userId - The person asking.
 */
export function visibleWorkspace(userId: string): SQL {
  return or(ne(projectSchema.kind, 'personal'), eq(projectSchema.ownerUserId, userId))!;
}

type Membership = { accountId: string; role: 'admin' | 'member' };

/**
 * Narrow a membership row's free-text role to the two roles that exist.
 * @param row - A row read from `account_membership`.
 * @param row.accountId - The account the membership is in.
 * @param row.role - `'admin'` or `'member'`, stored as text.
 */
function toMembership(row: { accountId: string; role: string }): Membership {
  return { accountId: row.accountId, role: row.role as 'admin' | 'member' };
}

/**
 * Every account this person belongs to, oldest membership first.
 *
 * Self-hosted this is one row. On cloud a person can belong to several — a
 * consultant in two clients' accounts — and the workspace they pick decides
 * which one a request runs in (`resolveActiveWorkspace`, vocion-core#128). The
 * order is fixed (oldest first, account id as the tie-break) so every list and
 * every fallback built from it reads the same on every request.
 * @param userId - The signed-in person.
 */
export async function membershipsFor(userId: string): Promise<Membership[]> {
  const rows = await db
    .select({ accountId: accountMembershipSchema.accountId, role: accountMembershipSchema.role })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .orderBy(asc(accountMembershipSchema.createdAt), asc(accountMembershipSchema.accountId));
  return rows.map(toMembership);
}

/** A workspace together with the membership that lets this person into its account. */
export type MemberWorkspace = {
  projectId: string;
  slug: string;
  accountId: string;
  accountRole: 'admin' | 'member';
  /** `'personal'` only ever for the person's OWN personal workspace: anyone else's is not returned. */
  kind: 'shared' | 'personal';
};

/**
 * A workspace, when it sits in an account this person belongs to; otherwise
 * null.
 *
 * This is the gate a picked workspace goes through before it may choose the
 * account. A workspace id arrives from the URL, the last-active cookie or, on
 * `/api/` routes, a header the caller controls, so "the account that owns this
 * workspace" is only trusted when the person is actually a member of that
 * account. One query: the project joined to this person's membership in the
 * project's own account.
 *
 * Another person's personal workspace is null here as well, with enforcement
 * on or off: being in the account does not put anyone in someone's own
 * workspace.
 * @param userId - The signed-in person.
 * @param projectId - The workspace they picked.
 */
export async function memberWorkspace(userId: string, projectId: string): Promise<MemberWorkspace | null> {
  const [row] = await db
    .select({ projectId: projectSchema.id, slug: projectSchema.slug, accountId: projectSchema.accountId, accountRole: accountMembershipSchema.role, kind: projectSchema.kind })
    .from(projectSchema)
    .innerJoin(accountMembershipSchema, and(
      eq(accountMembershipSchema.accountId, projectSchema.accountId),
      eq(accountMembershipSchema.userId, userId),
    ))
    .where(and(eq(projectSchema.id, projectId), visibleWorkspace(userId)))
    .limit(1);
  return row ? { ...row, accountRole: row.accountRole as 'admin' | 'member' } : null;
}

/**
 * The role a person holds in a workspace `memberWorkspace` already let them
 * into — the one rule behind both `resolveActiveWorkspace` and `actAs`.
 *
 * Enforced, it is `effectiveRole`. Unenforced, a shared workspace still runs
 * on the account role, exactly as before the flag existed; a personal one is
 * always `effectiveRole`, which is `admin` for its owner (the only person
 * `memberWorkspace` returns it to).
 * @param userId - The person.
 * @param workspace - What `memberWorkspace` returned for them.
 */
export async function roleInMemberWorkspace(userId: string, workspace: MemberWorkspace): Promise<WorkspaceRole | null> {
  if (enforcementEnabled() || workspace.kind === 'personal') {
    return effectiveRole(userId, workspace.projectId);
  }
  return workspace.accountRole;
}

/** The account and workspace a request runs in. */
export type ActiveWorkspace = {
  accountId: string;
  /** The person's role on that account. */
  accountRole: 'admin' | 'member';
  /** Null when they can open no workspace on any of their accounts (onboarding). */
  projectId: string | null;
  /** The role held IN `projectId`, which is what `services/authz.ts` receives. Null with it. */
  workspaceRole: WorkspaceRole | null;
};

/**
 * Which account and workspace a request runs in — the one decision behind
 * tenancy (`libs/tenancy.ts`) and the bare-`/dashboard` redirect
 * (`ProjectService.activeWorkspaceForUser`). One function, so the redirect can
 * never send a reader to a workspace the page then resolves differently.
 *
 * **The account follows the workspace** (vocion-core#128):
 *
 * 1. The picked workspace (the URL's, else the last-active cookie's) wins when
 *    the person is a member of the account that owns it and, with access
 *    enforced, holds the workspace itself. Its account is where they are.
 * 2. Otherwise, the first workspace they can open — looking first in the
 *    picked workspace's account (a room they cannot open still keeps them with
 *    that client), then in each of their accounts, oldest membership first. An
 *    account with nothing they can open is skipped, so a person whose oldest
 *    account is empty lands in the next one instead of on no workspace at all,
 *    where even the switcher (which needs a workspace to load) would be shut.
 * 3. No workspace on any account: their first account in that order, with a
 *    null project — the onboarding state.
 *
 * The picked id is untrusted: on `/api/` routes it arrives in a header the
 * caller controls. It can only choose an account the person is a member of,
 * because `memberWorkspace` finds nothing otherwise.
 * @param userId - The signed-in person.
 * @param pickedProjectId - The workspace the request names, unchecked.
 * @param preferredAccountId - With no usable pick, look in this account first
 *  (a just-accepted invite's). Ignored when it is not one of theirs.
 * @returns Where they are, or null for a person in no account.
 */
export async function resolveActiveWorkspace(userId: string, pickedProjectId?: string | null, preferredAccountId?: string | null): Promise<ActiveWorkspace | null> {
  const pickedId = pickedProjectId?.trim();
  const picked = pickedId ? await memberWorkspace(userId, pickedId) : null;
  const enforced = enforcementEnabled();
  if (picked) {
    const workspaceRole = await roleInMemberWorkspace(userId, picked);
    if (workspaceRole) {
      return { accountId: picked.accountId, accountRole: picked.accountRole, projectId: picked.projectId, workspaceRole };
    }
  }

  const memberships = await membershipsFor(userId);
  if (memberships.length === 0) {
    return null;
  }
  const firstAccountId = picked?.accountId ?? preferredAccountId;
  const searchOrder = firstAccountId
    ? [...memberships.filter(m => m.accountId === firstAccountId), ...memberships.filter(m => m.accountId !== firstAccountId)]
    : memberships;
  const landing = enforced
    ? await firstHeldWorkspace(userId, searchOrder)
    : await firstWorkspaceOnAccounts(userId, searchOrder);
  if (landing) {
    return landing;
  }
  const home = searchOrder[0]!;
  return { accountId: home.accountId, accountRole: home.role, projectId: null, workspaceRole: null };
}

/**
 * Unenforced landing: every member reaches every shared workspace on an
 * account, so the answer is the oldest workspace on the first account that has
 * one — never another person's personal workspace. One row per account
 * (`DISTINCT ON`), ordered so the landing workspace does not change between
 * requests.
 * @param userId - The person landing.
 * @param searchOrder - The person's memberships, in the order to try them.
 */
async function firstWorkspaceOnAccounts(userId: string, searchOrder: readonly Membership[]): Promise<ActiveWorkspace | null> {
  const oldestPerAccount = await db
    .selectDistinctOn([projectSchema.accountId], { id: projectSchema.id, accountId: projectSchema.accountId, kind: projectSchema.kind })
    .from(projectSchema)
    .where(and(inArray(projectSchema.accountId, searchOrder.map(m => m.accountId)), visibleWorkspace(userId)))
    .orderBy(asc(projectSchema.accountId), asc(projectSchema.createdAt), asc(projectSchema.id));
  for (const membership of searchOrder) {
    const first = oldestPerAccount.find(p => p.accountId === membership.accountId);
    if (first) {
      // Their own personal workspace: they own it, whatever their account role.
      const workspaceRole = first.kind === 'personal' ? 'admin' : membership.role;
      return { accountId: membership.accountId, accountRole: membership.role, projectId: first.id, workspaceRole };
    }
  }
  return null;
}

/**
 * Enforced landing: the oldest workspace the person actually holds on the
 * first account where they hold one. Oldest first, then id, the same order as
 * the unenforced landing, so turning enforcement on does not move anyone's
 * default to a different workspace they could already open.
 * @param userId - The signed-in person.
 * @param searchOrder - Their memberships, in the order to try them.
 */
async function firstHeldWorkspace(userId: string, searchOrder: readonly Membership[]): Promise<ActiveWorkspace | null> {
  const reachable = await accessibleProjects(userId);
  if (reachable.length === 0) {
    return null;
  }
  const roleById = new Map(reachable.map(a => [a.projectId, a.role]));
  const oldestFirst = await db
    .select({ id: projectSchema.id, accountId: projectSchema.accountId })
    .from(projectSchema)
    .where(inArray(projectSchema.id, [...roleById.keys()]))
    .orderBy(asc(projectSchema.createdAt), asc(projectSchema.id));
  for (const membership of searchOrder) {
    const held = oldestFirst.find(p => p.accountId === membership.accountId);
    const role = held ? roleById.get(held.id) : undefined;
    if (held && role) {
      return { accountId: membership.accountId, accountRole: membership.role, projectId: held.id, workspaceRole: role };
    }
  }
  return null;
}

/** A project, reduced to the two columns access depends on. */
type AccessProject = { id: string; kind: string; ownerUserId: string | null };

/** One person's grant rows, already narrowed to their account. */
type Grants = {
  accountRole: 'admin' | 'member';
  group: { projectId: string; role: WorkspaceRole }[];
  direct: { projectId: string; role: WorkspaceRole }[];
};

/**
 * The precedence rule itself, over rows already fetched. Pure, and the ONLY
 * place the four sources are ranked — `accessibleProjects` reads one person's
 * rows and `reachForAccount` reads a whole account's, and both must answer
 * identically or the screen disagrees with the resolver that gates the request.
 * @param userId - The person asking.
 * @param accountId - The account being resolved; every project passed is on it.
 * @param projects - Every project on that account.
 * @param grants - Their role on that account and their grant rows.
 */
function resolveAccess(userId: string, accountId: string, projects: readonly AccessProject[], grants: Grants): WorkspaceAccess[] {
  const best = new Map<string, WorkspaceAccess>();
  const offer = (projectId: string, role: WorkspaceRole, via: WorkspaceAccess['via']) => {
    const held = best.get(projectId);
    const winner = strongerRole(held?.role ?? null, role);
    if (!held || winner !== held.role) {
      best.set(projectId, { projectId, accountId, role, via });
    }
  };
  const onAccount = new Set(projects.map(p => p.id));

  // 4. Account admins run every SHARED workspace. Not personal ones: a personal
  //    workspace holds that person's own mail, and "admin" is not consent.
  if (grants.accountRole === 'admin') {
    for (const p of projects) {
      if (p.kind === 'shared') {
        offer(p.id, 'admin', 'account-admin');
      }
    }
  }

  // 3. Group grants, resolved rather than expanded.
  for (const g of grants.group) {
    // A grant naming a project on another account is not reachable. It should
    // not exist, and it is cheaper to ignore than to trust.
    if (onAccount.has(g.projectId)) {
      offer(g.projectId, g.role, 'group');
    }
  }

  // 2. Direct grants.
  for (const d of grants.direct) {
    if (onAccount.has(d.projectId)) {
      offer(d.projectId, d.role, 'direct');
    }
  }

  // 1. Owning a personal workspace beats everything, including an admin's
  //    absence from it.
  for (const p of projects) {
    if (p.kind === 'personal' && p.ownerUserId === userId) {
      offer(p.id, 'admin', 'owner');
    }
  }

  // A personal workspace someone else owns is not reachable by any route, so
  // drop anything that slipped through by a direct or group grant. The service
  // layer refuses to write those; this makes a bad row inert rather than fatal.
  for (const p of projects) {
    if (p.kind === 'personal' && p.ownerUserId !== userId) {
      best.delete(p.id);
    }
  }

  return [...best.values()];
}

/**
 * Every workspace this person reaches, strongest role first per workspace,
 * across every account they belong to, or inside one account when it is named.
 *
 * Each account is resolved with the role held in THAT account: an admin of one
 * client and a member of another runs the first one's shared workspaces and
 * only the second one's granted ones (vocion-core#128).
 *
 * Four indexed lookups rather than one union, because each answers a different
 * question and the union's plan is not obviously better at the sizes involved:
 * a deployment has tens of workspaces, and a person belongs to a handful of
 * groups and accounts.
 * @param userId - The person asking.
 * @param onlyAccountId - Answer for this one account only (the one a request
 *  runs in). Omit it for every account the person belongs to.
 */
export async function accessibleProjects(userId: string, onlyAccountId?: string): Promise<WorkspaceAccess[]> {
  const memberships = (await membershipsFor(userId)).filter(m => !onlyAccountId || m.accountId === onlyAccountId);
  if (memberships.length === 0) {
    return [];
  }

  // Every project on those accounts, with the columns access depends on. The
  // account filter is what keeps all of the below inside the person's own
  // tenants: a grant row naming another tenant's project finds nothing here.
  const projects = await db
    .select({ id: projectSchema.id, accountId: projectSchema.accountId, kind: projectSchema.kind, ownerUserId: projectSchema.ownerUserId })
    .from(projectSchema)
    .where(inArray(projectSchema.accountId, memberships.map(m => m.accountId)));

  const group = await db
    .select({ projectId: groupProjectGrantSchema.projectId, role: groupProjectGrantSchema.role })
    .from(groupProjectGrantSchema)
    .innerJoin(userGroupMemberSchema, eq(userGroupMemberSchema.groupId, groupProjectGrantSchema.groupId))
    .where(eq(userGroupMemberSchema.userId, userId));

  const direct = await db
    .select({ projectId: projectMemberSchema.projectId, role: projectMemberSchema.role })
    .from(projectMemberSchema)
    .where(eq(projectMemberSchema.userId, userId));

  // One account at a time, because the account role that feeds rule 4 differs
  // per account. `resolveAccess` drops grants naming a project outside the
  // projects it is handed, so passing every grant each time is safe.
  const access: WorkspaceAccess[] = [];
  for (const membership of memberships) {
    const onAccount = projects.filter(p => p.accountId === membership.accountId);
    access.push(...resolveAccess(userId, membership.accountId, onAccount, { accountRole: membership.role, group, direct }));
  }
  return access;
}

/**
 * The same answer for EVERYONE on an account, in four queries rather than four
 * per person.
 *
 * The members screen asks "who reaches what" about the whole account at once.
 * Asking `accessibleProjects` in a loop was four round trips per person — nine
 * people meant thirty-six — and it grows with the roster, so the screen got
 * slower every time someone joined. The rows do not differ per person; only
 * the filtering does.
 * @param accountId - The account to answer for.
 * @param userIds - The people on it.
 * @returns A map from user id to what they reach. Everyone asked for is present.
 */
export async function reachForAccount(accountId: string, userIds: readonly string[]): Promise<Map<string, WorkspaceAccess[]>> {
  const out = new Map<string, WorkspaceAccess[]>(userIds.map(id => [id, []]));
  if (userIds.length === 0) {
    return out;
  }
  const ids = [...userIds];

  const projects = await db
    .select({ id: projectSchema.id, kind: projectSchema.kind, ownerUserId: projectSchema.ownerUserId })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, accountId));

  const memberships = await db
    .select({ userId: accountMembershipSchema.userId, role: accountMembershipSchema.role })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, accountId), inArray(accountMembershipSchema.userId, ids)));
  const roleOf = new Map(memberships.map(m => [m.userId, m.role as 'admin' | 'member']));

  const groupRows = await db
    .select({
      userId: userGroupMemberSchema.userId,
      projectId: groupProjectGrantSchema.projectId,
      role: groupProjectGrantSchema.role,
    })
    .from(groupProjectGrantSchema)
    .innerJoin(userGroupMemberSchema, eq(userGroupMemberSchema.groupId, groupProjectGrantSchema.groupId))
    .where(inArray(userGroupMemberSchema.userId, ids));

  const directRows = await db
    .select({
      userId: projectMemberSchema.userId,
      projectId: projectMemberSchema.projectId,
      role: projectMemberSchema.role,
    })
    .from(projectMemberSchema)
    .where(inArray(projectMemberSchema.userId, ids));

  const byUser = <T extends { userId: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.userId);
      if (list) {
        list.push(r);
      } else {
        m.set(r.userId, [r]);
      }
    }
    return m;
  };
  const groupBy = byUser(groupRows);
  const directBy = byUser(directRows);

  for (const userId of ids) {
    const accountRole = roleOf.get(userId);
    // Not on this account: the same empty answer `accessibleProjects` gives.
    if (!accountRole) {
      continue;
    }
    out.set(userId, resolveAccess(userId, accountId, projects, {
      accountRole,
      group: groupBy.get(userId) ?? [],
      direct: directBy.get(userId) ?? [],
    }));
  }
  return out;
}

/**
 * The role this person holds in one workspace, or `null` when they hold none.
 *
 * `null` must read as "no such workspace" at every boundary, never as
 * "forbidden": telling someone a workspace exists but is not theirs is itself a
 * disclosure on a deployment where workspaces are people's names.
 * @param userId - The person asking.
 * @param projectId - The workspace they are asking about.
 */
export async function effectiveRole(userId: string, projectId: string): Promise<WorkspaceRole | null> {
  // The membership that counts is the one in the workspace's OWN account, so a
  // person in two accounts gets each account's role in its own workspaces, and
  // a workspace in an account they are not in is simply not found.
  const [project] = await db
    .select({
      id: projectSchema.id,
      kind: projectSchema.kind,
      ownerUserId: projectSchema.ownerUserId,
      accountRole: accountMembershipSchema.role,
    })
    .from(projectSchema)
    .innerJoin(accountMembershipSchema, and(
      eq(accountMembershipSchema.accountId, projectSchema.accountId),
      eq(accountMembershipSchema.userId, userId),
    ))
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  if (!project) {
    return null;
  }

  if (project.kind === 'personal') {
    // The whole rule for a personal workspace: its owner, and no one else.
    return project.ownerUserId === userId ? 'admin' : null;
  }

  if (project.accountRole === 'admin') {
    return 'admin';
  }

  const [direct] = await db
    .select({ role: projectMemberSchema.role })
    .from(projectMemberSchema)
    .where(and(eq(projectMemberSchema.userId, userId), eq(projectMemberSchema.projectId, projectId)))
    .limit(1);

  const groupRoles = await db
    .select({ role: groupProjectGrantSchema.role })
    .from(groupProjectGrantSchema)
    .innerJoin(userGroupMemberSchema, eq(userGroupMemberSchema.groupId, groupProjectGrantSchema.groupId))
    .where(and(eq(userGroupMemberSchema.userId, userId), eq(groupProjectGrantSchema.projectId, projectId)));

  return [direct?.role ?? null, ...groupRoles.map(g => g.role)]
    .reduce<WorkspaceRole | null>((acc, r) => strongerRole(acc, r), null);
}

/**
 * The ids alone, for the places that only need to filter a list.
 * @param userId - The person asking.
 */
export async function accessibleProjectIds(userId: string): Promise<string[]> {
  return (await accessibleProjects(userId)).map(a => a.projectId);
}

/**
 * Whether these workspaces are all reachable — the check a bulk operation
 * wants before it touches several.
 * @param userId - The person asking.
 * @param projectIds - The workspaces named.
 */
export async function reachesAll(userId: string, projectIds: string[]): Promise<boolean> {
  if (projectIds.length === 0) {
    return true;
  }
  const reachable = new Set(await accessibleProjectIds(userId));
  return projectIds.every(id => reachable.has(id));
}
