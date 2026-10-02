/**
 * What an agent run cost, recorded where it is charged (2026-10-02).
 *
 * The run a model call belongs to is a scope, not an argument: a delegated
 * specialist or a recording pass several frames down is counted on the run
 * without being handed its id. These pin the scope's rules — counted inside,
 * nothing outside, the innermost run wins, one run is never counted twice —
 * and that a chat turn's cost lands on its message and its conversation.
 *
 * Runs against PGlite. Fixtures are fictional.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema, missionRunSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { chargeUsage } = await import('@/services/BudgetService');
const { tokenCostMicroCents } = await import('@/libs/pricing');
const { appendMessage } = await import('@/services/ConversationService');
const { centsOf, currentRunCost, withRunCost } = await import('./runCost');

const ORG = 'org_run_cost_kestrel';
const MODEL = 'claude-sonnet-4-6';
const USAGE = { inputTokens: 10_000, outputTokens: 2_000 };
const PRICE = tokenCostMicroCents(MODEL, USAGE);

async function missionRun() {
  const [row] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'QA review', brief: 'review it', status: 'running', team: { lead: 'qa', members: [] } } as never).returning();
  return row!;
}

async function costOf(id: number) {
  const [row] = await db.select({ tokens: missionRunSchema.tokens, microCents: missionRunSchema.microCents }).from(missionRunSchema).where(eq(missionRunSchema.id, id));
  return row!;
}

describe('a mission run\'s cost', () => {
  it('counts every call made inside the run, however deep, on the run\'s row', async () => {
    expect(PRICE).toBeGreaterThan(0);

    const run = await missionRun();

    // A new run starts at zero: recorded, nothing spent yet.
    expect(await costOf(run.id)).toEqual({ tokens: 0, microCents: 0 });

    await withRunCost({ missionRunId: run.id }, async () => {
      await chargeUsage({ orgId: ORG, agentSlug: 'qa', model: MODEL, usage: USAGE });
      // A specialist, two awaits further down, is still the run's spend.
      await Promise.resolve().then(() => chargeUsage({ orgId: ORG, agentSlug: 'designer', model: MODEL, usage: USAGE }));
    });

    expect(await costOf(run.id)).toEqual({ tokens: 24_000, microCents: 2 * PRICE });
  });

  it('counts nothing for a call made outside any run', async () => {
    const run = await missionRun();
    await chargeUsage({ orgId: ORG, agentSlug: 'qa', model: MODEL, usage: USAGE });

    expect(currentRunCost()).toBeUndefined();
    expect(await costOf(run.id)).toEqual({ tokens: 0, microCents: 0 });
  });

  it('counts a call once when the same run is declared twice, and gives a nested run its own', async () => {
    const outer = await missionRun();
    const inner = await missionRun();
    await withRunCost({ missionRunId: outer.id }, async () => {
      // The runtime and the turn inside it both declare the run.
      await withRunCost({ missionRunId: outer.id }, () => chargeUsage({ orgId: ORG, agentSlug: 'qa', model: MODEL, usage: USAGE }));
      // A run started from inside another carries its own cost.
      await withRunCost({ missionRunId: inner.id }, () => chargeUsage({ orgId: ORG, agentSlug: 'qa', model: MODEL, usage: USAGE }));
    });

    expect((await costOf(outer.id)).microCents).toBe(PRICE);
    expect((await costOf(inner.id)).microCents).toBe(PRICE);
  });
});

describe('a chat turn\'s cost', () => {
  it('is held for the turn and written with its answer, and the conversation sums its turns', async () => {
    const [conv] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'product-manager', title: 'Expiring links' } as never).returning();
    for (let turn = 0; turn < 2; turn++) {
      const scope = await withRunCost({ conversationId: conv!.id }, async (s) => {
        await chargeUsage({ orgId: ORG, agentSlug: 'product-manager', model: MODEL, usage: USAGE });
        return s;
      });

      expect(scope.microCents).toBe(PRICE);

      await appendMessage({ orgId: ORG, conversationId: conv!.id, role: 'assistant', content: 'Done.', cost: { tokens: scope.tokens, microCents: scope.microCents } });
    }
    // A person's message carries no cost, whatever is passed.
    await appendMessage({ orgId: ORG, conversationId: conv!.id, role: 'user', content: 'Thanks', cost: { tokens: 1, microCents: 1 } });

    const messages = await db.select({ role: conversationMessageSchema.role, microCents: conversationMessageSchema.microCents }).from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conv!.id));

    expect(messages.map(m => [m.role, m.microCents])).toEqual([['assistant', PRICE], ['assistant', PRICE], ['user', null]]);

    const [row] = await db.select({ tokens: conversationSchema.tokens, microCents: conversationSchema.microCents, messageCount: conversationSchema.messageCount }).from(conversationSchema).where(eq(conversationSchema.id, conv!.id));

    expect(row).toEqual({ tokens: 24_000, microCents: 2 * PRICE, messageCount: 3 });
  });

  it('reads not recorded as null, never as $0.00', () => {
    expect(centsOf(null)).toBeNull();
    expect(centsOf(1_330_000)).toBe(1);
  });
});
