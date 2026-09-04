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
const listPlatformCredentials = vi.fn<(orgId: string, platform: string) => Promise<unknown[]>>();

vi.mock('@/services/ApiTokenService', () => ({
  resolvePlatformKey: (orgId: string, platform: string) => resolvePlatformKey(orgId, platform),
  listPlatformCredentials: (orgId: string, platform: string) => listPlatformCredentials(orgId, platform),
}));

const { resolveToolProviderKey, storedToolProviderCredential } = await import('./orgKey');

const HOUR = 60 * 60 * 1000;

/**
 * One row as `listPlatformCredentials` returns it.
 * @param keyHint - The masked hint on the row.
 * @param expiresAt - When it stops being used, or null for never.
 */
function credentialRow(keyHint: string, expiresAt: Date | null = null) {
  return { id: 'tok_1', name: 'Tavily — tools', keyHint, createdAt: new Date(), expiresAt };
}

beforeEach(() => {
  resolvePlatformKey.mockReset();
  resolvePlatformKey.mockResolvedValue(null);
  listPlatformCredentials.mockReset();
  listPlatformCredentials.mockResolvedValue([]);
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

describe('storedToolProviderCredential', () => {
  it('reports the credential the org holds, with its masked hint', async () => {
    listPlatformCredentials.mockResolvedValue([credentialRow('…abcd')]);

    await expect(storedToolProviderCredential('tavily', 'org_search'))
      .resolves
      .toEqual({ keyHint: '…abcd' });
  });

  it('asks the credential store for the platform behind the provider', async () => {
    await storedToolProviderCredential('firecrawl', 'org_search');

    expect(listPlatformCredentials).toHaveBeenCalledWith('org_search', 'firecrawl');
  });

  it('answers null for an org holding none', async () => {
    await expect(storedToolProviderCredential('tavily', 'org_search')).resolves.toBeNull();
  });

  it('ignores an expired credential, because the call would ignore it too', async () => {
    // `listPlatformCredentials` keeps expired rows on purpose — the settings
    // page has to show them — but `resolvePlatformKey` treats an expired key as
    // none. Counting one here would light the catalog up green for a key no
    // call can spend.
    listPlatformCredentials.mockResolvedValue([credentialRow('…dead', new Date(Date.now() - HOUR))]);

    await expect(storedToolProviderCredential('tavily', 'org_search')).resolves.toBeNull();
  });

  it('keeps a credential whose expiry is still ahead', async () => {
    listPlatformCredentials.mockResolvedValue([credentialRow('…live', new Date(Date.now() + HOUR))]);

    await expect(storedToolProviderCredential('tavily', 'org_search'))
      .resolves
      .toEqual({ keyHint: '…live' });
  });

  it('skips the expired row and reports the live one behind it', async () => {
    listPlatformCredentials.mockResolvedValue([
      credentialRow('…dead', new Date(Date.now() - HOUR)),
      credentialRow('…live'),
    ]);

    await expect(storedToolProviderCredential('tavily', 'org_search'))
      .resolves
      .toEqual({ keyHint: '…live' });
  });

  it('answers null without a lookup for a provider that has no platform', async () => {
    await expect(storedToolProviderCredential('builtin', 'org_search')).resolves.toBeNull();
    expect(listPlatformCredentials).not.toHaveBeenCalled();
  });
});
