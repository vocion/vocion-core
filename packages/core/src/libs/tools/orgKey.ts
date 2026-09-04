/**
 * Resolving "which key should this tool call spend" for a given org.
 *
 * The paid tool providers — Tavily and Brave for search, Firecrawl for
 * browsing — bill per call, so an org that pasted its own key should spend its
 * own account here just as it already does for model and embedding calls. This
 * module answers the first half of that question: does this org have a key
 * stored for the provider about to be called?
 *
 * It mirrors `libs/llm/orgKey` deliberately, and lives beside the providers
 * rather than inside one of them so that a provider needing nothing but the
 * key can ask without importing a sibling capability's registry.
 */

import { platformForToolProvider } from '@/libs/platforms/registry';
import { listPlatformCredentials, resolvePlatformKey } from '@/services/ApiTokenService';

/**
 * The org's stored key for whatever platform backs `provider`, or null when it
 * has none — or when no platform backs that provider at all.
 *
 * Null is the ordinary answer, not an error: an org that pasted no key is
 * meant to fall through to the server's env var. Callers take the result and
 * let the env var take over when it is null.
 * @param provider - The tool provider about to be called, e.g. `tavily`.
 * @param orgId - The org the call is being made for.
 */
export async function resolveToolProviderKey(
  provider: string,
  orgId: string,
): Promise<string | null> {
  const platform = platformForToolProvider(provider);
  if (!platform) {
    return null;
  }
  if (platform.fields.length > 1) {
    // `resolvePlatformKey` hands back field one, which on a multi-field
    // credential is an identifier rather than the secret — returning it would
    // look like a resolved key and authenticate nothing. `libs/llm/orgKey`
    // refuses the same way, and AWS is why.
    return null;
  }
  return resolvePlatformKey(orgId, platform.id);
}

/** What the catalog needs to know about a key without handling the key. */
export type StoredToolCredential = {
  /** Masked tail of the stored key, for the settings surface to show. */
  keyHint: string | null;
};

/**
 * The credential the org holds for `provider`, or null when it holds none the
 * next call could actually spend.
 *
 * Answers the readiness question the Tools catalog asks without decrypting
 * anything — the catalog has no business handling the secret itself.
 *
 * Expiry is the subtlety. `listPlatformCredentials` keeps an expired row on
 * purpose, because the settings page has to show one, while the call path's
 * `resolvePlatformKey` treats an expired key as none. Counting an expired row
 * here would light the catalog up green for a key that no call can spend, so
 * expired rows are filtered out to match what the call would do.
 * @param provider - The tool provider in question, e.g. `firecrawl`.
 * @param orgId - The org whose credentials to look at.
 */
export async function storedToolProviderCredential(
  provider: string,
  orgId: string,
): Promise<StoredToolCredential | null> {
  const platform = platformForToolProvider(provider);
  if (!platform) {
    return null;
  }
  const stored = await listPlatformCredentials(orgId, platform.id);
  const spendable = stored.find(credential =>
    credential.expiresAt === null || credential.expiresAt.getTime() > Date.now());
  if (!spendable) {
    return null;
  }
  return { keyHint: spendable.keyHint };
}
