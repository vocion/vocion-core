/**
 * Resolving which key a tool call spends.
 *
 * Mirrors `libs/llm/orgKey` for the paid tool providers: the org's stored key
 * when it has one, null when it has none. Null is the ordinary answer — the
 * caller falls through to the server's env var — so this must never invent a
 * value or throw on an org that simply pasted nothing.
 *
 * Both functions here go through one `spendablePlatformKey`, which is the point
 * of it: "is there a key" and "give me the key" used to be answered by
 * different code and could disagree. What makes a stored row spendable —
 * expiry, a document still keyed by the field name the registry uses, a
 * platform that is one field rather than two — is therefore tested against a
 * real database in `services/ApiTokenService.platforms.test.ts`, and mocked
 * here, where the subject is what this module does with the answer.
 */
import type { CredentialToolProvider } from '@/libs/platforms/registry';
import type { SpendablePlatformKey } from '@/services/ApiTokenService';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolProviderKeyUnavailableError } from './types';

const spendablePlatformKey
  = vi.fn<(orgId: string, platform: string) => Promise<SpendablePlatformKey | null>>();

vi.mock('@/services/ApiTokenService', () => ({
  spendablePlatformKey: (orgId: string, platform: string) => spendablePlatformKey(orgId, platform),
}));

const { resolveToolProviderKey, storedToolProviderCredential } = await import('./orgKey');

/**
 * A key the store says is spendable, as `spendablePlatformKey` returns it.
 * @param key - The secret itself.
 * @param keyHint - The mask a settings page prints in its place.
 */
function spendable(key: string, keyHint = '…abcd'): SpendablePlatformKey {
  return { key, keyHint };
}

beforeEach(() => {
  spendablePlatformKey.mockReset();
  spendablePlatformKey.mockResolvedValue(null);
});

describe('resolveToolProviderKey', () => {
  it('asks the credential store for the platform behind the provider', async () => {
    await resolveToolProviderKey('tavily', 'org_search');

    expect(spendablePlatformKey).toHaveBeenCalledWith('org_search', 'tavily');
  });

  it('hands back the key the org stored', async () => {
    spendablePlatformKey.mockResolvedValue(spendable('tvly-theirs'));

    await expect(resolveToolProviderKey('tavily', 'org_search')).resolves.toBe('tvly-theirs');
  });

  it('answers null for an org that stored nothing', async () => {
    await expect(resolveToolProviderKey('firecrawl', 'org_search')).resolves.toBeNull();
  });

  it('answers null without a lookup for a provider that has no platform', async () => {
    // Cast because the signature now rules this out at compile time, which is
    // the point — the runtime guard stays for a provider name that reaches
    // here from data rather than from a call site, and a silent fall-through
    // to the deployment's account is what it prevents.
    await expect(
      resolveToolProviderKey('builtin' as CredentialToolProvider, 'org_search'),
    ).resolves.toBeNull();
    expect(spendablePlatformKey).not.toHaveBeenCalled();
  });

  it('refuses rather than falls back when the stored key cannot be read', async () => {
    // A ciphertext that no longer opens, or a credential store that is down.
    // Answering null here would hand the call to the server's env var and bill
    // the deployment for an org that may be holding a perfectly good key.
    spendablePlatformKey.mockRejectedValue(new Error('vault: DEK and data have diverged'));

    await expect(resolveToolProviderKey('tavily', 'org_search'))
      .rejects
      .toBeInstanceOf(ToolProviderKeyUnavailableError);
  });

  it('keeps the vault\'s own words out of the error it raises', async () => {
    // The message travels into a tool result, which is read by the model and
    // usually by the end user after it. Postgres and KMS text does not belong
    // in either place.
    spendablePlatformKey.mockRejectedValue(new Error('password authentication failed for user "vocion"'));

    await expect(resolveToolProviderKey('brave', 'org_search'))
      .rejects
      .toThrow(/^the workspace's stored brave key could not be read$/);
  });

  it('keeps two orgs on their own keys', async () => {
    spendablePlatformKey.mockImplementation(async orgId =>
      orgId === 'org_first' ? spendable('tvly-first') : spendable('tvly-second'));

    await expect(resolveToolProviderKey('tavily', 'org_first')).resolves.toBe('tvly-first');
    await expect(resolveToolProviderKey('tavily', 'org_second')).resolves.toBe('tvly-second');
  });
});

describe('storedToolProviderCredential', () => {
  it('reports the credential the org holds, with its masked hint', async () => {
    spendablePlatformKey.mockResolvedValue(spendable('tvly-theirs', '…abcd'));

    await expect(storedToolProviderCredential('tavily', 'org_search'))
      .resolves
      .toEqual({ keyHint: '…abcd' });
  });

  it('keeps the secret to itself and hands back only the mask', async () => {
    // This answer is rendered on a settings page. The decrypt happens so that
    // "ready" means a call could really run, not so the page can hold a key.
    spendablePlatformKey.mockResolvedValue(spendable('tvly-theirs', '…abcd'));

    const stored = await storedToolProviderCredential('tavily', 'org_search');

    expect(JSON.stringify(stored)).not.toContain('tvly-theirs');
  });

  it('asks the credential store for the platform behind the provider', async () => {
    await storedToolProviderCredential('firecrawl', 'org_search');

    expect(spendablePlatformKey).toHaveBeenCalledWith('org_search', 'firecrawl');
  });

  it('answers null for an org holding none', async () => {
    await expect(storedToolProviderCredential('tavily', 'org_search')).resolves.toBeNull();
  });

  it('calls a key unusable exactly when a call would', async () => {
    // The whole reason both go through one function. Whatever makes a row
    // unspendable — expired, a renamed field, a two-field platform — this says
    // "no key" for the same rows the call path refuses, so a green badge can
    // never sit over a key that cannot run.
    spendablePlatformKey.mockResolvedValue(null);

    await expect(storedToolProviderCredential('tavily', 'org_search')).resolves.toBeNull();
    await expect(resolveToolProviderKey('tavily', 'org_search')).resolves.toBeNull();
  });

  it('lets a vault failure through, for the catalog to decide about', async () => {
    // Not caught here: `status.ts` turns it into "this workspace has no key of
    // its own" so the settings page still renders. Swallowing it at this depth
    // would take that choice away from the one caller that has a good answer.
    spendablePlatformKey.mockRejectedValue(new Error('vault: DEK and data have diverged'));

    await expect(storedToolProviderCredential('tavily', 'org_search')).rejects.toThrow();
  });

  it('answers null without a lookup for a provider that has no platform', async () => {
    await expect(storedToolProviderCredential('builtin', 'org_search')).resolves.toBeNull();
    expect(spendablePlatformKey).not.toHaveBeenCalled();
  });
});
