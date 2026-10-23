/**
 * The spend ledger against a real database: every charge files one
 * `model_call` row carrying what its call context knew, and `spendBy` reads it
 * back by any grouping without ever crossing into another Org's rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema, agentSchema, modelCallSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { chargeUsage } = await import('@/services/BudgetService');
const { withRunCost } = await import('@/services/budget/runCost');
const { withCallContext } = await import('./callContext');
const { spendBy } = await import('./spend');

const ACCT_A = 'acct_spend_a';
const ACCT_B = 'acct_spend_b';
const WS_A1 = 'ws_spend_a1';
const WS_A2 = 'ws_spend_a2';
const WS_B = 'ws_spend_b';
const FROM = new Date(Date.now() - 86_400_000);
const TO = new Date(Date.now() + 60_000);
const USAGE = { inputTokens: 1_000, outputTokens: 500 };

beforeEach(async () => {
  await db.delete(modelCallSchema);
  await db.delete(agentBudgetSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values([
    { id: ACCT_A, name: 'Northwind', slug: 'northwind-spend' },
    { id: ACCT_B, name: 'Kestrel Capital', slug: 'kestrel-spend' },
  ]);
  await db.insert(projectSchema).values([
    { id: WS_A1, accountId: ACCT_A, slug: 'revenue', name: 'Northwind Revenue' },
    { id: WS_A2, accountId: ACCT_A, slug: 'finance', name: 'Northwind Finance' },
    { id: WS_B, accountId: ACCT_B, slug: 'ops', name: 'Kestrel Ops' },
  ]);
});

describe('the ledger row a charge files', () => {
  it('is one row per call, carrying the person, thread, run and effort the call ran under', async () => {
    await withCallContext({ userId: 'user_1', effortLevel: 'deep', traceId: 'trace_1' }, () =>
      withRunCost({ conversationId: 77 }, () =>
        chargeUsage({ orgId: WS_A1, agentSlug: 'revenue-lead', feature: 'chat.judge', model: 'claude-opus-5-5', usage: USAGE, latencyMs: 812 })));

    const rows = await db.select().from(modelCallSchema);

    // An agent and a feature are two budget counters for this call, and one ledger row.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: WS_A1,
      accountId: ACCT_A,
      agentSlug: 'revenue-lead',
      feature: 'chat.judge',
      userId: 'user_1',
      conversationId: 77,
      runKind: null,
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effortLevel: 'deep',
      inputTokens: 1_000,
      outputTokens: 500,
      latencyMs: 812,
      traceId: 'trace_1',
    });
    expect(rows[0]!.microCents).toBeGreaterThan(0);
  });

  it('files a mission run\'s calls under the run, from the run-cost scope alone', async () => {
    await withRunCost({ missionRunId: 9 }, () => chargeUsage({ orgId: WS_A1, agentSlug: 'pipeline-analyst', model: 'claude-sonnet-5', usage: USAGE }));

    const [row] = await db.select().from(modelCallSchema);

    expect(row).toMatchObject({ runKind: 'mission_run', runId: '9', feature: 'agent.turn', userId: null });
  });

  it('lets an inner context name the run over the outer one', async () => {
    await withCallContext({ runKind: 'eval_run', runId: 'founder-qa', userId: 'user_1' }, () =>
      withCallContext({ runKind: 'browser_run', runId: 5 }, () =>
        chargeUsage({ orgId: WS_A1, feature: 'browser.run', model: 'claude-sonnet-5', usage: USAGE })));

    const [row] = await db.select().from(modelCallSchema);

    expect(row).toMatchObject({ runKind: 'browser_run', runId: '5', userId: 'user_1' });
  });
});

describe('spendBy', () => {
  async function seed() {
    await db.insert(agentSchema).values([
      { orgId: WS_A1, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'x' },
      { orgId: WS_B, slug: 'revenue-lead', name: 'Someone Else\'s Lead', systemPrompt: 'x' },
    ] as never);
    await withCallContext({ userId: 'user_1' }, async () => {
      await chargeUsage({ orgId: WS_A1, agentSlug: 'revenue-lead', model: 'claude-opus-5-5', usage: USAGE });
      await chargeUsage({ orgId: WS_A1, agentSlug: 'revenue-lead', model: 'claude-haiku-4-5-20251001', usage: USAGE });
      await chargeUsage({ orgId: WS_A2, agentSlug: 'controller', model: 'claude-sonnet-5', usage: USAGE });
    });
    await chargeUsage({ orgId: WS_B, agentSlug: 'revenue-lead', model: 'claude-opus-5-5', usage: { inputTokens: 9_000_000, outputTokens: 9_000_000 } });
  }

  it('reads an Org by workspace, and never another Org\'s rows', async () => {
    await seed();

    const out = await spendBy({ scope: { accountId: ACCT_A }, groupBy: 'workspace', from: FROM, to: TO });

    expect(out.rows.map(r => r.label).sort()).toEqual(['Northwind Finance', 'Northwind Revenue']);
    expect(out.total.calls).toBe(3);
    expect(out.rows.every(r => r.key !== WS_B)).toBe(true);
  });

  it('groups a workspace by agent and model, biggest first, labelled from that workspace only', async () => {
    await seed();

    const byAgent = await spendBy({ scope: { orgId: WS_A1 }, groupBy: 'agent', from: FROM, to: TO });
    const byModel = await spendBy({ scope: { orgId: WS_A1 }, groupBy: 'model', from: FROM, to: TO });

    expect(byAgent.rows).toEqual([expect.objectContaining({ key: 'revenue-lead', label: 'Revenue Lead', calls: 2, tokens: 3_000 })]);
    expect(byModel.rows.map(r => r.key)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5-20251001']);
    expect(byModel.rows[0]!.microCents).toBeGreaterThan(byModel.rows[1]!.microCents);
  });

  it('groups by person, naming calls no person made', async () => {
    await seed();
    await chargeUsage({ orgId: WS_A1, agentSlug: 'revenue-lead', model: 'claude-sonnet-5', usage: USAGE });

    const out = await spendBy({ scope: { orgId: WS_A1 }, groupBy: 'user', from: FROM, to: TO });

    expect(out.rows.map(r => r.key).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([null, 'user_1'].sort((a, b) => String(a).localeCompare(String(b))));
    expect(out.rows.find(r => r.key === null)!.label).toMatch(/No person/);
  });

  it('narrows by a filter and a period', async () => {
    await seed();

    const filtered = await spendBy({ scope: { accountId: ACCT_A }, groupBy: 'model', from: FROM, to: TO, filters: { agentSlug: 'controller' } });
    const later = await spendBy({ scope: { accountId: ACCT_A }, groupBy: 'model', from: TO, to: new Date(TO.getTime() + 60_000) });

    expect(filtered.rows.map(r => r.key)).toEqual(['claude-sonnet-5']);
    expect(later.total.calls).toBe(0);
  });
});
