/**
 * How the embedder picks up its OpenAI credentials and model from the
 * environment.
 *
 * Ingestion is the whole point of the vector database, and it stops dead
 * without a valid `OPENAI_API_KEY`. The key is supplied per environment — a
 * local `.env` for development, `/opt/vocion/infra/aws/.env.production` on the
 * production host — so the failure mode we care about is an environment where
 * the variable was never added, or was added to the wrong place and picked up
 * as empty. These tests pin down what happens in each case: a clear error
 * naming the variable, never a silent fallback that stores nothing.
 *
 * They also cover the model choice, since `VOCION_EMBEDDING_MODEL` decides the
 * width of the vectors written to a `vector(1536)` column and an accidental
 * override is not obvious from the outside.
 *
 * They also cover the other place a key can come from: the org's own stored
 * OpenAI credential, which wins over the environment so that a customer's
 * embedding spend lands on the customer's account.
 *
 * The model name is read once at module load, so every test re-imports the
 * module with `vi.resetModules()` rather than sharing one instance. OpenAI
 * itself is mocked, as is the credential lookup — no test here makes a network
 * call or touches the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createEmbeddings = vi.fn();

/**
 * The options handed to each `new OpenAI(...)`, in construction order.
 *
 * This is what proves the key actually reached the client, rather than the
 * client falling back to some other source for it.
 */
const clientConstructions: Array<{ apiKey?: string; maxRetries?: number }> = [];

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  return {
    ...actual,
    default: class {
      embeddings = { create: createEmbeddings };

      constructor(options: { apiKey?: string; maxRetries?: number }) {
        clientConstructions.push(options);
      }
    },
  };
});

vi.mock('@/libs/Langfuse', () => ({
  langfuse: { flushAsync: vi.fn(async () => {}) },
  traceFor: () => ({
    update: vi.fn(),
    generation: () => ({ end: vi.fn() }),
  }),
}));

/**
 * The org's stored OpenAI key, as the credential vault would return it.
 *
 * Mocked rather than seeded, because the real lookup reads and decrypts a row
 * and none of these tests are about that. `null` is the default answer — an org
 * that has supplied no key of its own, which is every org until it does.
 */
const resolveOrgProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();

vi.mock('@/libs/llm/orgKey', () => ({
  resolveOrgProviderKey: (provider: string, orgId: string) => resolveOrgProviderKey(provider, orgId),
}));

const EMBED_OPTIONS = { orgId: 'org_embed_config_test', purpose: 'ingest' as const };

const EMBEDDING_DIMENSIONS = 1536;

const originalApiKey = process.env.OPENAI_API_KEY;
const originalEmbeddingModel = process.env.VOCION_EMBEDDING_MODEL;

/**
 * Build a successful embedding response.
 * @param inputCount - How many inputs the response should return vectors for.
 */
function successfulResponse(inputCount: number) {
  return {
    data: Array.from({ length: inputCount }, (_, index) => ({
      index,
      embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.1),
    })),
    usage: { prompt_tokens: 4, total_tokens: 4 },
  };
}

/**
 * Load a fresh copy of the embedder, reading the environment as it stands now.
 *
 * The model name is held at module level, so a test that changes the
 * environment has to start from a clean module or it would see the previous
 * test's value. The client is not held — it is built per call — but reloading
 * keeps every test starting from the same place.
 */
async function loadEmbedderWithCurrentEnvironment() {
  vi.resetModules();
  return await import('@/libs/retrieval/embedder');
}

/**
 * Put an environment variable back the way the test run found it.
 * @param name - The variable to restore.
 * @param originalValue - Its value before the tests touched it, if it had one.
 */
function restoreEnvironmentVariable(name: string, originalValue: string | undefined): void {
  if (originalValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = originalValue;
  }
}

beforeEach(() => {
  clientConstructions.length = 0;
  resolveOrgProviderKey.mockReset();
  resolveOrgProviderKey.mockResolvedValue(null);
  createEmbeddings.mockReset();
  createEmbeddings.mockImplementation(async ({ input }: { input: string[] }) =>
    successfulResponse(input.length));
});

afterEach(() => {
  restoreEnvironmentVariable('OPENAI_API_KEY', originalApiKey);
  restoreEnvironmentVariable('VOCION_EMBEDDING_MODEL', originalEmbeddingModel);
});

describe('embedder reading the OpenAI key from the environment', () => {
  it('fails with a message naming the missing variable', async () => {
    delete process.env.OPENAI_API_KEY;
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await expect(embed(['a document'], EMBED_OPTIONS)).rejects.toThrow(/No OpenAI key available/);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });

  it('treats an empty value the same as a missing one', async () => {
    // An environment file with a bare `OPENAI_API_KEY=` line leaves an empty
    // string rather than nothing at all. Passing that through would reach
    // OpenAI as an unauthenticated request and fail per batch instead of once,
    // up front.
    process.env.OPENAI_API_KEY = '';
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await expect(embed(['a document'], EMBED_OPTIONS)).rejects.toThrow(/No OpenAI key available/);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });

  it('names both places a key can come from, so the message is actionable', async () => {
    delete process.env.OPENAI_API_KEY;
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await expect(embed(['a document'], EMBED_OPTIONS)).rejects.toThrow(/API credentials/);
    await expect(embed(['a document'], EMBED_OPTIONS)).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('gives the key from the environment to the OpenAI client', async () => {
    process.env.OPENAI_API_KEY = 'sk-proj-from-environment';
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], EMBED_OPTIONS);

    expect(clientConstructions).toHaveLength(1);
    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-from-environment');
  });

  it('turns off the client\'s own retrying, which would multiply our attempts', async () => {
    process.env.OPENAI_API_KEY = 'sk-proj-from-environment';
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], EMBED_OPTIONS);

    expect(clientConstructions[0]?.maxRetries).toBe(0);
  });

  it('builds a fresh client for every call rather than holding one', async () => {
    // The client used to be cached at module level. It cannot be any more: the
    // key now depends on which org is embedding, and a held client would hand
    // the first org's key to every org after it.
    process.env.OPENAI_API_KEY = 'sk-proj-from-environment';
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['first document'], EMBED_OPTIONS);
    await embed(['second document'], EMBED_OPTIONS);

    expect(clientConstructions).toHaveLength(2);
  });

  it('reads the key when embedding rather than when the module loads', async () => {
    // Worth pinning down, because it decides whether adding the key to a
    // running environment needs a restart to take effect and how a
    // half-configured deployment behaves: the process starts either way, and
    // only embedding fails.
    delete process.env.OPENAI_API_KEY;
    const { embed } = await loadEmbedderWithCurrentEnvironment();
    process.env.OPENAI_API_KEY = 'sk-proj-added-after-start';

    await embed(['a document'], EMBED_OPTIONS);

    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-added-after-start');
  });
});

describe('embedder preferring the org\'s own stored OpenAI key', () => {
  it('asks for the key of the org that is embedding', async () => {
    process.env.OPENAI_API_KEY = 'sk-proj-from-environment';
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], EMBED_OPTIONS);

    expect(resolveOrgProviderKey).toHaveBeenCalledWith('openai', EMBED_OPTIONS.orgId);
  });

  it('uses the stored key in preference to the environment', async () => {
    // This is what puts a customer's embedding spend on the customer's own
    // OpenAI account rather than ours.
    process.env.OPENAI_API_KEY = 'sk-proj-ours';
    resolveOrgProviderKey.mockResolvedValue('sk-proj-theirs');
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], EMBED_OPTIONS);

    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-theirs');
  });

  it('falls back to the environment for an org that stored none', async () => {
    process.env.OPENAI_API_KEY = 'sk-proj-ours';
    resolveOrgProviderKey.mockResolvedValue(null);
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], EMBED_OPTIONS);

    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-ours');
  });

  it('embeds on a stored key even when the server has none of its own', async () => {
    delete process.env.OPENAI_API_KEY;
    resolveOrgProviderKey.mockResolvedValue('sk-proj-theirs');
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], EMBED_OPTIONS);

    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-theirs');
  });

  it('never carries one org\'s key into the next org\'s call', async () => {
    // The failure this guards against is silent and expensive: one tenant's
    // documents embedded on another tenant's account.
    process.env.OPENAI_API_KEY = 'sk-proj-ours';
    resolveOrgProviderKey.mockImplementation(async (_provider, orgId) =>
      orgId === 'org_first' ? 'sk-proj-first' : 'sk-proj-second');
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], { orgId: 'org_first', purpose: 'ingest' });
    await embed(['a document'], { orgId: 'org_second', purpose: 'ingest' });

    expect(clientConstructions.map(construction => construction.apiKey))
      .toEqual(['sk-proj-first', 'sk-proj-second']);
  });
});

describe('embedder choosing which model to embed with', () => {
  it('defaults to text-embedding-3-small, matching the 1536-wide column', async () => {
    delete process.env.VOCION_EMBEDDING_MODEL;
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], EMBED_OPTIONS);

    expect(createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-small' }),
    );
  });

  it('uses the model named in VOCION_EMBEDDING_MODEL when one is set', async () => {
    process.env.VOCION_EMBEDDING_MODEL = 'text-embedding-3-large';
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await embed(['a document'], EMBED_OPTIONS);

    expect(createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-large' }),
    );
  });
});

describe('embedder handling an empty request', () => {
  it('returns nothing without needing a key or a request', async () => {
    // Ingest can hand over a document that chunked to nothing. That should be
    // an ordinary empty result, not a credential error and not a billed
    // request.
    delete process.env.OPENAI_API_KEY;
    const { embed } = await loadEmbedderWithCurrentEnvironment();

    await expect(embed([], EMBED_OPTIONS)).resolves.toEqual([]);
    expect(createEmbeddings).not.toHaveBeenCalled();
    expect(clientConstructions).toHaveLength(0);
  });
});
