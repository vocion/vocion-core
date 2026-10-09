/**
 * Every person's own workspace: ONE per person per installation, private to
 * them (founder, 2026-10-09: "Should I have personal space in all Orgs (no)…
 * Or should my personal work across orgs?").
 *
 * **Where it lives.** A workspace needs an Org (`project.account_id`), so the
 * one Personal sits on the person's HOME Org: their oldest membership, the
 * order every Org list already uses (`membershipsFor`). On a single-Org
 * install that is the one Org, exactly as before. On a multi-Org deployment
 * it is still one workspace: the picker shows it once, above the Org groups,
 * and it reads across every Org the person belongs to
 * (`services/personal/reach.ts`). If the person leaves their home Org, the
 * next sign-in moves Personal to the new oldest membership
 * ({@link ensurePersonalProjectsForUser}), so it never becomes unreachable.
 *
 * Databases from before this held one Personal per Org; `mergePersonalProjects`
 * (`services/personal/merge.ts`) folds them into this one, with a dry run.
 * Until it has run, {@link findPersonalProject} answers with the home one.
 *
 * A personal workspace (`project.kind = 'personal'`) is where a person's own
 * assistant lives, with their own mail and notes. Its access rule is the
 * shortest one in `WorkspaceAccessService`: the owner, and nobody else —
 * account admins included, and whether or not
 * `VOCION_ENFORCE_WORKSPACE_ACCESS` is on.
 *
 * Created here and nowhere else, at the moments a person arrives in an
 * account: signing up, signing in, accepting an invite. Each of those can run
 * twice at once (two tabs, a JWT issued while an invite is being accepted), so
 * creation is an insert that loses quietly to whichever call got there first
 * and then reads the winner back:
 *
 * - `project_personal_owner_uq` (migration 0170) makes (account, owner) unique
 *   among personal workspaces.
 * - The slug is derived from the user id, so even where that index could not
 *   be built (0170 skips it over pre-existing duplicates) two concurrent calls
 *   still collide on `project_account_slug_idx`.
 *
 * The slug comes from a hash of the user id, never from a name or an email:
 * it travels in URLs (`/w/<slug>`), and a person's name in a URL is a
 * disclosure that outlives a rename.
 */

import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, notExists, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSlugProblem } from '@/libs/links';
import { accountMembershipSchema, projectMemberSchema, projectSchema } from '@/models/Schema';
import { ensurePersonalAssistant } from './personalAssistant';

/** What a personal workspace is called. The switcher groups it under its account. */
export const PERSONAL_PROJECT_NAME = 'Personal';

/** A personal workspace, reduced to what callers route on. */
export type PersonalProject = { id: string; accountId: string; slug: string };

/**
 * The slugs a person's personal workspace may take, in the order to try them.
 *
 * Deterministic in the user id, which is what makes concurrent creation safe
 * without the partial index. Longer suffixes follow only so a shared workspace
 * that happens to hold the first slug cannot leave the person without one; a
 * 48-bit prefix colliding inside one account is not expected to happen.
 * @param userId - Auth.js user id.
 */
export function personalSlugCandidates(userId: string): string[] {
  const digest = createHash('sha256').update(userId).digest('hex');
  return [12, 20, 30].map(n => `personal-${digest.slice(0, n)}`);
}

/**
 * The person's home Org: their oldest membership (account id breaks a tie),
 * the order every Org list reads in. Null when they belong to none.
 * @param userId - The person.
 */
export async function homeAccountFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .orderBy(asc(accountMembershipSchema.createdAt), asc(accountMembershipSchema.accountId))
    .limit(1);
  return row?.accountId ?? null;
}

/**
 * Every live (unarchived) Personal the person owns, the one to keep first:
 * the one on `preferAccountId` (their home Org), then the oldest. More than
 * one only on a database from before one-Personal-per-person, until
 * `mergePersonalProjects` has folded them.
 * @param userId - The owner.
 * @param preferAccountId - The Org whose Personal wins, when there are several.
 */
export async function personalProjectsOf(userId: string, preferAccountId?: string | null): Promise<PersonalProject[]> {
  const rows = await db
    .select({ id: projectSchema.id, accountId: projectSchema.accountId, slug: projectSchema.slug })
    .from(projectSchema)
    .where(and(
      eq(projectSchema.ownerUserId, userId),
      eq(projectSchema.kind, 'personal'),
      isNull(projectSchema.archivedAt),
    ))
    .orderBy(asc(projectSchema.createdAt), asc(projectSchema.id));
  return preferAccountId
    ? [...rows.filter(r => r.accountId === preferAccountId), ...rows.filter(r => r.accountId !== preferAccountId)]
    : rows;
}

/**
 * The person's one Personal, if it exists: the one on their home Org when
 * there are several (an unmerged database), else the oldest.
 *
 * `accountId` is accepted for the callers that still name an Org and is no
 * longer a filter: a person has one Personal whichever Org they are in. It is
 * only the tie-break when the person belongs to no Org at all.
 * @param userId - The owner.
 * @param accountId - Ignored except as above.
 */
export async function findPersonalProject(userId: string, accountId?: string | null): Promise<PersonalProject | null> {
  const home = (await homeAccountFor(userId)) ?? accountId ?? null;
  return (await personalProjectsOf(userId, home))[0] ?? null;
}

/**
 * The owner's `project_member` row. Access to a personal workspace comes from
 * ownership, not from this row (`effectiveRole`), but the members screen and
 * anything that lists a workspace's people read `project_member`, and an empty
 * list on someone's own workspace reads as "nobody is here".
 * @param project - The personal workspace.
 * @param userId - Its owner.
 */
async function ensureOwnerRow(project: PersonalProject, userId: string): Promise<void> {
  await db
    .insert(projectMemberSchema)
    .values({ projectId: project.id, userId, role: 'admin', source: 'owner', addedBy: userId })
    .onConflictDoNothing();
}

/**
 * Everything a personal workspace holds from the moment it exists: its owner's
 * member row and the person's own assistant (`personalAssistant.ts`), which is
 * also the workspace's lead. Both idempotent, so every sign-in heals a
 * workspace made before either existed.
 * @param project - The personal workspace.
 * @param userId - Its owner.
 */
async function furnish(project: PersonalProject, userId: string): Promise<void> {
  await ensureOwnerRow(project, userId);
  await ensurePersonalAssistant(project.id);
}

/**
 * The person's one Personal, created on `accountId` if they have none yet.
 * Sign-in and invite acceptance reach it through
 * {@link ensurePersonalProjectsForUser}, which always passes the home Org, so
 * concurrent first sign-ins all create on the same Org and the per-Org unique
 * index (`project_personal_owner_uq`) lets only one through. Once one exists,
 * every caller gets it back, whichever Org it named.
 * @param userId - The owner.
 * @param accountId - The fallback Org.
 * @returns The personal workspace.
 */
export async function ensurePersonalProject(userId: string, accountId: string): Promise<PersonalProject> {
  const existing = await findPersonalProject(userId, accountId);
  if (existing) {
    await furnish(existing, userId);
    return existing;
  }
  return createPersonalProject(userId, accountId);
}

/**
 * Insert the person's Personal on `accountId`, losing quietly to a concurrent
 * insert and reading the winner back.
 * @param userId - The owner.
 * @param accountId - The Org it belongs to.
 */
async function createPersonalProject(userId: string, accountId: string): Promise<PersonalProject> {
  // One per person, not one per Org: concurrent first calls naming different
  // Orgs (a sign-in and a text on a shared number) take the same per-person
  // lock, and whoever comes second finds the first one's Personal.
  const made = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`personal:${userId}`}))`);
    const [existing] = await tx
      .select({ id: projectSchema.id, accountId: projectSchema.accountId, slug: projectSchema.slug })
      .from(projectSchema)
      .where(and(eq(projectSchema.ownerUserId, userId), eq(projectSchema.kind, 'personal'), isNull(projectSchema.archivedAt)))
      .orderBy(asc(projectSchema.createdAt), asc(projectSchema.id))
      .limit(1);
    if (existing) {
      return existing;
    }
    for (const slug of personalSlugCandidates(userId)) {
      // A slug the router would refuse is a bug here, not a reason to create a
      // workspace nobody can open.
      const problem = projectSlugProblem(slug);
      if (problem) {
        throw new Error(`personal workspace slug "${slug}" ${problem}`);
      }
      // A different workspace on this Org may hold the slug: then the next, longer one.
      const [row] = await tx
        .insert(projectSchema)
        .values({ id: `proj-${randomUUID()}`, accountId, slug, name: PERSONAL_PROJECT_NAME, kind: 'personal', ownerUserId: userId })
        .onConflictDoNothing()
        .returning({ id: projectSchema.id, accountId: projectSchema.accountId, slug: projectSchema.slug });
      if (row) {
        return row;
      }
    }
    return null;
  });
  if (!made) {
    throw new Error(`could not create a personal workspace for ${userId} on ${accountId}: every candidate slug is taken`);
  }
  await furnish(made, userId);
  return made;
}

/**
 * What sign-in and invite acceptance call: the person's one Personal, made if
 * missing, and moved to their home Org if it sits on an Org they have left
 * (where every resolver, joining on membership, would no longer find it).
 * Named in the plural for its callers; it returns at most one.
 *
 * Never throws. Sign-in must not fail because a workspace could not be made:
 * the failure is logged with its reason and the next sign-in tries again.
 * @param userId - The person.
 * @returns The Personal that exists afterwards, or nothing for someone in no Org.
 */
export async function ensurePersonalProjectsForUser(userId: string): Promise<PersonalProject[]> {
  try {
    const home = await homeAccountFor(userId);
    if (!home) {
      return [];
    }
    const mine = await personalProjectsOf(userId, home);
    const member = new Set((await db
      .select({ accountId: accountMembershipSchema.accountId })
      .from(accountMembershipSchema)
      .where(eq(accountMembershipSchema.userId, userId))).map(m => m.accountId));
    const reachable = mine.find(p => member.has(p.accountId));
    if (reachable) {
      await furnish(reachable, userId);
      return [reachable];
    }
    if (mine[0]) {
      // Left the Org it was on: re-home it, content and all, rather than make
      // a second one. The slug is per person, so it moves with it unless the
      // new Org already has a workspace on it, in which case a longer one.
      return [await rehome(mine[0], home, userId)];
    }
    return [await createPersonalProject(userId, home)];
  } catch (error) {
    // Imported here, not at the top: the logger loads the validated env, and
    // sign-in should not need every server variable set just to log a miss.
    const { logger } = await import('@/libs/Logger');
    logger.error('personal workspace could not be ensured; the next sign-in retries', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Move a Personal to another Org (its owner left the one it was on).
 * @param project - The Personal.
 * @param accountId - The Org it moves to.
 * @param userId - Its owner.
 */
async function rehome(project: PersonalProject, accountId: string, userId: string): Promise<PersonalProject> {
  for (const slug of [project.slug, ...personalSlugCandidates(userId)]) {
    const moved = await db
      .update(projectSchema)
      .set({ accountId, slug })
      .where(and(eq(projectSchema.id, project.id), notExists(db.select({ id: projectSchema.id }).from(projectSchema).where(and(eq(projectSchema.accountId, accountId), eq(projectSchema.slug, slug))))))
      .returning({ id: projectSchema.id, accountId: projectSchema.accountId, slug: projectSchema.slug });
    if (moved[0]) {
      await furnish(moved[0], userId);
      return moved[0];
    }
  }
  throw new Error(`could not move personal workspace ${project.id} to ${accountId}: every candidate slug is taken`);
}

/**
 * Give every existing member of every account their personal workspace.
 *
 * Sign-in already does this person by person, so this is only for an
 * operator who wants them in place before people next sign in
 * (`npm run backfill:personal-projects`). Not run on deploy: a new workspace
 * in everyone's switcher is a product change, and it should land when people
 * arrive rather than as a side effect of a migration.
 * @returns How many memberships were checked and how many workspaces created.
 */
export async function backfillPersonalProjects(): Promise<{ checked: number; created: number }> {
  const people = await db
    .selectDistinct({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .orderBy(asc(accountMembershipSchema.userId));
  let created = 0;
  for (const { userId } of people) {
    const before = await findPersonalProject(userId);
    if (!before) {
      await ensurePersonalProjectsForUser(userId);
      created += 1;
    }
  }
  return { checked: people.length, created };
}
