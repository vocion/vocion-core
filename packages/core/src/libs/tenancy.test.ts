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

const headerBag = { projectId: undefined as string | undefined, cookie: undefined as string | undefined, referer: undefined as string | undefined };

/**
 * The request headers the mocked `headers()` answers with.
 * @param k - The header name.
 */
function requestHeader(k: string): string | null {
  if (k === 'x-vocion-project-id') {
    return headerBag.projectId ?? null;
  }
  return k === 'referer' ? headerBag.referer ?? null : null;
}

vi.mock('next/headers', () => ({
  headers: async () => ({ get: requestHeader }),
  cookies: async () => ({ get: (k: string) => (k === 'vocion_active_project' && headerBag.cookie ? { value: headerBag.cookie } : undefined) }),
}));

const { db } = await import('@/libs/DB');
const { and, eq } = await import('drizzle-orm');
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
    headerBag.referer = undefined;
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

    it('lands on the oldest workspace they hold, the same order as with enforcement off, not the lowest id', async () => {
      // Brit holds both; the personal one is older but sorts after by id.
      await db.update(projectSchema).set({ createdAt: new Date('2020-01-01T00:00:00Z') }).where(eq(projectSchema.id, BRIT_PERSONAL));
      await db.update(projectSchema).set({ createdAt: new Date('2025-01-01T00:00:00Z') }).where(eq(projectSchema.id, DELIVERY));

      expect((await resolveTenancyForUser(BRIT)).projectId).toBe(BRIT_PERSONAL);
    });

    it('is stable about where it lands someone with no header and no cookie', async () => {
      const first = await resolveTenancyForUser(BRIT);
      const second = await resolveTenancyForUser(BRIT);

      expect(first.projectId).toBe(second.projectId);
    });
  });

  // vocion-core#128. The account follows the workspace the person picked, and
  // their oldest membership is only the default when nothing picked one. Alex
  // is a member of Northwind (seed) and an admin of Contoso, the OLDER
  // membership, inserted second so reading rows in the order they were written
  // picks the wrong one.
  describe('for a person in more than one account', () => {
    const CONTOSO = 'acct-contoso';
    const CONTOSO_PROJECT = 'proj-contoso';
    const FABRIKAM_PROJECT = 'proj-fabrikam';

    beforeEach(async () => {
      await db.insert(tenantAccountSchema).values([
        { id: CONTOSO, name: 'Contoso', slug: 'contoso' },
        { id: 'acct-fabrikam', name: 'Fabrikam', slug: 'fabrikam' },
      ]);
      await db.insert(accountMembershipSchema).values({ accountId: CONTOSO, userId: ALEX, role: 'admin', createdAt: new Date('2020-01-01T00:00:00Z') });
      await db.insert(projectSchema).values([
        { id: CONTOSO_PROJECT, accountId: CONTOSO, slug: 'contoso-main', name: 'Contoso' },
        // An account Alex is NOT in.
        { id: FABRIKAM_PROJECT, accountId: 'acct-fabrikam', slug: 'fabrikam-main', name: 'Fabrikam' },
      ]);
    });

    it('lands in the account they joined first when nothing picked a workspace, on every read', async () => {
      const first = await resolveTenancyForUser(ALEX);
      const second = await resolveTenancyForUser(ALEX);

      expect(first.accountId).toBe(CONTOSO);
      expect(first.role).toBe('admin');
      expect(first.projectId).toBe(CONTOSO_PROJECT);
      expect(second).toEqual(first);
    });

    it('follows the URL into their other account, with the role they hold there', async () => {
      headerBag.projectId = DELIVERY;

      const t = await resolveTenancyForUser(ALEX);

      expect(t).toEqual({ accountId: ACCOUNT, projectId: DELIVERY, role: 'member', workspaceRole: 'member' });
    });

    it('follows the last-active cookie into their other account — a switch survives a reload', async () => {
      headerBag.cookie = REVENUE;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.accountId).toBe(ACCOUNT);
      expect(t.projectId).toBe(REVENUE);
    });

    // A browser fetch from a tab (`/rpc`, `/api/chat`) has no proxy header; the
    // tab's page URL arrives as the Referer.
    it('runs a call from a tab in the tab\'s workspace, not the one another tab switched the cookie to', async () => {
      headerBag.cookie = CONTOSO_PROJECT;
      headerBag.referer = 'https://agents.example.com/w/revenue/dashboard/chat';

      const t = await resolveTenancyForUser(ALEX);

      expect(t).toMatchObject({ accountId: ACCOUNT, projectId: REVENUE, role: 'member' });
    });

    it('lets a tab URL\'s ?account= pick between two workspaces with the same slug', async () => {
      // Contoso has a `revenue` too, and "last active" is on Contoso.
      await db.insert(projectSchema).values({ id: 'proj-contoso-revenue', accountId: CONTOSO, slug: 'revenue', name: 'Contoso Revenue' });
      headerBag.cookie = CONTOSO_PROJECT;

      headerBag.referer = 'https://agents.example.com/w/revenue/dashboard?account=northwind';

      expect(await resolveTenancyForUser(ALEX)).toMatchObject({ accountId: ACCOUNT, projectId: REVENUE });

      headerBag.referer = 'https://agents.example.com/w/revenue/dashboard';

      expect(await resolveTenancyForUser(ALEX)).toMatchObject({ accountId: CONTOSO, projectId: 'proj-contoso-revenue' });
    });

    it('reads a locale-prefixed tab URL too', async () => {
      headerBag.cookie = CONTOSO_PROJECT;
      headerBag.referer = 'https://agents.example.com/fr/w/revenue/dashboard';

      expect((await resolveTenancyForUser(ALEX)).projectId).toBe(REVENUE);
    });

    it('lets the proxy\'s header win over the Referer, since a page load names its own workspace', async () => {
      headerBag.projectId = CONTOSO_PROJECT;
      headerBag.referer = 'https://agents.example.com/w/revenue/dashboard';

      expect((await resolveTenancyForUser(ALEX)).projectId).toBe(CONTOSO_PROJECT);
    });

    it('ignores a Referer naming a workspace on an account they are not in, and a page that is not a workspace', async () => {
      headerBag.cookie = REVENUE;
      headerBag.referer = 'https://agents.example.com/w/fabrikam-main/dashboard';

      expect((await resolveTenancyForUser(ALEX)).projectId).toBe(REVENUE);

      headerBag.referer = 'https://agents.example.com/sign-up?invite=tok';

      expect((await resolveTenancyForUser(ALEX)).projectId).toBe(REVENUE);

      headerBag.referer = 'not a url';

      expect((await resolveTenancyForUser(ALEX)).projectId).toBe(REVENUE);
    });

    it('refuses a header naming a workspace on an account they are not in, and lands them in their default', async () => {
      headerBag.projectId = FABRIKAM_PROJECT;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.accountId).toBe(CONTOSO);
      expect(t.projectId).toBe(CONTOSO_PROJECT);
    });

    it('lets go of an account they were removed from, even with the cookie still pointing there', async () => {
      headerBag.cookie = REVENUE;
      await db.delete(accountMembershipSchema).where(and(eq(accountMembershipSchema.userId, ALEX), eq(accountMembershipSchema.accountId, ACCOUNT)));

      const t = await resolveTenancyForUser(ALEX);

      expect(t.accountId).toBe(CONTOSO);
      expect(t.projectId).toBe(CONTOSO_PROJECT);
    });

    it('skips an oldest account with no workspace instead of leaving them on none', async () => {
      await db.delete(projectSchema).where(eq(projectSchema.id, CONTOSO_PROJECT));

      const t = await resolveTenancyForUser(ALEX);

      expect(t.accountId).toBe(ACCOUNT);
      expect(t.projectId).not.toBeNull();
    });

    it('refuses a cookie naming a workspace on an account they are not in', async () => {
      headerBag.cookie = FABRIKAM_PROJECT;

      const t = await resolveTenancyForUser(ALEX);

      expect(t.accountId).toBe(CONTOSO);
    });

    describe('with enforcement ON', () => {
      beforeEach(() => {
        process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
      });

      it('takes the workspace role from the picked workspace\'s own account', async () => {
        headerBag.projectId = CONTOSO_PROJECT;
        const inContoso = await resolveTenancyForUser(ALEX);
        headerBag.projectId = REVENUE;
        const inNorthwind = await resolveTenancyForUser(ALEX);

        // Contoso admin: runs every shared Contoso workspace.
        expect(inContoso).toEqual({ accountId: CONTOSO, projectId: CONTOSO_PROJECT, role: 'admin', workspaceRole: 'admin' });
        // Northwind member, admin of revenue only through the group grant.
        expect(inNorthwind).toEqual({ accountId: ACCOUNT, projectId: REVENUE, role: 'member', workspaceRole: 'admin' });
      });

      it('moves on to an account where they hold a workspace when the oldest has none they hold', async () => {
        // Contoso's only workspace becomes someone else's personal one.
        await db.update(projectSchema).set({ kind: 'personal', ownerUserId: BRIT }).where(eq(projectSchema.id, CONTOSO_PROJECT));

        const t = await resolveTenancyForUser(ALEX);

        expect(t).toEqual({ accountId: ACCOUNT, projectId: REVENUE, role: 'member', workspaceRole: 'admin' });
      });

      it('keeps them in the picked account when they cannot open that workspace, landing on one they hold there', async () => {
        headerBag.projectId = DELIVERY;

        const t = await resolveTenancyForUser(ALEX);

        expect(t.accountId).toBe(ACCOUNT);
        expect(t.projectId).toBe(REVENUE);
      });
    });
  });
});
