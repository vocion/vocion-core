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

import type { CredentialToolProvider } from '@/libs/platforms/registry';
import { platformForToolProvider } from '@/libs/platforms/registry';
import { spendablePlatformKey } from '@/services/ApiTokenService';
import { ToolProviderKeyUnavailableError } from './types';

/**
 * The org's stored key for whatever platform backs `provider`, or null when it
 * has none — or when no platform backs that provider at all.
 *
 * Null is the ordinary answer, not an error: an org that pasted no key is
 * meant to fall through to the server's env var. Callers take the result and
 * let the env var take over when it is null.
 *
 * A lookup that *fails* is the opposite answer and never null. An unreachable
 * credential store or a ciphertext that will not open means this org might be
 * holding a key we cannot see, and spending the deployment's account instead
 * would bill the wrong party without saying so. That case raises
 * {@link ToolProviderKeyUnavailableError}, whose message is safe to show —
 * the underlying error is logged here and goes no further, because a tool's
 * failure text is read by the model.
 * @param provider - The tool provider about to be called, e.g. `tavily`.
 * @param orgId - The org the call is being made for.
 */
export async function resolveToolProviderKey(
  provider: CredentialToolProvider,
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
  try {
    return (await spendablePlatformKey(orgId, platform.id))?.key ?? null;
  } catch (error) {
    console.error('[tools/orgKey] could not read the org\'s stored key', { provider, orgId, error });
    throw new ToolProviderKeyUnavailableError(provider);
  }
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
 * Asks `spendablePlatformKey` — the same question the call path asks — rather
 * than deciding for itself whether a row looks usable. A row is only half the
 * answer: the document behind it still has to carry a value under the field
 * name the registry uses today, and a renamed field quietly ends that. Judging
 * by the row alone put a green badge over keys no call could spend.
 *
 * It throws the key away and keeps the mask. That means a readiness check now
 * pays for a decrypt it used to skip, which is the price of the badge telling
 * the truth; the secret goes no further than this function.
 *
 * A vault that will not open raises rather than answering null, and the
 * catalog decides what to show — see `storedCredentialOrNone` in `./status`.
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
  const spendable = await spendablePlatformKey(orgId, platform.id);
  if (!spendable) {
    return null;
  }
  return { keyHint: spendable.keyHint };
}
