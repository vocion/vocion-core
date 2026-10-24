/**
 * The Routing view's read (ADR 0006, phase 2) against a real database: a
 * routed turn files its decision on every ledger row it charges, a turn with
 * no key files exactly what it filed before, and the summary counts each turn
 * once, folds fallback reasons, splits spend by how the model was chosen and
 * never reads another Org's rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema, modelCallSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { chargeUsage } = await import('@/services/BudgetService');
const { withCallContext } = await import('./callContext');
const { routingSummary } = await import('./routing');

const ACCT = 'acct_route_a';
const OTHER = 'acct_route_b';
const WS = 'ws_route_a';
const WS_B = 'ws_route_b';
const FROM = new Date(Date.now() - 86_400_000);
const TO = new Date(Date.now() + 60_000);
const USAGE = { inputTokens: 1_000, outputTokens: 500 };

const charge = (orgId: string, model: string, trace: string, route?: { selector: 'configured' | 'jev'; detail: Record<string, unknown> }) =>
  withCallContext({ traceId: trace, ...(route ? { routeSelector: route.selector, routeDetail: route.detail } : {}) }, () =>
    chargeUsage({ orgId, agentSlug: 'revenue-director', model, usage: USAGE }));

beforeEach(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(modelCallSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values([
    { id: ACCT, name: 'Northwind', slug: 'northwind-route' },
    { id: OTHER, name: 'Kestrel Capital', slug: 'kestrel-route' },
  ]);
  await db.insert(projectSchema).values([
    { id: WS, accountId: ACCT, slug: 'revenue', name: 'Northwind Revenue' },
    { id: WS_B, accountId: OTHER, slug: 'ops', name: 'Kestrel Ops' },
  ]);
});

describe('the ledger row of a routed turn', () => {
  it('carries the decision, and a turn with no key carries none', async () => {
    await charge(WS, 'claude-opus-5-5', 't1', { selector: 'jev', detail: { kind: 'chat', choice: 'm3', confidence: 0.8 } });
    await charge(WS, 'claude-sonnet-5-5', 't2');

    const rows = await db.select().from(modelCallSchema).orderBy(modelCallSchema.id);

    expect(rows[0]).toMatchObject({ routeSelector: 'jev', routeDetail: { kind: 'chat', choice: 'm3' } });
    expect(rows[1]).toMatchObject({ routeSelector: null, routeDetail: null });
  });
});

describe('routingSummary', () => {
  it('counts turns once, by kind, with the fallbacks and spend by how the model was chosen', async () => {
    // One routed chat turn that made two calls; a mission that fell back twice for a timeout; one not routed.
    await charge(WS, 'claude-opus-5-5', 't1', { selector: 'jev', detail: { kind: 'chat' } });
    await charge(WS, 'claude-opus-5-5', 't1', { selector: 'jev', detail: { kind: 'chat' } });
    await charge(WS, 'claude-sonnet-5-5', 't2', { selector: 'configured', detail: { kind: 'mission', fallback: 'no answer within 3000 ms' } });
    await charge(WS, 'claude-sonnet-5-5', 't3', { selector: 'configured', detail: { kind: 'mission', fallback: 'no answer within 1500 ms' } });
    await charge(WS, 'claude-sonnet-5-5', 't4');
    await charge(WS_B, 'claude-opus-5-5', 't9', { selector: 'jev', detail: { kind: 'chat' } });

    const s = await routingSummary({ scope: { accountId: ACCT }, from: FROM, to: TO });

    expect(s.turns).toEqual({ jev: 1, configured: 2 });
    expect(s.byKind).toEqual([{ kind: 'mission', jev: 0, configured: 2 }, { kind: 'chat', jev: 1, configured: 0 }]);
    expect(s.fallbacks).toEqual([{ reason: 'no answer within n ms', turns: 2 }]);
    expect(s.spendByModel.map(r => [r.model, r.selector, r.calls])).toEqual(expect.arrayContaining([
      ['claude-opus-5-5', 'jev', 2],
      ['claude-sonnet-5-5', 'configured', 2],
      ['claude-sonnet-5-5', 'not routed', 1],
    ]));
    expect(s.spendByModel).toHaveLength(3);
  });

  it('counts first messages Jev assigned, and those it left to the model read', async () => {
    const [a, b] = await db.insert(conversationSchema).values([
      { orgId: WS, projectId: WS, agentSlug: 'revenue-director', title: 'a' },
      { orgId: WS_B, projectId: WS_B, agentSlug: 'ops-lead', title: 'b' },
    ]).returning();
    await db.insert(conversationMessageSchema).values([
      { conversationId: a!.id, role: 'user', routingJson: { decidedBy: 'jev', chosen: 'pipeline-analyst' } },
      { conversationId: a!.id, role: 'user', routingJson: { decidedBy: 'model', jev: { fallback: 'unsure' } } },
      { conversationId: a!.id, role: 'user', routingJson: { decidedBy: 'model' } },
      { conversationId: b!.id, role: 'user', routingJson: { decidedBy: 'jev' } },
    ] as never);

    const s = await routingSummary({ scope: { orgId: WS }, from: FROM, to: TO });

    expect(s.agentPicks).toEqual({ jev: 1, modelRead: 1 });
  });

  it('is all zeros with no key', async () => {
    await charge(WS, 'claude-sonnet-5-5', 't1');

    const s = await routingSummary({ scope: { orgId: WS }, from: FROM, to: TO });

    expect(s).toMatchObject({ turns: { jev: 0, configured: 0 }, byKind: [], fallbacks: [], agentPicks: { jev: 0, modelRead: 0 } });
  });
});
