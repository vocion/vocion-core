import type { LLMClient, LLMProviderName } from '@vocion/sdk';
import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { platformForLLMProvider } from '@/libs/platforms/registry';
import { resolvePlatformKey } from '@/services/ApiTokenService';
import { anthropicClient } from './anthropic';
import { openaiClient } from './openai';

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
 * @param provider - Which provider to construct.
 * @param apiKey - The key the client authenticates with.
 */
function buildClient(provider: LLMProviderName, apiKey: string): LLMClient {
  return provider === 'openai'
    ? openaiClient(new OpenAI({ apiKey }))
    : anthropicClient(new Anthropic({ apiKey }));
}

/**
 * The env var that holds the server's own key for a provider, or null for a
 * provider we have no adapter for yet.
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
 * Async because resolving the org's key means decrypting a row. Callers that
 * run per-request should reach for this; the resolution is a single indexed
 * lookup and the resulting client is cached.
 * @param provider - Which provider to construct.
 * @param orgId - The org whose stored key should be preferred.
 */
export async function getLLMClientForOrg(provider: LLMProviderName, orgId: string): Promise<LLMClient> {
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

/**
 * The org's stored key for whatever platform backs `provider`, or null when it
 * has none (or when no platform maps to that provider at all).
 *
 * Exported because the LangChain factory needs the same answer without wanting
 * an `LLMClient` built for it.
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
  return resolvePlatformKey(orgId, platform.id);
}

/* ------------------------------------------------------------------ */
/* Role-based LangChain chat-model factory (re-export)                 */
/* ------------------------------------------------------------------ */

// Role API for LangChain BaseChatModel selection. Used by the deepagents
// runtime (Phase 4) and any other LangChain-based call site. The
// provider-neutral LLMClient above stays the contract for plugin skills
// (ctx.llm); buildChatModel is the contract for agent runtimes.

export type { BuildChatModelOptions, LangChainProvider, ModelRole } from './langchain';
export { buildChatModel, buildChatModelForOrg, withPromptCache } from './langchain';
