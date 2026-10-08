/**
 * The operator console's reads and writes, against a real database: what an
 * operator sees across two client accounts, and invite-only onboarding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { eq, sql } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { accountMembershipSchema, agentBudgetSchema, inviteSchema, projectSchema, spendDaySchema, tenantAccountSchema, userActivityEventSchema, userSchema } = await import('@/models/Schema');
const { chargeUsage, setAccountCap } = await import('@/services/BudgetService');
const { createAccount, inviteToAccount, isOperatorUser, OperatorInputError, operatorOverview, slugFromName } = await import('./OperatorConsoleService');

const DAY = 86_400_000;

async function clear(): Promise<void> {
  await db.delete(agentBudgetSchema);
  await db.delete(spendDaySchema);
  await db.delete(userActivityEventSchema);
  await db.delete(inviteSchema);
  await db.delete(tenantAccountSchema).where(sql`${tenantAccountSchema.id} like 'acct-%'`);
  await db.delete(userSchema);
}

beforeEach(async () => {
  await clear();
  vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@vocion-operator.example');
  await db.insert(userSchema).values([
    { id: 'usr-ops', email: 'ops@vocion-operator.example' },
    { id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam' },
    { id: 'usr-kim', email: 'kim@kestrel.example', name: 'Kim' },
  ]);
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
    { id: 'acct-kestrel', name: 'Kestrel Capital', slug: 'kestrel-capital' },
  ]);
  await db.insert(projectSchema).values([
    { id: 'proj-nw-sales', accountId: 'acct-northwind', slug: 'sales', name: 'Sales' },
    { id: 'proj-nw-ops', accountId: 'acct-northwind', slug: 'ops', name: 'Operations' },
    { id: 'proj-nw-sam', accountId: 'acct-northwind', slug: 'sam', name: 'Personal', kind: 'personal', ownerUserId: 'usr-sam' },
    { id: 'proj-kestrel', accountId: 'acct-kestrel', slug: 'deals', name: 'Deals' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-northwind', userId: 'usr-sam', role: 'admin', lastLoginAt: new Date(Date.now() - 3 * DAY), lastActiveAt: new Date(Date.now() - 2 * DAY) },
    { accountId: 'acct-kestrel', userId: 'usr-kim', role: 'admin' },
  ]);
  await db.insert(inviteSchema).values([
    { id: 'inv-open', accountId: 'acct-kestrel', email: 'new@kestrel.example', role: 'member', token: 'tok-open', expiresAt: new Date(Date.now() + DAY) },
    { id: 'inv-old', accountId: 'acct-kestrel', email: 'late@kestrel.example', role: 'member', token: 'tok-old', expiresAt: new Date(Date.now() - DAY) },
    { id: 'inv-used', accountId: 'acct-kestrel', email: 'kim@kestrel.example', role: 'admin', token: 'tok-used', expiresAt: new Date(Date.now() + DAY), acceptedAt: new Date() },
  ]);
  await db.insert(userActivityEventSchema).values({ orgId: 'proj-nw-ops', projectId: 'proj-nw-ops', userId: 'usr-sam', eventType: 'activity.heartbeat', createdAt: new Date(Date.now() - DAY) });
  // $2 in Sales, $1 in Sam's personal workspace, $5 at Kestrel.
  await chargeUsage({ orgId: 'proj-nw-sales', model: 'claude-haiku-4-5-20251001', usage: { inputTokens: 2_000_000 } });
  await chargeUsage({ orgId: 'proj-nw-sam', model: 'claude-haiku-4-5-20251001', usage: { inputTokens: 1_000_000 } });
  await chargeUsage({ orgId: 'proj-kestrel', model: 'claude-haiku-4-5-20251001', usage: { inputTokens: 5_000_000 } });
  await setAccountCap({ accountId: 'acct-kestrel', hardCentsLimit: 400 });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await clear();
});

describe('the overview', () => {
  it('lists every account with its workspaces, people, spend and cap', async () => {
    const overview = await operatorOverview();
    const names = overview.accounts.map(a => a.name);

    expect(names).toContain('Kestrel Capital');
    expect(names.indexOf('Kestrel Capital')).toBeLessThan(names.indexOf('Northwind'));
    expect(overview.windowDays).toBe(30);
    expect(overview.ledgerStartedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Today counts as one of the thirty days, so the window opens 29 days back.
    expect(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${overview.windowStartsOn}T00:00:00Z`)).toBe(29 * 86_400_000);

    const northwind = overview.accounts.find(a => a.id === 'acct-northwind')!;

    // Shared workspaces by name; the personal one only counted.
    expect(northwind.workspaces.map(w => w.slug)).toEqual(['ops', 'sales']);
    expect(northwind.personal).toMatchObject({ count: 1, spendCents: 100 });
    expect(northwind.workspaces.find(w => w.slug === 'sales')?.spendCents).toBe(200);
    expect(northwind.spendCents).toBe(300);
    expect(northwind.cap).toMatchObject({ spentCents: 300, hardCentsLimit: null, blocked: false });
    expect(northwind.members).toEqual([expect.objectContaining({ email: 'sam@northwind.example', role: 'admin' })]);

    // The newest of a heartbeat two days ago and a workspace event yesterday.
    const opsActivity = northwind.workspaces.find(w => w.slug === 'ops')!.lastActivityAt!;

    expect(northwind.lastActivityAt).toBe(opsActivity);
    expect(Date.now() - Date.parse(opsActivity)).toBeGreaterThan(DAY - 60_000);
  });

  it('shows open invites, flags the expired one, and leaves out the accepted one', async () => {
    const kestrel = (await operatorOverview()).accounts.find(a => a.id === 'acct-kestrel')!;

    expect(kestrel.invites.map(i => [i.email, i.expired])).toEqual([['new@kestrel.example', false], ['late@kestrel.example', true]]);
    expect(kestrel.cap).toMatchObject({ spentCents: 500, hardCentsLimit: 400, blocked: true });
    expect(kestrel.members[0]?.lastActiveAt).toBeNull();
  });
});

describe('creating an account', () => {
  it('creates the account, its first shared workspace and an admin invite', async () => {
    const created = await createAccount({ name: 'Contoso Supply', adminEmail: 'Admin@Contoso.example', invitedBy: 'usr-ops' });

    expect(created.account).toMatchObject({ name: 'Contoso Supply', slug: 'contoso-supply' });
    expect(created.workspace).toMatchObject({ name: 'Contoso Supply', slug: 'contoso-supply' });
    expect(created.invite).toMatchObject({ email: 'admin@contoso.example', role: 'admin', expired: false });

    const [workspace] = await db.select().from(projectSchema).where(eq(projectSchema.id, created.workspace.id));

    expect(workspace).toMatchObject({ accountId: created.account.id, kind: 'shared' });

    const [invite] = await db.select().from(inviteSchema).where(eq(inviteSchema.id, created.invite.id));

    expect(invite).toMatchObject({ accountId: created.account.id, invitedBy: 'usr-ops', acceptedAt: null });
  });

  it('gives a second client with the same name the next free slug', async () => {
    const created = await createAccount({ name: 'Northwind', workspaceName: 'Main', adminEmail: 'a@northwind-two.example', invitedBy: 'usr-ops' });

    expect(created.account.slug).toBe('northwind-2');
    expect(created.workspace.slug).toBe('main');
  });

  it('refuses a workspace name whose address the app already uses, before creating anything', async () => {
    const before = await db.select().from(tenantAccountSchema);

    await expect(createAccount({ name: 'Acme', workspaceName: 'Dashboard', adminEmail: 'a@acme.example', invitedBy: 'usr-ops' })).rejects.toBeInstanceOf(OperatorInputError);
    await expect(createAccount({ name: '???', adminEmail: 'a@acme.example', invitedBy: 'usr-ops' })).rejects.toThrow('at least one letter or number');

    expect(await db.select().from(tenantAccountSchema)).toHaveLength(before.length);
  });

  it('slugs a name the way a workspace address needs', () => {
    expect(slugFromName('  Bellwater Hall & Co.  ')).toBe('bellwater-hall-co');
    expect(slugFromName('A'.repeat(60))).toHaveLength(40);
  });
});

describe('inviting into an account', () => {
  it('issues an invite into an existing account', async () => {
    const invite = await inviteToAccount({ accountId: 'acct-northwind', email: 'lee@northwind.example', role: 'member', invitedBy: 'usr-ops' });

    expect(invite).toMatchObject({ email: 'lee@northwind.example', role: 'member' });
  });

  it('says why when it cannot', async () => {
    await expect(inviteToAccount({ accountId: 'acct-missing', email: 'x@acme.example', role: 'admin', invitedBy: 'usr-ops' })).rejects.toThrow('does not exist');
    await expect(inviteToAccount({ accountId: 'acct-northwind', email: 'sam@northwind.example', role: 'admin', invitedBy: 'usr-ops' })).rejects.toThrow('already a member');
  });
});

describe('who is an operator', () => {
  it('reads the person\'s email off their user row', async () => {
    expect(await isOperatorUser('usr-ops')).toBe(true);
    expect(await isOperatorUser('usr-sam')).toBe(false);
    expect(await isOperatorUser('usr-nobody')).toBe(false);
  });
});
