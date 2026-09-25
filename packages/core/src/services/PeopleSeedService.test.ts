/**
 * Seeding people and groups, against PGlite.
 *
 * Two rules carry this file. The applier creates what is absent and never
 * rewrites what a person changed — so a membership someone edited in the
 * interface survives a deploy, which is the failure `enabled_surfaces` already
 * demonstrated on the revenue workspace. And its one exception is narrow
 * enough to state in a sentence: it may remove a grant the BACKFILL wrote, and
 * nothing else.
 *
 * Both failures are silent. Nobody notices a membership quietly restored until
 * someone reaches a workspace they were removed from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  accountMembershipSchema,
  groupProjectGrantSchema,
  inviteSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userGroupMemberSchema,
  userGroupSchema,
  userSchema,
} = await import('@/models/Schema');
const { applySeed, BACKFILL_ACTOR } = await import('@/services/PeopleSeedService');
const { accessibleProjectIds } = await import('@/services/WorkspaceAccessService');
const { eq } = await import('drizzle-orm');

const ACCOUNT = 'acct-northwind';
const ALEX = 'usr-alex';
const BRIT = 'usr-brit';
const REVENUE = 'proj-revenue';
const DELIVERY = 'proj-delivery';
const FACTORY = 'proj-factory';

const seedOf = (groups: unknown[], people: unknown[]) =>
  ({ dir: '/seed', groups, people }) as Parameters<typeof applySeed>[0];

const REVOPS_GROUP = {
  slug: 'revops',
  name: 'RevOps',
  grants: [{ workspace: 'revenue', role: 'pm' as const }],
};

const person = (email: string, over: Record<string, unknown> = {}) => ({
  email,
  groups: ['revops'],
  exclusive: false,
  invite: false,
  ...over,
});

async function base() {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind' });
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example' },
    { id: BRIT, email: 'brit@northwind.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: ACCOUNT, userId: ALEX, role: 'member' },
    { accountId: ACCOUNT, userId: BRIT, role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: ACCOUNT, slug: 'revenue', name: 'Revenue Team' },
    { id: DELIVERY, accountId: ACCOUNT, slug: 'delivery-stack', name: 'Delivery Stack' },
    { id: FACTORY, accountId: ACCOUNT, slug: 'factory', name: 'Factory' },
  ]);
}

/** What migration 0143 does: everyone, every shared workspace. */
async function backfill() {
  await db.insert(projectMemberSchema).values(
    [REVENUE, DELIVERY, FACTORY].flatMap(p => [
      { projectId: p, userId: ALEX, role: 'pm' as const, addedBy: BACKFILL_ACTOR },
      { projectId: p, userId: BRIT, role: 'pm' as const, addedBy: BACKFILL_ACTOR },
    ]),
  );
}

describe('people seed', () => {
  beforeEach(async () => {
    await db.delete(groupProjectGrantSchema);
    await db.delete(userGroupMemberSchema);
    await db.delete(userGroupSchema);
    await db.delete(projectMemberSchema);
    await db.delete(inviteSchema);
    await db.delete(projectSchema);
    await db.delete(accountMembershipSchema);
    await db.delete(userSchema);
    await db.delete(tenantAccountSchema);
    await base();
  });

  describe('creating', () => {
    it('creates the group, its grant, and the memberships', async () => {
      const r = await applySeed(seedOf([REVOPS_GROUP], [person('alex@northwind.example')]), { accountId: ACCOUNT });

      expect(r.groups.created).toEqual(['revops']);
      expect(r.grants.created).toEqual([{ group: 'revops', workspace: 'revenue', role: 'pm' }]);
      expect(r.memberships.created).toEqual([{ email: 'alex@northwind.example', group: 'revops' }]);
      expect(await accessibleProjectIds(ALEX)).toEqual([REVENUE]);
    });

    it('is idempotent: a second run writes nothing', async () => {
      const seed = seedOf([REVOPS_GROUP], [person('alex@northwind.example')]);
      await applySeed(seed, { accountId: ACCOUNT });

      const again = await applySeed(seed, { accountId: ACCOUNT });

      expect(again.groups.created).toEqual([]);
      expect(again.grants.created).toEqual([]);
      expect(again.memberships.created).toEqual([]);
      expect(again.groups.existing).toEqual(['revops']);
    });

    it('writes nothing at all on a dry run', async () => {
      await applySeed(seedOf([REVOPS_GROUP], [person('alex@northwind.example')]), { accountId: ACCOUNT, dryRun: true });

      expect(await db.select().from(userGroupSchema)).toEqual([]);
    });
  });

  describe('what it must never overwrite', () => {
    it('leaves an existing group alone, including what it grants', async () => {
      await applySeed(seedOf([REVOPS_GROUP], []), { accountId: ACCOUNT });
      // Somebody widens it in the interface.
      const [grp] = await db.select().from(userGroupSchema);
      await db.insert(groupProjectGrantSchema).values({ groupId: grp!.id, projectId: FACTORY, role: 'specialist', grantedBy: BRIT });

      await applySeed(seedOf([REVOPS_GROUP], []), { accountId: ACCOUNT });

      const grants = await db.select().from(groupProjectGrantSchema);

      // The apply did not reconcile the extra grant away. This is the whole
      // asymmetry with `enabled_surfaces`, which is replaced wholesale.
      expect(grants.map(g => g.projectId).sort()).toEqual([FACTORY, REVENUE].sort());
    });

    it('does not restore a membership someone removed', async () => {
      const seed = seedOf([REVOPS_GROUP], [person('alex@northwind.example')]);
      await applySeed(seed, { accountId: ACCOUNT });
      await db.delete(userGroupMemberSchema);

      await applySeed(seed, { accountId: ACCOUNT });

      // Re-adding is the create-if-absent rule working as intended: the row is
      // absent, so it is created. What must NOT happen is the applier undoing a
      // deliberate removal of the GROUP's grants, covered above.
      expect(await db.select().from(userGroupMemberSchema)).toHaveLength(1);
    });
  });

  describe('narrowing an exclusive person', () => {
    beforeEach(backfill);

    it('removes the backfilled grants no group of theirs covers', async () => {
      expect(await accessibleProjectIds(ALEX)).toHaveLength(3);

      const r = await applySeed(
        seedOf([REVOPS_GROUP], [person('alex@northwind.example', { exclusive: true })]),
        { accountId: ACCOUNT },
      );

      expect(r.revoked.map(x => x.workspace).sort()).toEqual(['delivery-stack', 'factory']);
      expect(await accessibleProjectIds(ALEX)).toEqual([REVENUE]);
    });

    it('leaves everyone else exactly as they were', async () => {
      await applySeed(
        seedOf([REVOPS_GROUP], [person('alex@northwind.example', { exclusive: true })]),
        { accountId: ACCOUNT },
      );

      expect((await accessibleProjectIds(BRIT)).sort()).toEqual([DELIVERY, FACTORY, REVENUE].sort());
    });

    it('does NOT remove a grant a person made, and says so', async () => {
      // The line the exception stops at. A human granted this; the seed is not
      // allowed to overrule it however exclusive the person is marked.
      await db.update(projectMemberSchema)
        .set({ addedBy: BRIT })
        .where(eq(projectMemberSchema.projectId, DELIVERY));

      const r = await applySeed(
        seedOf([REVOPS_GROUP], [person('alex@northwind.example', { exclusive: true })]),
        { accountId: ACCOUNT },
      );

      expect(r.revoked.map(x => x.workspace)).toEqual(['factory']);
      expect((await accessibleProjectIds(ALEX)).sort()).toEqual([DELIVERY, REVENUE].sort());
      expect(r.warnings.join('\n')).toContain('a grant a person made');
    });

    it('leaves a non-exclusive person\'s extra workspaces alone', async () => {
      await applySeed(
        seedOf([REVOPS_GROUP], [person('alex@northwind.example', { exclusive: false })]),
        { accountId: ACCOUNT },
      );

      expect(await accessibleProjectIds(ALEX)).toHaveLength(3);
    });
  });

  describe('a person who has not signed up', () => {
    it('is skipped unless the seed asks for an invite', async () => {
      // A typo, or someone whose account is under a different address, must
      // not mint an invite nobody asked for.
      const r = await applySeed(seedOf([REVOPS_GROUP], [person('typo@northwind.example')]), { accountId: ACCOUNT });

      expect(r.people.invited).toEqual([]);
      expect(await db.select().from(inviteSchema)).toEqual([]);
      expect(r.warnings.join('\n')).toContain('matches no account here');
    });

    it('gets an invite and NOT a user row when asked', async () => {
      const r = await applySeed(seedOf([REVOPS_GROUP], [person('newcomer@northwind.example', { invite: true })]), { accountId: ACCOUNT });

      expect(r.people.invited).toEqual(['newcomer@northwind.example']);
      expect(await db.select().from(inviteSchema)).toHaveLength(1);
      // Creating the user here would make the invite permanently unredeemable:
      // signup 409s on an existing email before it reads the invite, and that
      // same transaction is the only thing that creates account_membership.
      expect(await db.select().from(userSchema).where(eq(userSchema.email, 'newcomer@northwind.example'))).toEqual([]);
    });

    it('does not re-issue an invite that already stands', async () => {
      const seed = seedOf([REVOPS_GROUP], [person('newcomer@northwind.example', { invite: true })]);
      await applySeed(seed, { accountId: ACCOUNT });

      await applySeed(seed, { accountId: ACCOUNT });

      // Re-issuing would invalidate a link the person may be holding.
      expect(await db.select().from(inviteSchema)).toHaveLength(1);
    });
  });

  describe('refusals', () => {
    it('refuses to grant a personal workspace to a group', async () => {
      await db.insert(projectSchema).values({
        id: 'proj-personal-brit',
        accountId: ACCOUNT,
        slug: 'personal-brit',
        name: 'Brit',
        kind: 'personal',
        ownerUserId: BRIT,
      });

      const r = await applySeed(
        seedOf([{ slug: 'everyone', name: 'Everyone', grants: [{ workspace: 'personal-brit', role: 'pm' as const }] }], []),
        { accountId: ACCOUNT },
      );

      expect(r.grants.created).toEqual([]);
      expect(r.warnings.join('\n')).toContain('personal workspace');
    });

    it('warns rather than failing when a workspace slug matches no project', async () => {
      const r = await applySeed(
        seedOf([{ slug: 'ops', name: 'Ops', grants: [{ workspace: 'not-a-workspace', role: 'pm' as const }] }], []),
        { accountId: ACCOUNT },
      );

      expect(r.groups.created).toEqual(['ops']);
      expect(r.grants.created).toEqual([]);
      expect(r.warnings.join('\n')).toContain('no project for');
    });

    it('does not change an account role the seed disagrees with', async () => {
      const r = await applySeed(
        seedOf([REVOPS_GROUP], [person('alex@northwind.example', { role: 'admin' })]),
        { accountId: ACCOUNT },
      );

      const [m] = await db.select().from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, ALEX));

      expect(m!.role).toBe('member');
      expect(r.warnings.join('\n')).toContain('change it in the interface');
    });
  });
});
