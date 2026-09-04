/**
 * Which Tavily key a web search spends.
 *
 * Search is metered per call, so an org that pasted its own Tavily key should
 * be billed on its own account rather than on the server's shared key. The
 * server key stays the fallback, so a deployment that configured nothing new
 * keeps working exactly as before.
 *
 * Tavily and the credential lookup are both mocked — no test here makes a
 * network call or touches the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The request bodies sent to Tavily, in call order. */
const sentBodies: Array<{ api_key?: string; query?: string }> = [];

const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
  sentBodies.push(init?.body ? JSON.parse(init.body) : {});
  return {
    ok: true,
    json: async () => ({ results: [{ title: 'A page', url: 'https://example.com', content: 'text' }] }),
  };
});

const resolveToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();

vi.mock('@/libs/tools/orgKey', () => ({
  resolveToolProviderKey: (provider: string, orgId: string) => resolveToolProviderKey(provider, orgId),
}));

const { tavilyProvider } = await import('./tavily');
const { ProviderNotConfiguredError } = await import('../types');

const originalApiKey = process.env.TAVILY_API_KEY;

beforeEach(() => {
  sentBodies.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  resolveToolProviderKey.mockReset();
  resolveToolProviderKey.mockResolvedValue(null);
  process.env.TAVILY_API_KEY = 'tvly-ours';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) {
    delete process.env.TAVILY_API_KEY;
  } else {
    process.env.TAVILY_API_KEY = originalApiKey;
  }
});

describe('tavily provider choosing a key', () => {
  it('asks for the key of the org running the search', async () => {
    await tavilyProvider().search('vocion', { orgId: 'org_search' });

    expect(resolveToolProviderKey).toHaveBeenCalledWith('tavily', 'org_search');
  });

  it('uses the org\'s stored key in preference to the environment', async () => {
    resolveToolProviderKey.mockResolvedValue('tvly-theirs');

    await tavilyProvider().search('vocion', { orgId: 'org_search' });

    expect(sentBodies[0]?.api_key).toBe('tvly-theirs');
  });

  it('falls back to the environment for an org that stored none', async () => {
    await tavilyProvider().search('vocion', { orgId: 'org_search' });

    expect(sentBodies[0]?.api_key).toBe('tvly-ours');
  });

  it('skips the lookup entirely when the caller has no org in hand', async () => {
    await tavilyProvider().search('vocion');

    expect(resolveToolProviderKey).not.toHaveBeenCalled();
    expect(sentBodies[0]?.api_key).toBe('tvly-ours');
  });

  it('searches on a stored key even when the server has none of its own', async () => {
    delete process.env.TAVILY_API_KEY;
    resolveToolProviderKey.mockResolvedValue('tvly-theirs');

    await tavilyProvider().search('vocion', { orgId: 'org_search' });

    expect(sentBodies[0]?.api_key).toBe('tvly-theirs');
  });

  it('refuses when neither the org nor the server has a key', async () => {
    delete process.env.TAVILY_API_KEY;

    await expect(tavilyProvider().search('vocion', { orgId: 'org_search' }))
      .rejects
      .toThrow(ProviderNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never carries one org\'s key into the next org\'s search', async () => {
    resolveToolProviderKey.mockImplementation(async (_provider, orgId) =>
      orgId === 'org_first' ? 'tvly-first' : 'tvly-second');
    const provider = tavilyProvider();

    await provider.search('vocion', { orgId: 'org_first' });
    await provider.search('vocion', { orgId: 'org_second' });

    expect(sentBodies.map(body => body.api_key)).toEqual(['tvly-first', 'tvly-second']);
  });
});
