/**
 * Which OpenAI key the image provider spends.
 *
 * Image generation is metered per image and costs meaningfully more than a
 * text call, so an org that supplied its own OpenAI key should be billed on its
 * own account here just as it is for models and embeddings.
 *
 * OpenAI and the credential lookup are both mocked — no test here makes a
 * network call or touches the database.
 */
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The options handed to each `new OpenAI(...)`, in construction order. */
const clientConstructions: Array<{ apiKey?: string }> = [];

const generateImage = vi.fn(async () => ({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }));

vi.mock('openai', () => ({
  default: class {
    images = { generate: generateImage };

    constructor(options: { apiKey?: string }) {
      clientConstructions.push(options);
    }
  },
}));

const resolveOrgProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();

vi.mock('@/libs/llm/orgKey', () => ({
  resolveOrgProviderKey: (provider: string, orgId: string) => resolveOrgProviderKey(provider, orgId),
}));

const { openaiImageProvider } = await import('./openai');
const { ProviderNotConfiguredError } = await import('../types');

const originalApiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  clientConstructions.length = 0;
  generateImage.mockClear();
  resolveOrgProviderKey.mockReset();
  resolveOrgProviderKey.mockResolvedValue(null);
  process.env.OPENAI_API_KEY = 'sk-proj-ours';
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

describe('openai image provider choosing a key', () => {
  it('asks for the key of the org generating the image', async () => {
    await openaiImageProvider().generate('a cat', { orgId: 'org_image' });

    expect(resolveOrgProviderKey).toHaveBeenCalledWith('openai', 'org_image');
  });

  it('uses the org\'s stored key in preference to the environment', async () => {
    resolveOrgProviderKey.mockResolvedValue('sk-proj-theirs');

    await openaiImageProvider().generate('a cat', { orgId: 'org_image' });

    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-theirs');
  });

  it('falls back to the environment for an org that stored none', async () => {
    await openaiImageProvider().generate('a cat', { orgId: 'org_image' });

    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-ours');
  });

  it('skips the lookup entirely when the caller has no org in hand', async () => {
    await openaiImageProvider().generate('a cat');

    expect(resolveOrgProviderKey).not.toHaveBeenCalled();
    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-ours');
  });

  it('generates on a stored key even when the server has none of its own', async () => {
    delete process.env.OPENAI_API_KEY;
    resolveOrgProviderKey.mockResolvedValue('sk-proj-theirs');

    await openaiImageProvider().generate('a cat', { orgId: 'org_image' });

    expect(clientConstructions[0]?.apiKey).toBe('sk-proj-theirs');
  });

  it('refuses when neither the org nor the server has a key', async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(openaiImageProvider().generate('a cat', { orgId: 'org_image' }))
      .rejects
      .toThrow(ProviderNotConfiguredError);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('never carries one org\'s key into the next org\'s image', async () => {
    resolveOrgProviderKey.mockImplementation(async (_provider, orgId) =>
      orgId === 'org_first' ? 'sk-proj-first' : 'sk-proj-second');
    const provider = openaiImageProvider();

    await provider.generate('a cat', { orgId: 'org_first' });
    await provider.generate('a dog', { orgId: 'org_second' });

    expect(clientConstructions.map(construction => construction.apiKey))
      .toEqual(['sk-proj-first', 'sk-proj-second']);
  });
});
