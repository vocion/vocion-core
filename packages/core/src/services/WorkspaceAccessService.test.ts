/**
 * Who reaches which workspace, against PGlite.
 *
 * These are the cases that decide whether per-person workspaces are safe to
 * build on. The ones that matter most are the refusals: a colleague must not
 * reach a personal workspace, and neither must an account admin, because a
 * personal workspace holds that person's own mail and "admin" is not consent.
 * Both failures are silent — nothing throws, someone simply sees an inbox that
 * is not theirs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  accountMembershipSchema,
  groupProjectGrantSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userGroupMemberSchema,
  userGroupSchema,
  userSchema,
} = await import('@/models/Schema');
const { accessibleProjects, effectiveRole, strongerRole } = await import('@/services/WorkspaceAccessService');

const ACCOUNT = 'acct-northwind';
const OTHER_ACCOUNT = 'acct-kestrel';

const ALEX = 'usr-alex'; // sales, in the revenue group
const BRIT = 'usr-brit'; // delivery, in the delivery group
const CASS = 'usr-cass'; // account admin
const DREW = 'usr-drew'; // in no group at all

const REVENUE = 'proj-revenue';
const DELIVERY = 'proj-delivery';
const FACTORY = 'proj-factory';
const ALEX_PERSONAL = 'proj-personal-alex';
const BRIT_PERSONAL = 'proj-personal-brit';

async function seed() {
  await db.insert(tenantAccountSchema).values([
    { id: ACCOUNT, name: 'Northwind', slug: 'northwind' },
    { id: OTHER_ACCOUNT, name: 'Kestrel Capital', slug: 'kestrel' },
  ]);

  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example' },
    { id: BRIT, email: 'brit@northwind.example' },
    { id: CASS, email: 'cass@northwind.example' },
    { id: DREW, email: 'drew@northwind.example' },
  ]);

  await db.insert(accountMembershipSchema).values([
    { accountId: ACCOUNT, userId: ALEX, role: 'member' },
    { accountId: ACCOUNT, userId: BRIT, role: 'member' },
    { accountId: ACCOUNT, userId: CASS, role: 'admin' },
    { accountId: ACCOUNT, userId: DREW, role: 'member' },
  ]);

  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: ACCOUNT, slug: 'revenue', name: 'Revenue Team' },
    { id: DELIVERY, accountId: ACCOUNT, slug: 'delivery-stack', name: 'Delivery Stack' },
    { id: FACTORY, accountId: ACCOUNT, slug: 'factory', name: 'Factory' },
    { id: ALEX_PERSONAL, accountId: ACCOUNT, slug: 'personal-alex', name: 'Alex', kind: 'personal', ownerUserId: ALEX },
    { id: BRIT_PERSONAL, accountId: ACCOUNT, slug: 'personal-brit', name: 'Brit', kind: 'personal', ownerUserId: BRIT },
  ]);

  await db.insert(userGroupSchema).values([
    { id: 'grp-revenue', accountId: ACCOUNT, slug: 'revenue-team', name: 'Revenue Team' },
    { id: 'grp-delivery', accountId: ACCOUNT, slug: 'delivery-team', name: 'Delivery Team' },
  ]);
  await db.insert(userGroupMemberSchema).values([
    { groupId: 'grp-revenue', userId: ALEX },
    { groupId: 'grp-delivery', userId: BRIT },
  ]);
  await db.insert(groupProjectGrantSchema).values([
    { groupId: 'grp-revenue', projectId: REVENUE, role: 'pm' },
    { groupId: 'grp-delivery', projectId: DELIVERY, role: 'pm' },
    { groupId: 'grp-delivery', projectId: FACTORY, role: 'specialist' },
  ]);
}

const idsFor = async (userId: string) => (await accessibleProjects(userId)).map(a => a.projectId).sort();

describe('workspace access', () => {
  beforeEach(async () => {
    await db.delete(groupProjectGrantSchema);
    await db.delete(userGroupMemberSchema);
    await db.delete(userGroupSchema);
    await db.delete(projectMemberSchema);
    await db.delete(projectSchema);
    await db.delete(accountMembershipSchema);
    await db.delete(userSchema);
    await db.delete(tenantAccountSchema);
    await seed();
  });

  describe('group grants', () => {
    it('gives a salesperson the revenue workspace and their own, and nothing else', async () => {
      expect(await idsFor(ALEX)).toEqual([ALEX_PERSONAL, REVENUE].sort());
    });

    it('gives a delivery engineer both delivery workspaces at the granted roles', async () => {
      expect(await idsFor(BRIT)).toEqual([BRIT_PERSONAL, DELIVERY, FACTORY].sort());
      expect(await effectiveRole(BRIT, DELIVERY)).toBe('pm');
      expect(await effectiveRole(BRIT, FACTORY)).toBe('specialist');
    });

    it('refuses the other team\'s workspace', async () => {
      expect(await effectiveRole(ALEX, DELIVERY)).toBeNull();
      expect(await effectiveRole(BRIT, REVENUE)).toBeNull();
    });

    it('takes effect immediately when someone leaves a group', async () => {
      // The grant is resolved at read time, not expanded into rows, so there is
      // nothing to re-expand before this is true.
      await db.delete(userGroupMemberSchema);

      expect(await effectiveRole(ALEX, REVENUE)).toBeNull();
    });
  });

  describe('personal workspaces', () => {
    it('lets the owner in as owner', async () => {
      expect(await effectiveRole(ALEX, ALEX_PERSONAL)).toBe('owner');
    });

    it('refuses a colleague', async () => {
      expect(await effectiveRole(BRIT, ALEX_PERSONAL)).toBeNull();
      expect(await idsFor(BRIT)).not.toContain(ALEX_PERSONAL);
    });

    it('refuses an ACCOUNT ADMIN', async () => {
      // The one that would be easiest to get wrong, and the one whose failure
      // is least visible. Admin runs the deployment; it does not open someone
      // else's mail.
      expect(await effectiveRole(CASS, ALEX_PERSONAL)).toBeNull();
      expect(await idsFor(CASS)).not.toContain(ALEX_PERSONAL);
    });

    it('ignores a direct grant written against someone else\'s personal workspace', async () => {
      // The service layer refuses to write this row. If one exists anyway, it
      // must be inert rather than effective.
      await db.insert(projectMemberSchema).values({ projectId: ALEX_PERSONAL, userId: BRIT, role: 'owner' });

      expect(await effectiveRole(BRIT, ALEX_PERSONAL)).toBeNull();
      expect(await idsFor(BRIT)).not.toContain(ALEX_PERSONAL);
    });
  });

  describe('account admins', () => {
    it('run every shared workspace', async () => {
      expect(await idsFor(CASS)).toEqual([DELIVERY, FACTORY, REVENUE].sort());
      expect(await effectiveRole(CASS, REVENUE)).toBe('owner');
    });
  });

  describe('a person with no grants', () => {
    it('reaches nothing at all', async () => {
      expect(await idsFor(DREW)).toEqual([]);
      expect(await effectiveRole(DREW, REVENUE)).toBeNull();
    });

    it('is told nothing exists, rather than that it is forbidden', async () => {
      // Same answer for "no access" and "no such workspace". On a deployment
      // where workspaces are named after people, the difference is a
      // disclosure.
      expect(await effectiveRole(DREW, REVENUE)).toBe(await effectiveRole(DREW, 'proj-does-not-exist'));
    });
  });

  describe('direct grants', () => {
    it('stack with group grants, strongest winning', async () => {
      await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: ALEX, role: 'owner' });

      expect(await effectiveRole(ALEX, REVENUE)).toBe('owner');
    });

    it('do not weaken a stronger group grant', async () => {
      await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: ALEX, role: 'client_reviewer' });

      expect(await effectiveRole(ALEX, REVENUE)).toBe('pm');
    });
  });

  describe('account isolation', () => {
    it('never reaches a project on another account', async () => {
      await db.insert(projectSchema).values({ id: 'proj-foreign', accountId: OTHER_ACCOUNT, slug: 'foreign', name: 'Foreign' });
      await db.insert(userGroupSchema).values({ id: 'grp-x', accountId: ACCOUNT, slug: 'x', name: 'X' });
      await db.insert(userGroupMemberSchema).values({ groupId: 'grp-x', userId: ALEX });
      await db.insert(groupProjectGrantSchema).values({ groupId: 'grp-x', projectId: 'proj-foreign', role: 'owner' });

      expect(await effectiveRole(ALEX, 'proj-foreign')).toBeNull();
      expect(await idsFor(ALEX)).not.toContain('proj-foreign');
    });

    it('gives a person with no membership nothing', async () => {
      expect(await accessibleProjects('usr-nobody')).toEqual([]);
      expect(await effectiveRole('usr-nobody', REVENUE)).toBeNull();
    });
  });

  describe('strongerRole', () => {
    it('ranks owner above pm above specialist above client_reviewer', () => {
      expect(strongerRole('pm', 'owner')).toBe('owner');
      expect(strongerRole('specialist', 'pm')).toBe('pm');
      expect(strongerRole('client_reviewer', 'specialist')).toBe('specialist');
    });

    it('treats null as no access at all', () => {
      expect(strongerRole(null, 'specialist')).toBe('specialist');
      expect(strongerRole('specialist', null)).toBe('specialist');
      expect(strongerRole(null, null)).toBeNull();
    });
  });
});

/**
 * `Schema.ts` declares the four roles a second time (it stays free of service
 * imports) and the DDL pins them a third time with a CHECK. These assert the
 * database and the code agree, so a role the grant model accepts can never be
 * one the constraint rejects, or the reverse.
 */
describe('role vocabulary', () => {
  const ROLES = ['owner', 'pm', 'specialist', 'client_reviewer'] as const;

  it('accepts every role the resolver can return', async () => {
    for (const role of ROLES) {
      await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: DREW, role });

      expect(await effectiveRole(DREW, REVENUE)).toBe(role);

      await db.delete(projectMemberSchema);
    }
  });

  it('rejects a role outside that set', async () => {
    await expect(
      db.insert(projectMemberSchema).values({
        projectId: REVENUE,
        userId: DREW,

        role: 'superuser' as any,
      }),
    ).rejects.toThrow();
  });

  it('rejects a project_member source outside direct/owner', async () => {
    await expect(
      db.insert(projectMemberSchema).values({
        projectId: REVENUE,
        userId: DREW,
        role: 'pm',

        source: 'group' as any,
      }),
    ).rejects.toThrow();
  });

  it('rejects a project kind outside shared/personal', async () => {
    await expect(
      db.insert(projectSchema).values({
        id: 'proj-bad-kind',
        accountId: ACCOUNT,
        slug: 'bad',
        name: 'Bad',

        kind: 'archived' as any,
      }),
    ).rejects.toThrow();
  });
});
