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
  return resolvePlatformKey(orgId, platform.id);
}

/**
 * Whether the org holds a live key for `provider`.
 *
 * Answers the readiness question the Tools catalog asks without decrypting
 * anything: a capability is usable when a key exists, and the catalog has no
 * business handling the secret itself.
 * @param provider - The tool provider in question, e.g. `firecrawl`.
 * @param orgId - The org whose credentials to look at.
 */
export async function hasToolProviderKey(
  provider: string,
  orgId: string,
): Promise<boolean> {
  const platform = platformForToolProvider(provider);
  if (!platform) {
    return false;
  }
  const stored = await listPlatformCredentials(orgId, platform.id);
  return stored.length > 0;
}
