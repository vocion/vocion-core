/**
 * What the Tools catalog says about a workspace that supplied its own key.
 *
 * Readiness used to be a question about the server alone: is the env var set?
 * Now an org can paste its own key, so a capability can be perfectly usable on
 * a deployment that has no key of its own — and the catalog has to say so, or
 * a workspace that just pasted a Tavily key is told web search is "not
 * configured" and stops trusting the page.
 *
 * The credential store is mocked; no test here touches the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hasToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<boolean>>();

vi.mock('@/libs/tools/orgKey', () => ({
  hasToolProviderKey: (provider: string, orgId: string) => hasToolProviderKey(provider, orgId),
  resolveToolProviderKey: async () => null,
}));

const { capabilityStatuses } = await import('./catalog');

const originalEnv = { ...process.env };

/**
 * The status of one capability from a run of the catalog.
 * @param capability - The capability key, e.g. `web_search`.
 * @param orgId - The org to report for, or undefined for the server's view.
 */
async function statusOf(capability: string, orgId?: string) {
  const statuses = await capabilityStatuses(orgId);
  return statuses.find(status => status.capability === capability);
}

beforeEach(() => {
  hasToolProviderKey.mockReset();
  hasToolProviderKey.mockResolvedValue(false);
  process.env.TAVILY_API_KEY = 'tvly-ours';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('a capability the server has a key for', () => {
  it('is ready and says the key came from the server', async () => {
    const status = await statusOf('web_search', 'org_catalog');

    expect(status?.ready).toBe(true);
    expect(status?.keySource).toBe('server');
  });
});

describe('a capability only the workspace has a key for', () => {
  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    hasToolProviderKey.mockResolvedValue(true);
  });

  it('is ready even though the server has no key', async () => {
    expect((await statusOf('web_search', 'org_catalog'))?.ready).toBe(true);
  });

  it('says the key came from the workspace', async () => {
    expect((await statusOf('web_search', 'org_catalog'))?.keySource).toBe('workspace');
  });

  it('lists no missing env var, because nothing is missing', async () => {
    expect((await statusOf('web_search', 'org_catalog'))?.missingEnv).toEqual([]);
  });
});

describe('a capability nobody has a key for', () => {
  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
  });

  it('is not ready, and names the env var that would fix it', async () => {
    const status = await statusOf('web_search', 'org_catalog');

    expect(status?.ready).toBe(false);
    expect(status?.keySource).toBe('none');
    expect(status?.missingEnv).toEqual(['TAVILY_API_KEY']);
  });
});

describe('a capability that needs no key at all', () => {
  it('is ready on the builtin provider without any credential lookup', async () => {
    const status = await statusOf('browse', 'org_catalog');

    expect(status?.provider).toBe('builtin');
    expect(status?.ready).toBe(true);
    expect(status?.keySource).toBe('none');
  });
});

describe('the server\'s own view of the catalog', () => {
  it('never asks the credential store when no org is in scope', async () => {
    await capabilityStatuses();

    expect(hasToolProviderKey).not.toHaveBeenCalled();
  });
});
