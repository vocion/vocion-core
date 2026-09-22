/**
 * What an embedding costs the workspace, and when a cap may stop one.
 *
 * Embeddings are the largest single source of model spend in the product — a
 * sync embeds every chunk of every document — and until #279 they were charged
 * to nothing at all. These tests pin the two halves of the fix: every batch is
 * charged at the provider's own token count, and an ingest over a hard cap
 * stops before it calls the provider rather than after.
 *
 * The budget runs against PGlite rather than a stub, because "did the cap
 * actually refuse" is a question about rows, not about which functions were
 * called. OpenAI is mocked; nothing here reaches a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createEmbeddings = vi.fn();

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  return {
    ...actual,
    default: class {
      embeddings = { create: createEmbeddings };
    },
  };
});

// No org has stored a key of its own, so the environment supplies it — the same
// path `embedder.test.ts` takes, and not what these tests are about.
vi.mock('@/libs/llm/orgKey', () => ({
  resolveOrgProviderKey: vi.fn(async () => null),
}));

vi.mock('@/libs/DB');

vi.mock('@/libs/Langfuse', () => ({
  flushTraces: vi.fn(async () => {}),
  traceFor: () => ({
    update: vi.fn(),
    generation: () => ({ end: vi.fn() }),
  }),
}));

const { db } = await import('@/libs/DB');
const { agentBudgetSchema } = await import('@/models/Schema');
const { embed } = await import('@/libs/retrieval/embedder');
const { featureScopeSlug, getBudget, ORG_SCOPE_SLUG, orgUsageTotals, setLimits } = await import('@/services/BudgetService');

const ORG = 'org_embed_budget_test';
const EMBEDDING_DIMENSIONS = 1536;

/** Tokens each mocked batch reports, chosen so the arithmetic below is obvious. */
const TOKENS_PER_BATCH = 50_000_000;

const originalApiKey = process.env.OPENAI_API_KEY;

/**
 * Build a successful embedding response for one batch.
 * @param inputCount - How many inputs the response should return vectors for.
 */
function successfulResponse(inputCount: number) {
  return {
    data: Array.from({ length: inputCount }, (_, index) => ({
      index,
      embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.1),
    })),
    usage: { prompt_tokens: TOKENS_PER_BATCH, total_tokens: TOKENS_PER_BATCH },
  };
}

beforeEach(async () => {
  process.env.OPENAI_API_KEY = 'sk-test-embedding-budget';
  createEmbeddings.mockReset();
  createEmbeddings.mockImplementation(async ({ input }: { input: string[] }) => successfulResponse(input.length));
  await db.delete(agentBudgetSchema);
});

afterEach(async () => {
  await db.delete(agentBudgetSchema);
  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

describe('charging an embedding', () => {
  it('charges the retrieval.embed surface and the workspace at the provider\'s token count', async () => {
    await embed(['one chunk'], { orgId: ORG, purpose: 'ingest' });

    const surface = await getBudget({ orgId: ORG, agentSlug: featureScopeSlug('retrieval.embed') });
    const totals = await orgUsageTotals({ orgId: ORG });

    // 50M tokens of text-embedding-3-small at 2 cents per million.
    expect(surface?.currentCents).toBe(100);
    expect(totals.spentCents).toBe(100);
    expect(totals.tokens).toBe(TOKENS_PER_BATCH);
  });

  it('charges every batch, not just the first', async () => {
    // OpenAI takes 100 texts per request, so 150 chunks is two batches — the
    // shape a real document takes, and the one a charge placed after the loop
    // would have under-counted by half.
    await embed(Array.from({ length: 150 }, (_, index) => `chunk ${index}`), { orgId: ORG, purpose: 'ingest' });

    const totals = await orgUsageTotals({ orgId: ORG });

    expect(createEmbeddings).toHaveBeenCalledTimes(2);
    expect(totals.tokens).toBe(TOKENS_PER_BATCH * 2);
  });

  it('charges a query embedding too, so search spend is visible', async () => {
    await embed(['what did we agree'], { orgId: ORG, purpose: 'query' });

    expect((await orgUsageTotals({ orgId: ORG })).tokens).toBe(TOKENS_PER_BATCH);
  });

  it('charges the org that is embedding and no other', async () => {
    await embed(['one chunk'], { orgId: ORG, purpose: 'ingest' });

    expect((await orgUsageTotals({ orgId: 'org_somebody_else' })).tokens).toBe(0);
  });
});

describe('refusing an embedding', () => {
  it('stops an ingest over the workspace cap before it calls the provider', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 50 });
    // One batch takes the workspace to 100 cents against a 50-cent cap.
    await embed(['first document'], { orgId: ORG, purpose: 'ingest' });
    createEmbeddings.mockClear();

    await expect(embed(['second document'], { orgId: ORG, purpose: 'ingest' }))
      .rejects
      .toThrow(/Budget exceeded/);
    // Nothing was spent on the refusal itself, which is what "stops cleanly"
    // has to mean: a document that is refused writes no vectors and costs
    // nothing.
    expect(createEmbeddings).not.toHaveBeenCalled();
  });

  it('still answers a search when the workspace is over its cap', async () => {
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 1 });
    await embed(['first document'], { orgId: ORG, purpose: 'ingest' });

    // Refusing this would break search outright for a fraction of a cent —
    // see the policy in BudgetService's docstring.
    const vectors = await embed(['what did we agree'], { orgId: ORG, purpose: 'query' });

    expect(vectors).toHaveLength(1);
  });

  it('lets an ingest through for an org that set no cap', async () => {
    await embed(['first document'], { orgId: ORG, purpose: 'ingest' });
    const vectors = await embed(['second document'], { orgId: ORG, purpose: 'ingest' });

    expect(vectors).toHaveLength(1);
  });
});
