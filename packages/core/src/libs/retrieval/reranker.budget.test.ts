/**
 * What a rerank costs, and what happens to a search when the workspace is over
 * its cap.
 *
 * Rerank is one Haiku call per search query — small individually, and one of
 * the highest-frequency outbound calls in the product, which is why it spending
 * against nothing (#279) added up. The policy it follows is the opposite of an
 * ingest's: the call is charged, and over a cap it is SKIPPED rather than
 * refused, because the first-stage ranking is already a usable answer and
 * failing somebody's search over a few hundred tokens would be the wrong trade.
 *
 * The budget runs against PGlite; the model is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    invoke = invoke;
  },
}));

vi.mock('@/libs/llm/orgKey', () => ({
  resolveOrgProviderKey: vi.fn(async () => null),
}));

vi.mock('@/libs/DB');

vi.mock('@/libs/Langfuse', () => ({
  cleanUsageDetails: (input: Record<string, number | undefined>) => input,
  traceFor: () => ({
    update: vi.fn(),
    generation: () => ({ end: vi.fn() }),
  }),
}));

const { db } = await import('@/libs/DB');
const { agentBudgetSchema } = await import('@/models/Schema');
const { rerank } = await import('./reranker');
const { featureScopeSlug, getBudget, ORG_SCOPE_SLUG, orgUsageTotals, setLimits } = await import('@/services/BudgetService');

const ORG = 'org_rerank_budget_test';

const CANDIDATES = [
  { chunkId: 1, documentId: 1, sourceSlug: 'web', content: 'first', score: 0.9 },
  { chunkId: 2, documentId: 2, sourceSlug: 'web', content: 'second', score: 0.8 },
  { chunkId: 3, documentId: 3, sourceSlug: 'web', content: 'third', score: 0.7 },
] as unknown as Parameters<typeof rerank>[1];

beforeEach(async () => {
  invoke.mockReset();
  // The model puts the third candidate first, so a test can tell a real rerank
  // from the untouched first-stage order.
  invoke.mockResolvedValue({
    content: '[2, 0, 1]',
    usage_metadata: { input_tokens: 1_000_000, output_tokens: 0 },
    response_metadata: { model_name: 'claude-haiku-4-5-20251001' },
  });
  await db.delete(agentBudgetSchema);
});

afterEach(async () => {
  await db.delete(agentBudgetSchema);
});

describe('charging a rerank', () => {
  it('charges the retrieval.rerank surface at the model\'s own token count', async () => {
    await rerank('what did we agree', CANDIDATES, { orgId: ORG });

    const surface = await getBudget({ orgId: ORG, agentSlug: featureScopeSlug('retrieval.rerank') });

    // 1M input tokens of Haiku at 100 cents per million.
    expect(surface?.currentCents).toBe(100);
    expect((await orgUsageTotals({ orgId: ORG })).spentCents).toBe(100);
  });
});

describe('a rerank over the cap', () => {
  it('skips the model and hands back the first-stage ranking', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 50 });
    await rerank('first search', CANDIDATES, { orgId: ORG });
    invoke.mockClear();

    const kept = await rerank('second search', CANDIDATES, { orgId: ORG });

    expect(invoke).not.toHaveBeenCalled();
    // The search still answers, in the order the hybrid stage produced.
    expect(kept.map(hit => hit.chunkId)).toEqual([1, 2, 3]);
  });

  it('reranks normally for a workspace that set no cap', async () => {
    const kept = await rerank('what did we agree', CANDIDATES, { orgId: ORG });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(kept.map(hit => hit.chunkId)).toEqual([3, 1, 2]);
  });
});
