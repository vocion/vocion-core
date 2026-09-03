/**
 * Resolving "which API key should this call use" for a given org.
 *
 * Every outbound call to a model vendor has the same two-step question: does
 * this org have its own key stored, and if not, does the server have one? This
 * module answers the first half. It lives on its own — rather than inside
 * `./registry` or `./langchain` — so that call sites which need nothing but the
 * key (the embedder, the reranker, the vision and image tools) can ask without
 * dragging a client factory or the whole LangChain surface in behind it.
 */

import type { LLMProviderName } from '@vocion/sdk';
import { platformForLLMProvider } from '@/libs/platforms/registry';
import { resolvePlatformKey } from '@/services/ApiTokenService';

/**
 * The org's stored key for whatever platform backs `provider`, or null when it
 * has none — or when no platform maps to that provider at all.
 *
 * Null is the ordinary answer, not an error: an org that has not supplied a key
 * is meant to fall through to the server's own. Callers pass the result
 * straight into a client constructor and let the env var take over when it is
 * null.
 * Providers whose credential is made of more than one field — Bedrock, whose
 * `aws` platform stores an access key id alongside its secret — are answered
 * with null here rather than with their first field. `resolvePlatformKey` hands
 * back field one, which for AWS is the access key id: an identifier, not a
 * secret. Returning it would look like a resolved key and authenticate nothing.
 * Those call sites use `resolveBedrockCredentials` in `./bedrockCredentials`,
 * which reads the whole document.
 * @param provider - The provider about to be called.
 * @param orgId - The org the call is being made for.
 */
export async function resolveOrgProviderKey(
  provider: LLMProviderName,
  orgId: string,
): Promise<string | null> {
  const platform = platformForLLMProvider(provider);
  if (!platform) {
    return null;
  }
  if (platform.fields.length > 1) {
    return null;
  }
  return resolvePlatformKey(orgId, platform.id);
}
