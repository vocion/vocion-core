/**
 * The account cap and the daily ledger, against a real database.
 *
 * One deployment, two client accounts: Northwind with two workspaces, Kestrel
 * Capital with one. What is under test is the contract in `BudgetService`'s
 * docstring — every charge rolls up onto its own account's month and no one
 * else's; the account cap refuses exactly where a hard cap already refuses and
 * recording never stops; only `setAccountCap` can write the scope; and the
 * ledger answers "the last N days" the counters cannot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { and, eq, sql } = await import('drizzle-orm');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema, projectSchema, spendDaySchema, tenantAccountSchema } = await import('@/models/Schema');
const {
  ACCOUNT_CAP_PERIOD,
  ACCOUNT_SCOPE_SLUG,
  AccountCapNotWritableError,
  accountCapStatus,
  chargeUsage,
  getBudget,
  ORG_SCOPE_SLUG,
  preflightCheck,
  setAccountCap,
  setCentsLimits,
  setLimits,
  spendLedgerStartedOn,
  spendSince,
} = await import('@/services/BudgetService');

const NORTHWIND = 'acct-northwind';
const NW_SALES = 'proj-northwind-sales';
const NW_OPS = 'proj-northwind-ops';
const KESTREL = 'acct-kestrel';
const KESTREL_DEALS = 'proj-kestrel-deals';

/** `claude-haiku-4-5-20251001` at 100 cents per million input tokens: a million tokens a dollar. */
const CHAT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Spend `dollars` in one workspace, as an agent turn.
 * @param orgId - The workspace.
 * @param dollars - How much.
 */
async function spend(orgId: string, dollars: number): Promise<void> {
  await chargeUsage({ orgId, agentSlug: 'deal-lead', model: CHAT_MODEL, usage: { inputTokens: dollars * 1_000_000 } });
}

/**
 * The account's stored monthly row, read straight from the table.
 * @param accountId - `tenant_account.id`.
 */
async function accountRow(accountId: string) {
  const [row] = await db
    .select()
    .from(agentBudgetSchema)
    .where(and(eq(agentBudgetSchema.orgId, accountId), eq(agentBudgetSchema.agentSlug, ACCOUNT_SCOPE_SLUG)));
  return row ?? null;
}

async function clear(): Promise<void> {
  await db.delete(agentBudgetSchema);
  await db.delete(spendDaySchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
}

beforeEach(async () => {
  await clear();
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-capital' },
  ]);
  await db.insert(projectSchema).values([
    { id: NW_SALES, accountId: NORTHWIND, slug: 'sales', name: 'Sales' },
    { id: NW_OPS, accountId: NORTHWIND, slug: 'ops', name: 'Operations' },
    { id: KESTREL_DEALS, accountId: KESTREL, slug: 'deals', name: 'Deals' },
  ]);
});

afterEach(clear);

describe('charges roll up to the account', () => {
  it('adds every workspace\'s spend to its own account\'s month, and to nobody else\'s', async () => {
    await spend(NW_SALES, 2);
    await spend(NW_OPS, 3);
    await spend(KESTREL_DEALS, 7);

    const northwind = await accountRow(NORTHWIND);
    const kestrel = await accountRow(KESTREL);

    expect(northwind).toMatchObject({ period: ACCOUNT_CAP_PERIOD, currentMicroCents: 500_000_000, projectId: null });
    expect(kestrel).toMatchObject({ period: ACCOUNT_CAP_PERIOD, currentMicroCents: 700_000_000 });

    // The workspaces' own rows are unchanged by the roll-up.
    expect((await getBudget({ orgId: NW_SALES, agentSlug: ORG_SCOPE_SLUG }))?.currentCents).toBe(200);
    expect((await getBudget({ orgId: NW_OPS, agentSlug: ORG_SCOPE_SLUG }))?.currentCents).toBe(300);
  });

  it('writes no account row for a workspace that has no project row', async () => {
    await spend('org_without_project', 1);

    const rows = await db.select().from(agentBudgetSchema).where(eq(agentBudgetSchema.agentSlug, ACCOUNT_SCOPE_SLUG));

    expect(rows).toHaveLength(0);
  });

  it('reports the month through accountCapStatus', async () => {
    await spend(NW_SALES, 1.5);
    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: 10_000 });

    const status = await accountCapStatus(NORTHWIND);

    expect(status).toMatchObject({ accountId: NORTHWIND, spentCents: 150, hardCentsLimit: 10_000, blocked: false });
    expect(new Date(status.periodResetsAt).getUTCDate()).toBe(1);
    expect(await accountCapStatus(KESTREL)).toMatchObject({ spentCents: 0, hardCentsLimit: null, blocked: false, periodStartedAt: null });
  });
});

describe('the account cap refuses where a hard cap already refuses', () => {
  it('refuses refusable work in every workspace of the account once the month reaches the cap', async () => {
    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: 100 });
    await spend(NW_SALES, 1.5);

    // The other workspace never spent anything itself — the account did.
    const embed = await preflightCheck({ orgId: NW_OPS, feature: 'retrieval.embed' });
    const turn = await preflightCheck({ orgId: NW_SALES, agentSlug: 'deal-lead' });

    expect(embed).toMatchObject({ ok: false, scope: 'account', agentSlug: ACCOUNT_SCOPE_SLUG, reason: 'hard_cents_exceeded', limit: 100, current: 150, limitFrom: 'own' });
    expect(turn).toMatchObject({ ok: false, scope: 'account' });
  });

  it('leaves another account alone', async () => {
    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: 100 });
    await spend(NW_SALES, 1.5);

    expect(await preflightCheck({ orgId: KESTREL_DEALS, feature: 'retrieval.embed' })).toEqual({ ok: true });
  });

  it('keeps recording past the cap, because recording is universal', async () => {
    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: 100 });
    await spend(NW_SALES, 1.5);
    await spend(NW_OPS, 1);

    expect((await accountRow(NORTHWIND))?.currentMicroCents).toBe(250_000_000);
    expect((await getBudget({ orgId: NW_OPS, agentSlug: ORG_SCOPE_SLUG }))?.currentCents).toBe(100);
  });

  it('names the workspace cap first when both refuse — the one someone in the workspace can change', async () => {
    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: 100 });
    await setLimits({ orgId: NW_SALES, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 100 });
    await spend(NW_SALES, 1.5);

    expect(await preflightCheck({ orgId: NW_SALES, feature: 'retrieval.embed' })).toMatchObject({ ok: false, scope: 'org' });
  });

  it('lets work through again once an operator raises the cap', async () => {
    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: 100 });
    await spend(NW_SALES, 1.5);
    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: 500 });

    expect(await preflightCheck({ orgId: NW_OPS, feature: 'retrieval.embed' })).toEqual({ ok: true });

    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: null });

    expect((await accountCapStatus(NORTHWIND)).hardCentsLimit).toBeNull();
  });

  it('starts a new month at zero', async () => {
    await setAccountCap({ accountId: NORTHWIND, hardCentsLimit: 100 });
    await spend(NW_SALES, 1.5);
    // Back-date the counter into last month.
    await db
      .update(agentBudgetSchema)
      .set({ periodStartedAt: sql`date_trunc('month', now() AT TIME ZONE 'utc') - interval '1 day'` })
      .where(eq(agentBudgetSchema.agentSlug, ACCOUNT_SCOPE_SLUG));

    expect(await preflightCheck({ orgId: NW_OPS, feature: 'retrieval.embed' })).toEqual({ ok: true });

    // And the next charge adds to the new month rather than last month's total.
    await spend(NW_OPS, 0.25);

    expect((await accountRow(NORTHWIND))?.currentMicroCents).toBe(25_000_000);
  });
});

describe('only an operator writes the account cap', () => {
  it('refuses the account scope on every workspace-level writer', async () => {
    await expect(setLimits({ orgId: NW_SALES, agentSlug: ACCOUNT_SCOPE_SLUG, hardCentsLimit: 1 })).rejects.toBeInstanceOf(AccountCapNotWritableError);
    await expect(setCentsLimits({ orgId: NW_SALES, agentSlug: ACCOUNT_SCOPE_SLUG, period: 'monthly', softCentsLimit: null, hardCentsLimit: 1 })).rejects.toBeInstanceOf(AccountCapNotWritableError);

    expect(await db.select().from(agentBudgetSchema)).toHaveLength(0);
  });
});

describe('the daily ledger', () => {
  it('holds each workspace\'s spend for today, in the same write as the counters', async () => {
    await spend(NW_SALES, 2);
    await spend(NW_SALES, 1);
    await spend(KESTREL_DEALS, 4);

    const last30 = await spendSince([NW_SALES, NW_OPS, KESTREL_DEALS], 30);

    expect(last30.get(NW_SALES)?.spentCents).toBe(300);
    expect(last30.get(KESTREL_DEALS)?.spentCents).toBe(400);
    expect(last30.has(NW_OPS)).toBe(false);
  });

  it('counts only the days inside the window', async () => {
    await spend(NW_SALES, 1);
    await db.insert(spendDaySchema).values([
      { orgId: NW_SALES, day: sql`(now() AT TIME ZONE 'utc')::date - 29`, tokens: 1, microCents: 200_000_000 },
      { orgId: NW_SALES, day: sql`(now() AT TIME ZONE 'utc')::date - 30`, tokens: 1, microCents: 900_000_000 },
    ]);

    expect((await spendSince([NW_SALES], 30)).get(NW_SALES)?.spentCents).toBe(300);
    expect((await spendSince([NW_SALES], 1)).get(NW_SALES)?.spentCents).toBe(100);
    expect(await spendLedgerStartedOn()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('answers an empty list without a query', async () => {
    expect((await spendSince([], 30)).size).toBe(0);
  });
});
