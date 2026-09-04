/**
 * Which Brave subscription token a web search spends.
 *
 * Same rule as Tavily: the org's own token when it pasted one, the server's
 * otherwise. Brave carries the token in a request header rather than the body,
 * which is the only reason this is a separate test file.
 *
 * Brave and the credential lookup are both mocked — no test here makes a
 * network call or touches the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The subscription tokens sent to Brave, in call order. */
const sentTokens: Array<string | undefined> = [];

const fetchMock = vi.fn(async (_url: URL, init?: { headers?: Record<string, string> }) => {
  sentTokens.push(init?.headers?.['X-Subscription-Token']);
  return {
    ok: true,
    json: async () => ({ web: { results: [{ title: 'A page', url: 'https://example.com', description: 'text' }] } }),
  };
});

const resolveToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();

vi.mock('@/libs/tools/orgKey', () => ({
  resolveToolProviderKey: (provider: string, orgId: string) => resolveToolProviderKey(provider, orgId),
}));

const { braveProvider } = await import('./brave');
const { ProviderNotConfiguredError } = await import('../types');

const originalApiKey = process.env.BRAVE_API_KEY;

beforeEach(() => {
  sentTokens.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  resolveToolProviderKey.mockReset();
  resolveToolProviderKey.mockResolvedValue(null);
  process.env.BRAVE_API_KEY = 'brave-ours';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) {
    delete process.env.BRAVE_API_KEY;
  } else {
    process.env.BRAVE_API_KEY = originalApiKey;
  }
});

describe('brave provider choosing a token', () => {
  it('asks for the token of the org running the search', async () => {
    await braveProvider().search('vocion', { orgId: 'org_search' });

    expect(resolveToolProviderKey).toHaveBeenCalledWith('brave', 'org_search');
  });

  it('uses the org\'s stored token in preference to the environment', async () => {
    resolveToolProviderKey.mockResolvedValue('brave-theirs');

    await braveProvider().search('vocion', { orgId: 'org_search' });

    expect(sentTokens[0]).toBe('brave-theirs');
  });

  it('falls back to the environment for an org that stored none', async () => {
    await braveProvider().search('vocion', { orgId: 'org_search' });

    expect(sentTokens[0]).toBe('brave-ours');
  });

  it('skips the lookup entirely when the caller has no org in hand', async () => {
    await braveProvider().search('vocion');

    expect(resolveToolProviderKey).not.toHaveBeenCalled();
    expect(sentTokens[0]).toBe('brave-ours');
  });

  it('searches on a stored token even when the server has none of its own', async () => {
    delete process.env.BRAVE_API_KEY;
    resolveToolProviderKey.mockResolvedValue('brave-theirs');

    await braveProvider().search('vocion', { orgId: 'org_search' });

    expect(sentTokens[0]).toBe('brave-theirs');
  });

  it('refuses when neither the org nor the server has a token', async () => {
    delete process.env.BRAVE_API_KEY;

    await expect(braveProvider().search('vocion', { orgId: 'org_search' }))
      .rejects
      .toThrow(ProviderNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never carries one org\'s token into the next org\'s search', async () => {
    resolveToolProviderKey.mockImplementation(async (_provider, orgId) =>
      orgId === 'org_first' ? 'brave-first' : 'brave-second');
    const provider = braveProvider();

    await provider.search('vocion', { orgId: 'org_first' });
    await provider.search('vocion', { orgId: 'org_second' });

    expect(sentTokens).toEqual(['brave-first', 'brave-second']);
  });
});
