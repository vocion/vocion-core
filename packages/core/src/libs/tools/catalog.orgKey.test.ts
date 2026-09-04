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

const storedToolProviderCredential = vi.fn<(provider: string, orgId: string) => Promise<{ keyHint: string | null } | null>>();

vi.mock('@/libs/tools/orgKey', () => ({
  storedToolProviderCredential: (provider: string, orgId: string) => storedToolProviderCredential(provider, orgId),
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
  storedToolProviderCredential.mockReset();
  storedToolProviderCredential.mockResolvedValue(null);
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
    storedToolProviderCredential.mockResolvedValue({ keyHint: '…abcd' });
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

  it('carries the masked hint, so the page needs no second query of its own', async () => {
    expect((await statusOf('web_search', 'org_catalog'))?.storedKeyHint).toBe('…abcd');
  });
});

describe('a credential store that is down', () => {
  it('still reports the server\'s view instead of throwing', async () => {
    // These statuses render two dashboard pages from a server component with
    // no error boundary, so a rejected lookup used to mean a 500 on a page
    // that has something useful to say either way.
    storedToolProviderCredential.mockRejectedValue(new Error('connection refused'));

    const status = await statusOf('web_search', 'org_catalog');

    expect(status?.ready).toBe(true);
    expect(status?.keySource).toBe('server');
  });

  it('says the capability needs a key when the server has none either', async () => {
    delete process.env.TAVILY_API_KEY;
    storedToolProviderCredential.mockRejectedValue(new Error('connection refused'));

    const status = await statusOf('web_search', 'org_catalog');

    expect(status?.ready).toBe(false);
    expect(status?.missingEnv).toEqual(['TAVILY_API_KEY']);
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

describe('every paid capability, not just web search', () => {
  it('reports the workspace key for image generation', async () => {
    // Image generation resolves through the org's OpenAI credential, so it has
    // to answer the same way — it is the one paid capability whose platform is
    // shared with the model calls.
    delete process.env.OPENAI_API_KEY;
    storedToolProviderCredential.mockResolvedValue({ keyHint: '…imgk' });

    const status = await statusOf('generate_image', 'org_catalog');

    expect(status?.ready).toBe(true);
    expect(status?.keySource).toBe('workspace');
  });

  it('leaves the calculator alone, because it spends nothing', async () => {
    storedToolProviderCredential.mockResolvedValue({ keyHint: '…nope' });

    const status = await statusOf('run_code', 'org_catalog');

    expect(status?.provider).toBe('builtin');
    expect(status?.keySource).toBe('none');
    expect(status?.ready).toBe(true);
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

    expect(storedToolProviderCredential).not.toHaveBeenCalled();
  });
});
