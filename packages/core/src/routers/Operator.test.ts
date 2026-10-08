/**
 * The operator gate. Every operator route reads or writes across accounts, so
 * "a signed-in person who is not an operator gets nothing" is the assertion
 * that matters here — including an account admin. The session is mocked; who
 * the person is comes from the real user row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

const { sql } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { agentBudgetSchema, inviteSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { guardAuth, guardRole } = await import('./AuthGuards');
const { createAccountRoute, inviteRoute, overviewRoute, setAccountCapRoute } = await import('./Operator');
const { upsert: upsertBudget } = await import('./Budgets');
const { ACCOUNT_SCOPE_SLUG } = await import('@/services/BudgetService');

function call<T = unknown>(route: unknown, input: unknown = undefined): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

/**
 * Point the mocked session at a person.
 * @param userId - Who is signed in.
 * @param role - Their account role.
 */
function signedInAs(userId: string, role: 'admin' | 'member' = 'admin') {
  vi.mocked(guardAuth).mockResolvedValue({
    userId,
    orgId: 'proj-northwind-main',
    accountId: 'acct-northwind',
    projectId: 'proj-northwind-main',
    role,
    has: ({ role: required }: { role: string }) => (required === 'org:admin' ? role === 'admin' : true),
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
  vi.mocked(guardRole).mockResolvedValue({ orgId: 'proj-northwind-main', projectId: 'proj-northwind-main', accountId: 'acct-northwind' });
}

async function clear(): Promise<void> {
  await db.delete(agentBudgetSchema);
  await db.delete(inviteSchema);
  await db.delete(tenantAccountSchema).where(sql`${tenantAccountSchema.id} like 'acct-%'`);
  await db.delete(userSchema);
}

beforeEach(async () => {
  await clear();
  vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@vocion-operator.example');
  await db.insert(userSchema).values([
    { id: 'usr-ops', email: 'ops@vocion-operator.example' },
    { id: 'usr-admin', email: 'admin@northwind.example' },
  ]);
  await db.insert(tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await clear();
});

describe('the operator gate', () => {
  it('answers a non-operator — even an account admin — with a 404 on every route', async () => {
    signedInAs('usr-admin', 'admin');

    const routes: Array<[unknown, unknown]> = [
      [overviewRoute, undefined],
      [createAccountRoute, { name: 'Acme', adminEmail: 'a@acme.example' }],
      [inviteRoute, { accountId: 'acct-northwind', email: 'a@acme.example', role: 'admin' }],
      [setAccountCapRoute, { accountId: 'acct-northwind', hardCentsLimit: 100 }],
    ];
    for (const [route, input] of routes) {
      await expect(call(route, input)).rejects.toMatchObject({ status: 404 });
    }

    // And nothing was written on the way to the refusal.
    expect(await db.select().from(inviteSchema)).toHaveLength(0);
    expect(await db.select().from(agentBudgetSchema)).toHaveLength(0);
  });

  it('lets an operator read every account and create one', async () => {
    signedInAs('usr-ops');

    const overview = await call<{ accounts: Array<{ id: string }> }>(overviewRoute);

    expect(overview.accounts.map(a => a.id)).toContain('acct-northwind');

    const created = await call<{ invite: { email: string; role: string } }>(createAccountRoute, { name: 'Acme', adminEmail: 'boss@acme.example' });

    expect(created.invite).toMatchObject({ email: 'boss@acme.example', role: 'admin' });
  });

  it('turns a refusal written for the operator into a 400 with its words', async () => {
    signedInAs('usr-ops');

    await expect(call(createAccountRoute, { name: 'Acme', workspaceName: 'Dashboard', adminEmail: 'a@acme.example' })).rejects.toMatchObject({ status: 400 });
    await expect(call(setAccountCapRoute, { accountId: 'acct-missing', hardCentsLimit: 100 })).rejects.toMatchObject({ status: 400 });
  });

  it('sets the account cap', async () => {
    signedInAs('usr-ops');

    const status = await call<{ hardCentsLimit: number | null }>(setAccountCapRoute, { accountId: 'acct-northwind', hardCentsLimit: 25_000 });

    expect(status.hardCentsLimit).toBe(25_000);
  });
});

describe('the workspace budgets API', () => {
  it('will not write the account cap, whoever the admin is', async () => {
    signedInAs('usr-admin', 'admin');

    await expect(call(upsertBudget, { agentSlug: ACCOUNT_SCOPE_SLUG, period: 'monthly', hardCentsLimit: 1 })).rejects.toMatchObject({ status: 400 });
    expect(await db.select().from(agentBudgetSchema)).toHaveLength(0);
  });
});
