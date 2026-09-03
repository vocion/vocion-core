import type { LLMClient, LLMProviderName } from '@vocion/sdk';
import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { anthropicClient } from './anthropic';
import { bedrockClient, buildBedrockRuntimeClient } from './bedrock';
import { bedrockRegion, resolveBedrockCredentials } from './bedrockCredentials';
import { openaiClient } from './openai';
import { resolveOrgProviderKey } from './orgKey';

/**
 * Provider clients are constructed per call.
 *
 * There used to be one cached client per provider, which saved a constructor
 * and shared a TCP pool. That cache is gone, and deliberately: resolving an
 * org's own key now means a database read and an AES decrypt on every call, so
 * the constructor was never the expensive part — and a cache keyed on anything
 * less than the exact key in use is how one tenant ends up holding another
 * tenant's client. Building fresh is cheap, correct, and makes a revoked or
 * rotated key take effect on the very next call with nothing to invalidate.
 *
 * Unconfigured providers throw on first use with a clear message about which
 * env var is missing. Vertex + azure-openai are registered as "not yet
 * implemented" placeholders so plugin authors can declare the intent today; we
 * ship the adapters when a real customer needs them.
 *
 * Bedrock is not built here — see {@link buildBedrockClientForOrg}. Its
 * credential is an AWS key pair rather than a single string, so it does not fit
 * this signature, and the fallback when an org has stored nothing is the AWS
 * SDK's own credential chain rather than a named env var.
 * @param provider - Which provider to construct. Must be a single-key provider.
 * @param apiKey - The key the client authenticates with.
 */
function buildClient(provider: LLMProviderName, apiKey: string): LLMClient {
  switch (provider) {
    case 'openai':
      return openaiClient(new OpenAI({ apiKey }));
    case 'anthropic':
      return anthropicClient(new Anthropic({ apiKey }));
    // A switch, not a ternary, because this used to be one: anything that was
    // not `openai` fell through to Anthropic, so adding a third provider to the
    // union silently built an Anthropic client and authenticated it with the
    // wrong vendor's key. Every provider now says its own name or is refused.
    case 'bedrock':
    case 'vertex':
    case 'azure-openai':
      refuseProvider(provider);
  }
}

/**
 * The env var that holds the server's own key for a provider, or null for a
 * provider that has no single-env-var key — either because we have no adapter
 * for it yet (`vertex`, `azure-openai`) or because its credential is not one
 * string (`bedrock`, which resolves through the AWS credential chain).
 * @param provider - The provider being resolved.
 */
function envVarFor(provider: LLMProviderName): string | null {
  if (provider === 'openai') {
    return 'OPENAI_API_KEY';
  }
  if (provider === 'anthropic') {
    return 'ANTHROPIC_API_KEY';
  }
  return null;
}

/**
 * A Bedrock client for `orgId`, on the org's own AWS key pair when it has
 * stored one and on the process's own AWS identity otherwise.
 *
 * Bedrock gets its own factory rather than a `buildClient` case because its
 * credential is a pair and its fallback is a chain, not an env var. See
 * `./bedrockCredentials` for the resolution order and for why Bedrock is
 * allowed the platform-identity fallback that other AWS call sites refuse.
 * @param orgId - The org whose stored AWS credentials should be preferred.
 */
async function buildBedrockClientForOrg(orgId: string): Promise<LLMClient> {
  const { keyPair } = await resolveBedrockCredentials(orgId);
  return bedrockClient(buildBedrockRuntimeClient({
    region: bedrockRegion(),
    credentials: keyPair,
  }));
}

/**
 * Refuse a provider we cannot construct, with the reason the caller can act on.
 * @param provider - The provider that could not be built.
 */
function refuseProvider(provider: LLMProviderName): never {
  const envVar = envVarFor(provider);
  if (!envVar) {
    throw new Error(`${provider} provider not yet implemented — coming in Phase 5 with retrieval backends`);
  }
  throw new Error(`${envVar} is not set; cannot construct ${provider} provider`);
}

/**
 * A client for `provider` built on the **server's** key.
 *
 * This is the original contract and still backs the plugin SDK's `ctx.llm` on
 * any path with no org in hand. Prefer {@link getLLMClientForOrg} wherever an
 * org id is available, so a customer who supplied their own key is billed on
 * their own account.
 * @param provider - Which provider to construct.
 */
export function getLLMClient(provider: LLMProviderName): LLMClient {
  // Bedrock has no server key to read: the process's AWS identity comes from
  // the SDK's credential chain, which resolves at request time. Nothing to
  // check here, so nothing to refuse — an unauthenticated host surfaces as the
  // AWS error naming what it could not find, which says more than we could.
  if (provider === 'bedrock') {
    return bedrockClient(buildBedrockRuntimeClient({
      region: bedrockRegion(),
      credentials: null,
    }));
  }
  const envVar = envVarFor(provider);
  if (!envVar) {
    refuseProvider(provider);
  }
  const apiKey = process.env[envVar];
  if (!apiKey) {
    refuseProvider(provider);
  }
  return buildClient(provider, apiKey);
}

/**
 * A client for `provider` built on **the org's own key** when it has stored
 * one, and on the server's key otherwise.
 *
 * Async because resolving the org's key means reading and decrypting a row —
 * a single indexed lookup. Callers that run per-request should reach for this.
 * Nothing here is cached, by the design described at the top of this file.
 * @param provider - Which provider to construct.
 * @param orgId - The org whose stored key should be preferred.
 */
export async function getLLMClientForOrg(provider: LLMProviderName, orgId: string): Promise<LLMClient> {
  // Bedrock first: it has an adapter but no single-env-var key, so it would be
  // refused by the check below for a reason that does not apply to it.
  if (provider === 'bedrock') {
    return buildBedrockClientForOrg(orgId);
  }
  // Refuse an unimplemented provider before looking for a key. An org can
  // legitimately have stored a Vertex key — we just have no adapter to hand it
  // to yet, and building the wrong client would be worse than refusing.
  if (!envVarFor(provider)) {
    refuseProvider(provider);
  }
  const apiKey = await resolveOrgProviderKey(provider, orgId);
  if (!apiKey) {
    return getLLMClient(provider);
  }
  return buildClient(provider, apiKey);
}

export type { BuildChatModelOptions, LangChainProvider, ModelRole } from './langchain';

/* ------------------------------------------------------------------ */
/* Role-based LangChain chat-model factory (re-export)                 */
/* ------------------------------------------------------------------ */

// Role API for LangChain BaseChatModel selection. Used by the deepagents
// runtime (Phase 4) and any other LangChain-based call site. The
// provider-neutral LLMClient above stays the contract for plugin skills
// (ctx.llm); buildChatModel is the contract for agent runtimes.

export { buildChatModel, buildChatModelForOrg, withPromptCache } from './langchain';
// Re-exported here so `@/libs/llm` stays the one import for anything
// key-related; the implementation lives in `./orgKey` so lighter call sites can
// take it without the client factory.
export { resolveOrgProviderKey } from './orgKey';
