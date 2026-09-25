/**
 * Apply a deployment seed: people, groups, and what each group opens.
 *
 * **Create-if-absent, and nothing else.** A group that exists is left entirely
 * alone, grants and membership included. A person who exists is never
 * rewritten. Deleting a person from the YAML deprovisions nobody. This is the
 * opposite of how `workspace.yaml` is applied, where `enabled_surfaces` is
 * replaced wholesale on every run — correct for workspace config, and how
 * Personalization and Discovery vanished from the revenue workspace on
 * 2026-09-15. A membership someone edited in the interface must survive a
 * deploy, so the applier is not allowed to reconcile.
 *
 * ONE EXCEPTION, and it is narrow. A person marked `exclusive` may have a
 * `project_member` row REMOVED when no group of theirs grants that workspace —
 * but only a row the backfill wrote (`added_by = 'backfill-0145'`). That row is
 * a machine-generated default, not a decision: migration 0145 gave every member
 * every shared workspace so nobody lost access at cutover. Without this, "Lili
 * reaches RevOps and nothing else" cannot be expressed at all. A grant a person
 * made is still never touched, whoever they are.
 *
 * A person with no `user` row gets an INVITE, never a user row. `app/api/signup`
 * rejects an existing email with a 409 BEFORE it reads the invite, and the same
 * transaction is the only thing that creates `account_membership` — so
 * pre-creating the user makes its own invite permanently unredeemable and
 * leaves them with no membership at all.
 */

import type { LoadedSeed } from '@/libs/deployment/loader';
import type { SeedPerson, SeedRole } from '@/libs/deployment/schemas';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  groupProjectGrantSchema,
  inviteSchema,
  projectMemberSchema,
  projectSchema,
  userGroupMemberSchema,
  userGroupSchema,
  userSchema,
} from '@/models/Schema';

/** What migration 0145 stamps on the rows it writes. Only these may be removed. */
export const BACKFILL_ACTOR = 'backfill-0145';

/** Who the applier records as the author of a row it creates. */
const SEED_ACTOR = 'yaml';

/** How long a seeded invite stays redeemable. */
const INVITE_DAYS = 30;

export type SeedApplyResult = {
  accountId: string;
  groups: { created: string[]; existing: string[] };
  grants: { created: { group: string; workspace: string; role: SeedRole }[] };
  people: { invited: string[]; existing: string[] };
  memberships: { created: { email: string; group: string }[] };
  revoked: { email: string; workspace: string }[];
  /** Things a person has to fix. Never thrown: the rest of the apply proceeds. */
  warnings: string[];
};

export type SeedApplyOptions = {
  /** The tenant account to seed into. */
  accountId: string;
  /** Validate and report without writing. */
  dryRun?: boolean;
};

/**
 * The account real people sign into: the one with the most memberships.
 *
 * Mirrors what `infra/aws/apply-workspace.sh` resolves, and for the same
 * reason — the oldest `tenant_account` can be an empty seed account nobody
 * logs into, and rows created there are invisible to every real user.
 */
export async function defaultAccountId(): Promise<string | null> {
  const [row] = await db
    .select({ accountId: accountMembershipSchema.accountId, n: sql<number>`count(*)::int` })
    .from(accountMembershipSchema)
    .groupBy(accountMembershipSchema.accountId)
    .orderBy(sql`count(*) desc`)
    .limit(1);
  return row?.accountId ?? null;
}

export async function applySeed(seed: LoadedSeed, opts: SeedApplyOptions): Promise<SeedApplyResult> {
  const { accountId, dryRun = false } = opts;
  const result: SeedApplyResult = {
    accountId,
    groups: { created: [], existing: [] },
    grants: { created: [] },
    people: { invited: [], existing: [] },
    memberships: { created: [] },
    revoked: [],
    warnings: [],
  };

  // Workspaces are named by slug in the YAML; everything below needs ids.
  const projects = await db
    .select({ id: projectSchema.id, slug: projectSchema.slug, kind: projectSchema.kind })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, accountId));
  const projectBySlug = new Map(projects.map(p => [p.slug, p]));

  // ---- groups ----------------------------------------------------------
  const existingGroups = await db
    .select({ id: userGroupSchema.id, slug: userGroupSchema.slug })
    .from(userGroupSchema)
    .where(eq(userGroupSchema.accountId, accountId));
  const groupIdBySlug = new Map(existingGroups.map(g => [g.slug, g.id]));

  for (const g of seed.groups) {
    if (groupIdBySlug.has(g.slug)) {
      result.groups.existing.push(g.slug);
      // Left entirely alone, grants included. Someone may have changed what
      // this group opens, and that decision outranks the file.
      continue;
    }
    const id = `grp-${randomUUID()}`;
    result.groups.created.push(g.slug);
    if (!dryRun) {
      await db.insert(userGroupSchema).values({
        id,
        accountId,
        slug: g.slug,
        name: g.name,
        description: g.description ?? null,
        managedFrom: 'yaml',
      });
    }
    groupIdBySlug.set(g.slug, id);

    for (const grant of g.grants) {
      const project = projectBySlug.get(grant.workspace);
      if (!project) {
        result.warnings.push(`group "${g.slug}" grants workspace "${grant.workspace}", which this account has no project for — skipped`);
        continue;
      }
      if (project.kind === 'personal') {
        result.warnings.push(`group "${g.slug}" grants "${grant.workspace}", which is someone's personal workspace — refused`);
        continue;
      }
      result.grants.created.push({ group: g.slug, workspace: grant.workspace, role: grant.role });
      if (!dryRun) {
        await db.insert(groupProjectGrantSchema)
          .values({ groupId: id, projectId: project.id, role: grant.role, grantedBy: SEED_ACTOR })
          .onConflictDoNothing();
      }
    }
  }

  // ---- people ----------------------------------------------------------
  for (const person of seed.people) {
    const [user] = await db
      .select({ id: userSchema.id })
      .from(userSchema)
      .where(eq(userSchema.email, person.email))
      .limit(1);

    if (!user) {
      if (!person.invite) {
        result.warnings.push(
          `"${person.email}" matches no account here and is not marked \`invite: true\` — skipped. `
          + `Check the address, or set invite: true to send them one.`,
        );
        continue;
      }
      await inviteOnly(person, accountId, dryRun, result);
      continue;
    }
    result.people.existing.push(person.email);

    // Membership in the account itself is not this applier's to change: a role
    // change is an administrative act with its own audit, not a side effect of
    // a deploy. Say so rather than silently doing nothing.
    const [membership] = await db
      .select({ role: accountMembershipSchema.role })
      .from(accountMembershipSchema)
      .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.userId, user.id)))
      .limit(1);
    if (!membership) {
      result.warnings.push(`"${person.email}" has an account elsewhere but is not a member of this one — group membership skipped; invite them first`);
      continue;
    }
    if (person.role && membership.role !== person.role) {
      result.warnings.push(`"${person.email}" is ${membership.role} on this account and the seed says ${person.role} — left as ${membership.role}; change it in the interface`);
    }

    await joinGroups(person, user.id, groupIdBySlug, dryRun, result);

    if (person.exclusive) {
      await narrowToGroups(person, user.id, groupIdBySlug, projectBySlug, dryRun, result);
    }
  }

  return result;
}

async function inviteOnly(person: SeedPerson, accountId: string, dryRun: boolean, result: SeedApplyResult): Promise<void> {
  const [open] = await db
    .select({ id: inviteSchema.id })
    .from(inviteSchema)
    .where(and(eq(inviteSchema.accountId, accountId), eq(inviteSchema.email, person.email)))
    .limit(1);
  if (open) {
    // An invite already stands. Re-issuing would invalidate a link someone may
    // be holding, which is a worse outcome than doing nothing.
    result.people.existing.push(person.email);
    return;
  }
  result.people.invited.push(person.email);
  result.warnings.push(
    `"${person.email}" has no account yet. An invite is created, and their group memberships land when they accept it — `
    + `a seeded person is not a user row until then, so nothing can reference them before that.`,
  );
  if (!dryRun) {
    await db.insert(inviteSchema).values({
      id: `inv-${randomUUID()}`,
      accountId,
      email: person.email,
      role: person.role ?? 'member',
      token: randomUUID().replaceAll('-', ''),
      invitedBy: null,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
    });
  }
}

async function joinGroups(
  person: SeedPerson,
  userId: string,
  groupIdBySlug: Map<string, string>,
  dryRun: boolean,
  result: SeedApplyResult,
): Promise<void> {
  for (const slug of person.groups) {
    const groupId = groupIdBySlug.get(slug);
    if (!groupId) {
      result.warnings.push(`"${person.email}" is in group "${slug}", which does not exist on this account — skipped`);
      continue;
    }
    const [already] = await db
      .select({ userId: userGroupMemberSchema.userId })
      .from(userGroupMemberSchema)
      .where(and(eq(userGroupMemberSchema.groupId, groupId), eq(userGroupMemberSchema.userId, userId)))
      .limit(1);
    if (already) {
      continue;
    }
    result.memberships.created.push({ email: person.email, group: slug });
    if (!dryRun) {
      await db.insert(userGroupMemberSchema)
        .values({ groupId, userId, addedBy: SEED_ACTOR })
        .onConflictDoNothing();
    }
  }
}

/**
 * The one place this applier removes anything, and only rows the backfill
 * wrote. See the module docstring for why that line is where it is.
 * @param person
 * @param userId
 * @param groupIdBySlug
 * @param projectBySlug
 * @param dryRun
 * @param result
 */
async function narrowToGroups(
  person: SeedPerson,
  userId: string,
  groupIdBySlug: Map<string, string>,
  projectBySlug: Map<string, { id: string; slug: string; kind: string }>,
  dryRun: boolean,
  result: SeedApplyResult,
): Promise<void> {
  const groupIds = person.groups
    .map((s: string) => groupIdBySlug.get(s))
    .filter((v): v is string => Boolean(v));
  const granted = groupIds.length > 0
    ? await db
        .select({ projectId: groupProjectGrantSchema.projectId })
        .from(groupProjectGrantSchema)
        .where(inArray(groupProjectGrantSchema.groupId, groupIds))
    : [];
  const keep = new Set(granted.map(g => g.projectId));

  const held = await db
    .select({ projectId: projectMemberSchema.projectId, addedBy: projectMemberSchema.addedBy })
    .from(projectMemberSchema)
    .where(eq(projectMemberSchema.userId, userId));

  const slugById = new Map([...projectBySlug.values()].map(p => [p.id, p.slug]));

  for (const row of held) {
    if (keep.has(row.projectId)) {
      continue;
    }
    if (row.addedBy !== BACKFILL_ACTOR) {
      // Somebody granted this deliberately. The seed does not overrule people.
      result.warnings.push(
        `"${person.email}" is exclusive but holds "${slugById.get(row.projectId) ?? row.projectId}" from a grant a person made — kept. `
        + `Remove it in the interface if it should go.`,
      );
      continue;
    }
    result.revoked.push({ email: person.email, workspace: slugById.get(row.projectId) ?? row.projectId });
    if (!dryRun) {
      await db.delete(projectMemberSchema).where(and(
        eq(projectMemberSchema.userId, userId),
        eq(projectMemberSchema.projectId, row.projectId),
        eq(projectMemberSchema.addedBy, BACKFILL_ACTOR),
      ));
    }
  }
}
