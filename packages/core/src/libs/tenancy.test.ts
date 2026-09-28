/**
 * The gate: a forged `x-vocion-project-id` must not select a workspace.
 *
 * This is the line that decides what a request may touch. The header it reads
 * is meant to be set by the proxy on a `/w/<slug>/…` rewrite, but `proxy.ts`
 * returns early for everything under `/api/`, so on those routes it arrives
 * from the caller and nothing strips it. Unenforced that is harmless, because
 * every member reaches every workspace anyway. The moment access is scoped it
 * becomes the whole bypass — and fixing only `ProjectService` would hide a
 * workspace from the switcher while leaving it one header away.
 *
 * These run against PGlite with real rows, both with the flag off (today's
 * behaviour, which must not change) and on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const headerBag = { projectId: undefined as string | undefined, cookie: undefined as string | undefined };

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'x-vocion-project-id' ? headerBag.projectId ?? null : null) }),
  cookies: async () => ({ get: (k: string) => (k === 'vocion_active_project' && headerBag.cookie ? { value: headerBag.cookie } : undefined) }),
}));

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
const { resolveTenancyForUser } = await import('@/libs/tenancy');

const ACCOUNT = 'acct-northwind';
const ALEX = 'usr-alex'; // holds revenue only
const BRIT = 'usr-brit'; // holds delivery only
const REVENUE = 'proj-revenue';
const DELIVERY = 'proj-delivery';
const BRIT_PERSONAL = 'proj-personal-brit';

async function seed() {
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
    { id: BRIT_PERSONAL, accountId: ACCOUNT, slug: 'personal-brit', name: 'Brit', kind: 'personal', ownerUserId: BRIT },
  ]);
  await db.insert(userGroupSchema).values({ id: 'grp-revenue', accountId: ACCOUNT, slug: 'revenue-team', name: 'Revenue Team' });
  await db.insert(userGroupMemberSchema).values({ groupId: 'grp-revenue', userId: ALEX });
  await db.insert(groupProjectGrantSchema).values({ groupId: 'grp-revenue', projectId: REVENUE, role: 'admin' });
  await db.insert(projectMemberSchema).values({ projectId: DELIVERY, userId: BRIT, role: 'member' });
}

describe('tenancy resolution', () => {
  beforeEach(async () => {
    headerBag.projectId = undefined;
    headerBag.cookie = undefined;
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

  afterEach(() => {
    delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
  });

  describe('with enforcement OFF (today)', () => {
    it('honours any project on the account, which is the behaviour being preserved', async () => {
      headerBag.projectId = DELIVERY;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.projectId).toBe(DELIVERY);
      // The account role still stands in, exactly as before.
      expect(t.workspaceRole).toBe('member');
    });
  });

  describe('with enforcement ON', () => {
    beforeEach(() => {
      process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
    });

    it('REFUSES a forged header naming a workspace the caller does not hold', async () => {
      headerBag.projectId = DELIVERY;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.projectId).not.toBe(DELIVERY);
      // Falls through to what IS theirs rather than erroring, so a stale link
      // lands them somewhere they belong.
      expect(t.projectId).toBe(REVENUE);
    });

    it('REFUSES a forged header naming someone else\'s personal workspace', async () => {
      // The one that matters most: a personal workspace holds that person's
      // own mail, and it sits on the same account as every shared one.
      headerBag.projectId = BRIT_PERSONAL;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.projectId).toBe(REVENUE);
    });

    it('refuses a forged COOKIE the same way', async () => {
      headerBag.cookie = DELIVERY;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.projectId).toBe(REVENUE);
    });

    it('honours a header naming a workspace the caller does hold', async () => {
      headerBag.projectId = REVENUE;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.projectId).toBe(REVENUE);
    });

    it('carries the role held in THAT workspace, not the account role', async () => {
      headerBag.projectId = REVENUE;

      const t = await resolveTenancyForUser(ALEX);

      // Alex is an account `member`, which unenforced means `member`
      // everywhere. The group grants `admin` on this one workspace, and that is
      // what authz.ts must now receive.
      expect(t.role).toBe('member');
      expect(t.workspaceRole).toBe('admin');
    });

    it('lets the owner of a personal workspace into it', async () => {
      headerBag.projectId = BRIT_PERSONAL;

      const t = await resolveTenancyForUser(BRIT);

      expect(t.projectId).toBe(BRIT_PERSONAL);
      expect(t.workspaceRole).toBe('admin');
    });

    it('gives a person who holds nothing a null project rather than an arbitrary one', async () => {
      await db.insert(userSchema).values({ id: 'usr-drew', email: 'drew@northwind.example' });
      await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: 'usr-drew', role: 'member' });

      const t = await resolveTenancyForUser('usr-drew');

      // Unenforced this returned the first project on the account. Enforced it
      // must return nothing, which is why the dashboard needs a real empty
      // state rather than assuming a project exists.
      expect(t.projectId).toBeNull();
      expect(t.workspaceRole).toBeNull();
      expect(t.accountId).toBe(ACCOUNT);
    });

    it('is stable about where it lands someone with no header and no cookie', async () => {
      const first = await resolveTenancyForUser(BRIT);
      const second = await resolveTenancyForUser(BRIT);

      expect(first.projectId).toBe(second.projectId);
    });
  });

  // vocion-core#128. The membership used to be read with a bare LIMIT 1, so a
  // person in two accounts got whichever row Postgres returned first. The
  // older membership is inserted SECOND here, after seed() put Alex in
  // Northwind, so reading rows in the order they were written picks the wrong one.
  describe('for a person in more than one account', () => {
    const CONTOSO = 'acct-contoso';
    const CONTOSO_PROJECT = 'proj-contoso';

    beforeEach(async () => {
      await db.insert(tenantAccountSchema).values({ id: CONTOSO, name: 'Contoso', slug: 'contoso' });
      await db.insert(accountMembershipSchema).values({ accountId: CONTOSO, userId: ALEX, role: 'admin', createdAt: new Date('2020-01-01T00:00:00Z') });
      await db.insert(projectSchema).values({ id: CONTOSO_PROJECT, accountId: CONTOSO, slug: 'contoso-main', name: 'Contoso' });
    });

    it('resolves to the account they joined first, on every read', async () => {
      const first = await resolveTenancyForUser(ALEX);
      const second = await resolveTenancyForUser(ALEX);

      expect(first.accountId).toBe(CONTOSO);
      expect(first.role).toBe('admin');
      expect(first.projectId).toBe(CONTOSO_PROJECT);
      expect(second).toEqual(first);
    });

    it('does not follow a header into the other account', async () => {
      headerBag.projectId = REVENUE;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.accountId).toBe(CONTOSO);
      expect(t.projectId).toBe(CONTOSO_PROJECT);
    });

    it('agrees with the workspace-access checks when access is enforced', async () => {
      process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
      headerBag.projectId = CONTOSO_PROJECT;

      const t = await resolveTenancyForUser(ALEX);

      // The project the access checks accepted belongs to the account tenancy chose.
      expect(t.accountId).toBe(CONTOSO);
      expect(t.projectId).toBe(CONTOSO_PROJECT);
      expect(t.workspaceRole).toBe('admin');
    });
  });
});
