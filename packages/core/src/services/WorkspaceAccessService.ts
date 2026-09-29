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
 * NOTHING CALLS THIS YET. It ships dark, and `ProjectService` and
 * `resolveTenancyForUser` start consulting it behind
 * `VOCION_ENFORCE_WORKSPACE_ACCESS` in a later release, so the query is proven
 * against production data before it can lock anyone out.
 */

import type { WorkspaceRole } from '@/services/authz';
import process from 'node:process';
import { and, asc, eq, inArray } from 'drizzle-orm';
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
 * which one a request runs in (`libs/tenancy.ts`, vocion-core#128). The order
 * is fixed (oldest first, account id as the tie-break) so every list built from
 * it, and the default below, reads the same on every request.
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

/**
 * The account a person lands in when nothing has picked one: a first sign-in
 * in a fresh browser, a stale cookie naming a workspace they have left, a
 * script or the worker with no request at all.
 *
 * It used to be the only answer, read with a bare `LIMIT 1`, so a person in two
 * accounts got whichever row Postgres returned first and could move between
 * tenants mid-session (vocion-core#128). Now the picked workspace decides the
 * account, and this is only the fallback: the oldest membership, the same one
 * on every read.
 * @param userId - The signed-in person.
 * @returns Their oldest membership, or null for a person in no account.
 */
export async function defaultMembershipFor(userId: string): Promise<Membership | null> {
  const [row] = await db
    .select({ accountId: accountMembershipSchema.accountId, role: accountMembershipSchema.role })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .orderBy(asc(accountMembershipSchema.createdAt), asc(accountMembershipSchema.accountId))
    .limit(1);
  return row ? toMembership(row) : null;
}

/** A workspace together with the membership that lets this person into its account. */
export type MemberWorkspace = { projectId: string; slug: string; accountId: string; accountRole: 'admin' | 'member' };

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
 * @param userId - The signed-in person.
 * @param projectId - The workspace they picked.
 */
export async function memberWorkspace(userId: string, projectId: string): Promise<MemberWorkspace | null> {
  const [row] = await db
    .select({ projectId: projectSchema.id, slug: projectSchema.slug, accountId: projectSchema.accountId, accountRole: accountMembershipSchema.role })
    .from(projectSchema)
    .innerJoin(accountMembershipSchema, and(
      eq(accountMembershipSchema.accountId, projectSchema.accountId),
      eq(accountMembershipSchema.userId, userId),
    ))
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  return row ? { ...row, accountRole: row.accountRole as 'admin' | 'member' } : null;
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
 * @param projects - Every project on their account.
 * @param grants - Their account role and their grant rows.
 */
function resolveAccess(userId: string, projects: readonly AccessProject[], grants: Grants): WorkspaceAccess[] {
  const best = new Map<string, WorkspaceAccess>();
  const offer = (projectId: string, role: WorkspaceRole, via: WorkspaceAccess['via']) => {
    const held = best.get(projectId);
    const winner = strongerRole(held?.role ?? null, role);
    if (!held || winner !== held.role) {
      best.set(projectId, { projectId, role, via });
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
    access.push(...resolveAccess(userId, onAccount, { accountRole: membership.role, group, direct }));
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
    out.set(userId, resolveAccess(userId, projects, {
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
