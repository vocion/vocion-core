/**
 * Which workspaces a person reaches, and at what role.
 *
 * One answer, one place. Account membership says a person is in the
 * deployment; this says which of its workspaces they may open. Before it,
 * `listProjectsForUser` returned every project on the account and the role fed
 * to `services/authz.ts` was derived from the account role (admin -> owner,
 * member -> pm), both of which carry `'*'` grants — so everyone held everything
 * everywhere.
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
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  groupProjectGrantSchema,
  projectMemberSchema,
  projectSchema,
  userGroupMemberSchema,
} from '@/models/Schema';

/**
 * Strength order. `owner` and `pm` both carry `'*'` in `ROLE_GRANTS` today, so
 * the distinction between them is about who may administer the workspace, not
 * about what they may draft — which is why owner still outranks pm here.
 */
const RANK: Record<WorkspaceRole, number> = {
  client_reviewer: 1,
  specialist: 2,
  pm: 3,
  owner: 4,
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

async function membershipFor(userId: string): Promise<Membership | null> {
  const [row] = await db
    .select({ accountId: accountMembershipSchema.accountId, role: accountMembershipSchema.role })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .limit(1);
  return row ? { accountId: row.accountId, role: row.role as 'admin' | 'member' } : null;
}

/**
 * Every workspace this person reaches, strongest role first per workspace.
 *
 * Four indexed lookups rather than one union, because each answers a different
 * question and the union's plan is not obviously better at the sizes involved:
 * a deployment has tens of workspaces, and a person belongs to a handful of
 * groups.
 * @param userId - The person asking.
 */
export async function accessibleProjects(userId: string): Promise<WorkspaceAccess[]> {
  const membership = await membershipFor(userId);
  if (!membership) {
    return [];
  }

  const best = new Map<string, WorkspaceAccess>();
  const offer = (projectId: string, role: WorkspaceRole, via: WorkspaceAccess['via']) => {
    const held = best.get(projectId);
    const winner = strongerRole(held?.role ?? null, role);
    if (!held || winner !== held.role) {
      best.set(projectId, { projectId, role, via });
    }
  };

  // Every project on the account, with the two columns access depends on. The
  // account filter is what keeps all of the below inside one tenant.
  const projects = await db
    .select({ id: projectSchema.id, kind: projectSchema.kind, ownerUserId: projectSchema.ownerUserId })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, membership.accountId));
  const onAccount = new Set(projects.map(p => p.id));

  // 4. Account admins run every SHARED workspace. Not personal ones: a personal
  //    workspace holds that person's own mail, and "admin" is not consent.
  if (membership.role === 'admin') {
    for (const p of projects) {
      if (p.kind === 'shared') {
        offer(p.id, 'owner', 'account-admin');
      }
    }
  }

  // 3. Group grants, resolved rather than expanded.
  const groupGrants = await db
    .select({ projectId: groupProjectGrantSchema.projectId, role: groupProjectGrantSchema.role })
    .from(groupProjectGrantSchema)
    .innerJoin(userGroupMemberSchema, eq(userGroupMemberSchema.groupId, groupProjectGrantSchema.groupId))
    .where(eq(userGroupMemberSchema.userId, userId));
  for (const g of groupGrants) {
    // A grant naming a project on another account is not reachable. It should
    // not exist, and it is cheaper to ignore than to trust.
    if (onAccount.has(g.projectId)) {
      offer(g.projectId, g.role, 'group');
    }
  }

  // 2. Direct grants.
  const direct = await db
    .select({ projectId: projectMemberSchema.projectId, role: projectMemberSchema.role })
    .from(projectMemberSchema)
    .where(eq(projectMemberSchema.userId, userId));
  for (const d of direct) {
    if (onAccount.has(d.projectId)) {
      offer(d.projectId, d.role, 'direct');
    }
  }

  // 1. Owning a personal workspace beats everything, including an admin's
  //    absence from it.
  for (const p of projects) {
    if (p.kind === 'personal' && p.ownerUserId === userId) {
      offer(p.id, 'owner', 'owner');
    }
  }

  // A personal workspace someone else owns is not reachable by any route, so
  // drop anything that slipped through by a direct or group grant. The service
  // layer refuses to write those; this makes a bad row inert rather than fatal.
  const foreignPersonal = new Set(
    projects.filter(p => p.kind === 'personal' && p.ownerUserId !== userId).map(p => p.id),
  );
  for (const id of foreignPersonal) {
    best.delete(id);
  }

  return [...best.values()];
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
  const membership = await membershipFor(userId);
  if (!membership) {
    return null;
  }

  const [project] = await db
    .select({ id: projectSchema.id, kind: projectSchema.kind, ownerUserId: projectSchema.ownerUserId })
    .from(projectSchema)
    .where(and(eq(projectSchema.id, projectId), eq(projectSchema.accountId, membership.accountId)))
    .limit(1);
  if (!project) {
    return null;
  }

  if (project.kind === 'personal') {
    // The whole rule for a personal workspace: its owner, and no one else.
    return project.ownerUserId === userId ? 'owner' : null;
  }

  if (membership.role === 'admin') {
    return 'owner';
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
