/**
 * Groups of people, and the workspaces each one opens — the read and write
 * side of what `deployment/groups.yaml` seeds.
 *
 * The seed puts a starting shape in place; this is where it is lived with.
 * Anything changed here outranks the file: `people:apply` is create-if-absent
 * and never reconciles, so a group edited on this screen survives every
 * deploy. That asymmetry is the whole design, and it is why this is a database
 * surface rather than a YAML editor — a deploy-managed box mounts the
 * workspace checkout read-only anyway.
 *
 * Everything here is account-scoped. A group belongs to one tenant account and
 * can only ever grant a project on that same account.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  groupProjectGrantSchema,
  projectMemberSchema,
  projectSchema,
  userGroupMemberSchema,
  userGroupSchema,
  userSchema,
} from '@/models/Schema';
import { accessibleProjects, enforcementEnabled } from '@/services/WorkspaceAccessService';

export type WorkspaceRoleName = 'owner' | 'pm' | 'specialist' | 'client_reviewer';

export type GroupSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** 'yaml' when the seed created it, 'ui' when a person did. Display only. */
  managedFrom: string;
  grants: { projectId: string; slug: string; name: string; role: WorkspaceRoleName }[];
  members: { userId: string; name: string | null; email: string }[];
};

export type PersonAccess = {
  userId: string;
  name: string | null;
  email: string;
  accountRole: string;
  groups: string[];
  /** Every workspace they reach, and why. */
  reaches: { projectId: string; slug: string; name: string; role: WorkspaceRoleName; via: string }[];
};

export type AccessOverview = {
  /**
   * Whether these grants are being ENFORCED. False means the page is showing
   * what access would be, while every member still reaches every workspace —
   * a distinction the screen has to state, or it reads as a lie.
   */
  enforced: boolean;
  workspaces: { id: string; slug: string; name: string; kind: string }[];
  groups: GroupSummary[];
  people: PersonAccess[];
};

class GroupError extends Error {
  constructor(public code: 'NOT_FOUND' | 'CONFLICT' | 'REFUSED', message: string) {
    super(message);
    this.name = 'GroupError';
  }
}

export { GroupError };

async function sharedProjects(accountId: string) {
  return db
    .select({ id: projectSchema.id, slug: projectSchema.slug, name: projectSchema.name, kind: projectSchema.kind })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, accountId))
    .orderBy(asc(projectSchema.name));
}

/**
 * Everything the access screen shows, in one read.
 * @param accountId
 */
export async function accessOverview(accountId: string): Promise<AccessOverview> {
  const projects = await sharedProjects(accountId);
  const byId = new Map(projects.map(p => [p.id, p]));

  const groups = await db
    .select()
    .from(userGroupSchema)
    .where(eq(userGroupSchema.accountId, accountId))
    .orderBy(asc(userGroupSchema.name));
  const groupIds = groups.map(g => g.id);

  const grants = groupIds.length
    ? await db.select().from(groupProjectGrantSchema).where(inArray(groupProjectGrantSchema.groupId, groupIds))
    : [];
  const memberRows = groupIds.length
    ? await db
        .select({
          groupId: userGroupMemberSchema.groupId,
          userId: userSchema.id,
          name: userSchema.name,
          email: userSchema.email,
        })
        .from(userGroupMemberSchema)
        .innerJoin(userSchema, eq(userSchema.id, userGroupMemberSchema.userId))
        .where(inArray(userGroupMemberSchema.groupId, groupIds))
    : [];

  const summaries: GroupSummary[] = groups.map(g => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    managedFrom: g.managedFrom,
    grants: grants
      .filter(x => x.groupId === g.id)
      .map(x => ({
        projectId: x.projectId,
        slug: byId.get(x.projectId)?.slug ?? x.projectId,
        name: byId.get(x.projectId)?.name ?? x.projectId,
        role: x.role as WorkspaceRoleName,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    members: memberRows
      .filter(x => x.groupId === g.id)
      .map(({ userId, name, email }) => ({ userId, name, email }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  }));

  const accountPeople = await db
    .select({
      userId: userSchema.id,
      name: userSchema.name,
      email: userSchema.email,
      accountRole: accountMembershipSchema.role,
    })
    .from(accountMembershipSchema)
    .innerJoin(userSchema, eq(userSchema.id, accountMembershipSchema.userId))
    .where(eq(accountMembershipSchema.accountId, accountId))
    .orderBy(asc(userSchema.email));

  const people: PersonAccess[] = [];
  for (const p of accountPeople) {
    const reach = await accessibleProjects(p.userId);
    people.push({
      ...p,
      groups: summaries.filter(g => g.members.some(m => m.userId === p.userId)).map(g => g.slug),
      reaches: reach
        .map(r => ({
          projectId: r.projectId,
          slug: byId.get(r.projectId)?.slug ?? r.projectId,
          name: byId.get(r.projectId)?.name ?? r.projectId,
          role: r.role,
          via: r.via,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return { enforced: enforcementEnabled(), workspaces: projects, groups: summaries, people };
}

export async function createGroup(opts: { accountId: string; slug: string; name: string; description?: string }): Promise<GroupSummary> {
  const slug = opts.slug.trim().toLowerCase();
  const [clash] = await db
    .select({ id: userGroupSchema.id })
    .from(userGroupSchema)
    .where(and(eq(userGroupSchema.accountId, opts.accountId), eq(userGroupSchema.slug, slug)))
    .limit(1);
  if (clash) {
    throw new GroupError('CONFLICT', `a group called "${slug}" already exists`);
  }
  const id = `grp-${randomUUID()}`;
  await db.insert(userGroupSchema).values({
    id,
    accountId: opts.accountId,
    slug,
    name: opts.name.trim(),
    description: opts.description?.trim() || null,
    managedFrom: 'ui',
  });
  const overview = await accessOverview(opts.accountId);
  return overview.groups.find(g => g.id === id)!;
}

async function groupOnAccount(accountId: string, groupId: string) {
  const [g] = await db
    .select({ id: userGroupSchema.id })
    .from(userGroupSchema)
    .where(and(eq(userGroupSchema.id, groupId), eq(userGroupSchema.accountId, accountId)))
    .limit(1);
  if (!g) {
    throw new GroupError('NOT_FOUND', 'no such group');
  }
  return g;
}

export async function deleteGroup(accountId: string, groupId: string): Promise<void> {
  await groupOnAccount(accountId, groupId);
  // Members and grants cascade. Nobody's account membership is touched: losing
  // a group costs you the workspaces it opened, never your place here.
  await db.delete(userGroupSchema).where(eq(userGroupSchema.id, groupId));
}

export async function setGroupMember(opts: { accountId: string; groupId: string; userId: string; member: boolean; actorId: string }): Promise<void> {
  await groupOnAccount(opts.accountId, opts.groupId);
  const [onAccount] = await db
    .select({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, opts.accountId), eq(accountMembershipSchema.userId, opts.userId)))
    .limit(1);
  if (!onAccount) {
    throw new GroupError('REFUSED', 'that person is not a member of this account');
  }
  if (opts.member) {
    await db.insert(userGroupMemberSchema)
      .values({ groupId: opts.groupId, userId: opts.userId, addedBy: opts.actorId })
      .onConflictDoNothing();
    return;
  }
  await db.delete(userGroupMemberSchema).where(and(
    eq(userGroupMemberSchema.groupId, opts.groupId),
    eq(userGroupMemberSchema.userId, opts.userId),
  ));
}

export async function setGroupGrant(opts: {
  accountId: string;
  groupId: string;
  projectId: string;
  /** null revokes it. */
  role: WorkspaceRoleName | null;
  actorId: string;
}): Promise<void> {
  await groupOnAccount(opts.accountId, opts.groupId);
  const [project] = await db
    .select({ id: projectSchema.id, kind: projectSchema.kind })
    .from(projectSchema)
    .where(and(eq(projectSchema.id, opts.projectId), eq(projectSchema.accountId, opts.accountId)))
    .limit(1);
  if (!project) {
    throw new GroupError('NOT_FOUND', 'no such workspace');
  }
  if (project.kind === 'personal') {
    // A personal workspace holds that person's own mail. It is reached by
    // owning it and by nothing else, so a group can never open one.
    throw new GroupError('REFUSED', 'a personal workspace cannot be granted to a group');
  }
  if (opts.role === null) {
    await db.delete(groupProjectGrantSchema).where(and(
      eq(groupProjectGrantSchema.groupId, opts.groupId),
      eq(groupProjectGrantSchema.projectId, opts.projectId),
    ));
    return;
  }
  await db.insert(groupProjectGrantSchema)
    .values({ groupId: opts.groupId, projectId: opts.projectId, role: opts.role, grantedBy: opts.actorId })
    .onConflictDoUpdate({
      target: [groupProjectGrantSchema.groupId, groupProjectGrantSchema.projectId],
      set: { role: opts.role, grantedBy: opts.actorId },
    });
}

/**
 * Remove a direct grant — the rows migration 0145 wrote, and the reason
 * someone still reaches a workspace no group of theirs opens.
 *
 * The screen has to offer this, or a person can see why access is wrong and
 * have no way to fix it without SQL.
 * @param opts
 * @param opts.accountId
 * @param opts.projectId
 * @param opts.userId
 */
export async function removeDirectGrant(opts: { accountId: string; projectId: string; userId: string }): Promise<void> {
  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(and(eq(projectSchema.id, opts.projectId), eq(projectSchema.accountId, opts.accountId)))
    .limit(1);
  if (!project) {
    throw new GroupError('NOT_FOUND', 'no such workspace');
  }
  await db.delete(projectMemberSchema).where(and(
    eq(projectMemberSchema.projectId, opts.projectId),
    eq(projectMemberSchema.userId, opts.userId),
  ));
}

/**
 * How many people hold a direct grant, for the note on the screen.
 * @param accountId
 */
export async function directGrantCount(accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projectMemberSchema)
    .innerJoin(projectSchema, eq(projectSchema.id, projectMemberSchema.projectId))
    .where(eq(projectSchema.accountId, accountId));
  return row?.n ?? 0;
}
