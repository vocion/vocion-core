/**
 * Managing groups from the screen, against PGlite.
 *
 * The refusals are the point. Everything here is account-scoped, and a
 * personal workspace can never be handed to a group — it holds that person's
 * own mail, and is reached by owning it and by nothing else.
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
const {
  accessOverview,
  createGroup,
  deleteGroup,
  removeDirectGrant,
  setGroupGrant,
  setGroupMember,
} = await import('@/services/GroupService');
const { BACKFILL_ACTOR } = await import('@/services/PeopleSeedService');

const ACCOUNT = 'acct-northwind';
const OTHER = 'acct-kestrel';
const ALEX = 'usr-alex';
const BRIT = 'usr-brit';
const REVENUE = 'proj-revenue';
const DELIVERY = 'proj-delivery';
const BRIT_PERSONAL = 'proj-personal-brit';

async function seed() {
  await db.insert(tenantAccountSchema).values([
    { id: ACCOUNT, name: 'Northwind', slug: 'northwind' },
    { id: OTHER, name: 'Kestrel Capital', slug: 'kestrel' },
  ]);
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex' },
    { id: BRIT, email: 'brit@northwind.example', name: 'Brit' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: ACCOUNT, userId: ALEX, role: 'member' },
    { accountId: ACCOUNT, userId: BRIT, role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: ACCOUNT, slug: 'revenue', name: 'Revenue Team' },
    { id: DELIVERY, accountId: ACCOUNT, slug: 'delivery-stack', name: 'Delivery Stack' },
    { id: BRIT_PERSONAL, accountId: ACCOUNT, slug: 'personal-brit', name: 'Brit', kind: 'personal', ownerUserId: BRIT },
    { id: 'proj-foreign', accountId: OTHER, slug: 'foreign', name: 'Foreign' },
  ]);
}

const newGroup = () => createGroup({ accountId: ACCOUNT, slug: 'revops', name: 'RevOps' });

describe('group management', () => {
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

  it('creates a group, grants a workspace, and adds a member', async () => {
    const g = await newGroup();
    await setGroupGrant({ accountId: ACCOUNT, groupId: g.id, projectId: REVENUE, role: 'pm', actorId: ALEX });
    await setGroupMember({ accountId: ACCOUNT, groupId: g.id, userId: ALEX, member: true, actorId: ALEX });

    const view = await accessOverview(ACCOUNT);
    const alex = view.people.find(p => p.userId === ALEX)!;

    expect(view.groups[0]!.grants.map(x => x.slug)).toEqual(['revenue']);
    expect(alex.groups).toEqual(['revops']);
    expect(alex.reaches.map(r => `${r.slug}:${r.role}:${r.via}`)).toEqual(['revenue:pm:group']);
  });

  it('changes a role in place rather than adding a second grant', async () => {
    const g = await newGroup();
    await setGroupGrant({ accountId: ACCOUNT, groupId: g.id, projectId: REVENUE, role: 'pm', actorId: ALEX });
    await setGroupGrant({ accountId: ACCOUNT, groupId: g.id, projectId: REVENUE, role: 'specialist', actorId: ALEX });

    const view = await accessOverview(ACCOUNT);

    expect(view.groups[0]!.grants).toHaveLength(1);
    expect(view.groups[0]!.grants[0]!.role).toBe('specialist');
  });

  it('revokes a grant when the role is cleared', async () => {
    const g = await newGroup();
    await setGroupGrant({ accountId: ACCOUNT, groupId: g.id, projectId: REVENUE, role: 'pm', actorId: ALEX });
    await setGroupGrant({ accountId: ACCOUNT, groupId: g.id, projectId: REVENUE, role: null, actorId: ALEX });

    expect((await accessOverview(ACCOUNT)).groups[0]!.grants).toEqual([]);
  });

  describe('refusals', () => {
    it('refuses to grant a personal workspace to a group', async () => {
      const g = await newGroup();

      await expect(
        setGroupGrant({ accountId: ACCOUNT, groupId: g.id, projectId: BRIT_PERSONAL, role: 'pm', actorId: ALEX }),
      ).rejects.toThrow(/personal workspace cannot be granted/);
    });

    it('refuses a workspace on another account', async () => {
      const g = await newGroup();

      await expect(
        setGroupGrant({ accountId: ACCOUNT, groupId: g.id, projectId: 'proj-foreign', role: 'pm', actorId: ALEX }),
      ).rejects.toThrow(/no such workspace/);
    });

    it('refuses to touch a group on another account', async () => {
      const g = await newGroup();

      await expect(
        setGroupGrant({ accountId: OTHER, groupId: g.id, projectId: REVENUE, role: 'pm', actorId: ALEX }),
      ).rejects.toThrow(/no such group/);
      await expect(deleteGroup(OTHER, g.id)).rejects.toThrow(/no such group/);
    });

    it('refuses to add someone who is not on the account', async () => {
      const g = await newGroup();
      await db.insert(userSchema).values({ id: 'usr-outsider', email: 'outsider@kestrel.example' });

      await expect(
        setGroupMember({ accountId: ACCOUNT, groupId: g.id, userId: 'usr-outsider', member: true, actorId: ALEX }),
      ).rejects.toThrow(/not a member of this account/);
    });

    it('refuses a duplicate slug', async () => {
      await newGroup();

      await expect(newGroup()).rejects.toThrow(/already exists/);
    });
  });

  describe('direct grants', () => {
    it('shows why someone reaches a workspace no group opens', async () => {
      // What migration 0145 leaves behind, and the usual reason access looks
      // wrong on this screen.
      await db.insert(projectMemberSchema).values({ projectId: DELIVERY, userId: ALEX, role: 'pm', addedBy: BACKFILL_ACTOR });

      const alex = (await accessOverview(ACCOUNT)).people.find(p => p.userId === ALEX)!;

      expect(alex.reaches.map(r => `${r.slug}:${r.via}`)).toEqual(['delivery-stack:direct']);
    });

    it('removes one, so the fix does not need SQL', async () => {
      await db.insert(projectMemberSchema).values({ projectId: DELIVERY, userId: ALEX, role: 'pm', addedBy: BACKFILL_ACTOR });

      await removeDirectGrant({ accountId: ACCOUNT, projectId: DELIVERY, userId: ALEX });

      expect((await accessOverview(ACCOUNT)).people.find(p => p.userId === ALEX)!.reaches).toEqual([]);
    });
  });

  describe('deleting a group', () => {
    it('takes its grants and memberships, and nobody\'s account place', async () => {
      const g = await newGroup();
      await setGroupGrant({ accountId: ACCOUNT, groupId: g.id, projectId: REVENUE, role: 'pm', actorId: ALEX });
      await setGroupMember({ accountId: ACCOUNT, groupId: g.id, userId: ALEX, member: true, actorId: ALEX });

      await deleteGroup(ACCOUNT, g.id);

      const view = await accessOverview(ACCOUNT);

      expect(view.groups).toEqual([]);
      expect(view.people.find(p => p.userId === ALEX)!.reaches).toEqual([]);
      // Losing a group costs the workspaces it opened, never your place here.
      expect(view.people).toHaveLength(2);
    });
  });

  describe('the screen says whether it is in force', () => {
    it('reports enforcement off by default', async () => {
      expect((await accessOverview(ACCOUNT)).enforced).toBe(false);
    });

    it('reports it on when the deployment sets the flag', async () => {
      process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
      try {
        expect((await accessOverview(ACCOUNT)).enforced).toBe(true);
      } finally {
        delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
      }
    });
  });
});
