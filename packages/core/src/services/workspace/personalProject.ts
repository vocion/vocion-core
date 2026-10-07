/**
 * Every person's own workspace: one per person per account, private to them.
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
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSlugProblem } from '@/libs/links';
import { accountMembershipSchema, projectMemberSchema, projectSchema } from '@/models/Schema';

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
 * The person's personal workspace on one account, if it exists. Oldest first,
 * so a database that held duplicates before 0170 always answers with the same
 * one.
 * @param userId - The owner.
 * @param accountId - The account.
 */
export async function findPersonalProject(userId: string, accountId: string): Promise<PersonalProject | null> {
  const [row] = await db
    .select({ id: projectSchema.id, accountId: projectSchema.accountId, slug: projectSchema.slug })
    .from(projectSchema)
    .where(and(
      eq(projectSchema.accountId, accountId),
      eq(projectSchema.ownerUserId, userId),
      eq(projectSchema.kind, 'personal'),
    ))
    .orderBy(asc(projectSchema.createdAt), asc(projectSchema.id))
    .limit(1);
  return row ?? null;
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
 * The person's personal workspace on this account, created if it does not
 * exist yet. Idempotent and safe to call concurrently: every caller gets the
 * same row back.
 *
 * Does not check that the person is a member of the account — the callers are
 * the places that just made them one. A workspace on an account they are not
 * in is unreachable anyway, because every resolver joins on membership.
 * @param userId - The owner.
 * @param accountId - The account it belongs to.
 * @returns The personal workspace.
 */
export async function ensurePersonalProject(userId: string, accountId: string): Promise<PersonalProject> {
  const existing = await findPersonalProject(userId, accountId);
  if (existing) {
    await ensureOwnerRow(existing, userId);
    return existing;
  }

  for (const slug of personalSlugCandidates(userId)) {
    // A slug the router would refuse is a bug here, not a reason to create a
    // workspace nobody can open.
    const problem = projectSlugProblem(slug);
    if (problem) {
      throw new Error(`personal workspace slug "${slug}" ${problem}`);
    }
    // No conflict target: the insert may lose on the partial unique index OR
    // on (account_id, slug), and either way the winner is read back below.
    await db
      .insert(projectSchema)
      .values({
        id: `proj-${randomUUID()}`,
        accountId,
        slug,
        name: PERSONAL_PROJECT_NAME,
        kind: 'personal',
        ownerUserId: userId,
      })
      .onConflictDoNothing();
    const created = await findPersonalProject(userId, accountId);
    if (created) {
      await ensureOwnerRow(created, userId);
      return created;
    }
    // Nothing of ours came back, so a different workspace holds this slug.
    // Try the next, longer one.
  }
  throw new Error(`could not create a personal workspace for ${userId} on ${accountId}: every candidate slug is taken`);
}

/**
 * `ensurePersonalProject` for every account the person belongs to — what
 * sign-in calls, so everyone who signs in has one in each of their accounts,
 * including people who joined before personal workspaces existed.
 *
 * Never throws. Sign-in must not fail because a workspace could not be made:
 * the failure is logged with its reason and the next sign-in tries again.
 * @param userId - The person.
 * @returns The personal workspaces that exist afterwards.
 */
export async function ensurePersonalProjectsForUser(userId: string): Promise<PersonalProject[]> {
  try {
    const memberships = await db
      .select({ accountId: accountMembershipSchema.accountId })
      .from(accountMembershipSchema)
      .where(eq(accountMembershipSchema.userId, userId))
      .orderBy(asc(accountMembershipSchema.createdAt), asc(accountMembershipSchema.accountId));
    const out: PersonalProject[] = [];
    for (const m of memberships) {
      out.push(await ensurePersonalProject(userId, m.accountId));
    }
    return out;
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
  const memberships = await db
    .select({ userId: accountMembershipSchema.userId, accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .orderBy(asc(accountMembershipSchema.createdAt));
  let created = 0;
  for (const m of memberships) {
    const before = await findPersonalProject(m.userId, m.accountId);
    if (!before) {
      await ensurePersonalProject(m.userId, m.accountId);
      created += 1;
    }
  }
  return { checked: memberships.length, created };
}
