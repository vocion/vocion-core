/**
 * Which Anthropic key the reranker spends.
 *
 * Rerank runs on every search that asks for it, so it is one of the highest
 * frequency outbound calls in the product. Two things matter here and neither
 * is visible from the outside: that an org which supplied its own Anthropic key
 * is billed on its own account, and that the key belonging to one org never
 * survives into the next org's search.
 *
 * The model and the credential lookup are both mocked — no test here makes a
 * network call or touches the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The options handed to each `new ChatAnthropic(...)`, in construction order. */
const modelConstructions: Array<{ apiKey?: string }> = [];

const invoke = vi.fn(async () => ({ content: '[]' }));

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    invoke = invoke;

    constructor(options: { apiKey?: string }) {
      modelConstructions.push(options);
    }
  },
}));

const resolveOrgProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();

vi.mock('@/libs/llm/orgKey', () => ({
  resolveOrgProviderKey: (provider: string, orgId: string) => resolveOrgProviderKey(provider, orgId),
}));

vi.mock('@/libs/Langfuse', () => ({
  traceFor: () => ({
    update: vi.fn(),
    generation: () => ({ end: vi.fn() }),
  }),
}));

const { rerank } = await import('./reranker');

/** Two candidates, because rerank returns early on a list of one. */
const CANDIDATES = [
  { chunkId: 1, documentId: 1, sourceSlug: 'web', content: 'first', score: 0.9 },
  { chunkId: 2, documentId: 2, sourceSlug: 'web', content: 'second', score: 0.8 },
] as unknown as Parameters<typeof rerank>[1];

const originalApiKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  modelConstructions.length = 0;
  invoke.mockClear();
  resolveOrgProviderKey.mockReset();
  resolveOrgProviderKey.mockResolvedValue(null);
  process.env.ANTHROPIC_API_KEY = 'sk-ant-ours';
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

describe('reranker choosing a key', () => {
  it('asks for the key of the org whose search is being reranked', async () => {
    await rerank('a query', CANDIDATES, { orgId: 'org_rerank' });

    expect(resolveOrgProviderKey).toHaveBeenCalledWith('anthropic', 'org_rerank');
  });

  it('uses the org\'s stored key in preference to the environment', async () => {
    resolveOrgProviderKey.mockResolvedValue('sk-ant-theirs');

    await rerank('a query', CANDIDATES, { orgId: 'org_rerank' });

    expect(modelConstructions[0]?.apiKey).toBe('sk-ant-theirs');
  });

  it('falls back to the environment for an org that stored none', async () => {
    await rerank('a query', CANDIDATES, { orgId: 'org_rerank' });

    expect(modelConstructions[0]?.apiKey).toBe('sk-ant-ours');
  });

  it('never carries one org\'s key into the next org\'s search', async () => {
    resolveOrgProviderKey.mockImplementation(async (_provider, orgId) =>
      orgId === 'org_first' ? 'sk-ant-first' : 'sk-ant-second');

    await rerank('a query', CANDIDATES, { orgId: 'org_first' });
    await rerank('a query', CANDIDATES, { orgId: 'org_second' });

    expect(modelConstructions.map(construction => construction.apiKey))
      .toEqual(['sk-ant-first', 'sk-ant-second']);
  });

  it('leaves the key off entirely when nothing has one, so the SDK can complain', async () => {
    // Passing `apiKey: undefined` explicitly would override the SDK's own
    // env lookup with nothing; omitting the option lets it report the
    // missing variable itself.
    delete process.env.ANTHROPIC_API_KEY;

    await rerank('a query', CANDIDATES, { orgId: 'org_rerank' });

    expect(modelConstructions[0]).not.toHaveProperty('apiKey');
  });
});
