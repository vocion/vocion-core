/**
 * Resolving which key a tool call spends.
 *
 * Mirrors `libs/llm/orgKey` for the paid tool providers: the org's stored key
 * when it has one, null when it has none. Null is the ordinary answer — the
 * caller falls through to the server's env var — so this must never invent a
 * value or throw on an org that simply pasted nothing.
 *
 * The credential store is mocked; no test here touches the database or the
 * vault.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolvePlatformKey = vi.fn<(orgId: string, platform: string) => Promise<string | null>>();

vi.mock('@/services/ApiTokenService', () => ({
  resolvePlatformKey: (orgId: string, platform: string) => resolvePlatformKey(orgId, platform),
}));

const { resolveToolProviderKey } = await import('./orgKey');

beforeEach(() => {
  resolvePlatformKey.mockReset();
  resolvePlatformKey.mockResolvedValue(null);
});

describe('resolveToolProviderKey', () => {
  it('asks the credential store for the platform behind the provider', async () => {
    await resolveToolProviderKey('tavily', 'org_search');

    expect(resolvePlatformKey).toHaveBeenCalledWith('org_search', 'tavily');
  });

  it('hands back the key the org stored', async () => {
    resolvePlatformKey.mockResolvedValue('tvly-theirs');

    await expect(resolveToolProviderKey('tavily', 'org_search')).resolves.toBe('tvly-theirs');
  });

  it('answers null for an org that stored nothing', async () => {
    await expect(resolveToolProviderKey('firecrawl', 'org_search')).resolves.toBeNull();
  });

  it('answers null without a lookup for a provider that has no platform', async () => {
    await expect(resolveToolProviderKey('builtin', 'org_search')).resolves.toBeNull();
    expect(resolvePlatformKey).not.toHaveBeenCalled();
  });

  it('keeps two orgs on their own keys', async () => {
    resolvePlatformKey.mockImplementation(async orgId =>
      orgId === 'org_first' ? 'tvly-first' : 'tvly-second');

    await expect(resolveToolProviderKey('tavily', 'org_first')).resolves.toBe('tvly-first');
    await expect(resolveToolProviderKey('tavily', 'org_second')).resolves.toBe('tvly-second');
  });
});
