import type { LLMClient, LLMProviderName } from '@vocion/sdk';
import { createHash } from 'node:crypto';
import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { platformForLLMProvider } from '@/libs/platforms/registry';
import { resolvePlatformKey } from '@/services/ApiTokenService';
import { anthropicClient } from './anthropic';
import { openaiClient } from './openai';

/**
 * Provider clients, cached so a skill run does not re-run a constructor and
 * re-open a TCP pool on every call.
 *
 * Two things can vary per client: the provider, and **whose key it holds**. An
 * org that has stored its own OpenAI key gets a client built on that key; every
 * other org shares the client built on the server's env key. So the cache is
 * keyed on the provider plus a fingerprint of the key in use — never on the
 * provider alone. That is what keeps one tenant's client from being handed to
 * another, and it also makes rotation free: a new key is a new fingerprint, so
 * the stale client is simply never looked up again.
 *
 * Unconfigured providers throw on first use with a clear message about which
 * env var is missing. Vertex + azure-openai are registered as "not yet
 * implemented" placeholders so plugin authors can declare the intent today; we
 * ship the adapters when a real customer needs them.
 */

/**
 * Ceiling on cached clients. One per provider per distinct key, so this only
 * grows with the number of orgs holding their own keys. When it fills, the
 * oldest entry goes — a evicted client just gets rebuilt on next use.
 */
const MAX_CACHED_CLIENTS = 200;

const clientCache = new Map<string, LLMClient>();

/**
 * Short, non-reversible stand-in for a key, used only as a cache key. Never
 * logged, never returned — but a hash rather than the key itself means the
 * secret is not sitting in a Map key for a heap dump to find.
 * @param apiKey - The provider key the client will be built on.
 */
function keyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

/**
 * Build a client for `provider` on `apiKey`, or return the cached one.
 * @param provider - Which provider to construct.
 * @param apiKey - The key the client authenticates with.
 */
function cachedClient(provider: LLMProviderName, apiKey: string): LLMClient {
  const cacheKey = `${provider}:${keyFingerprint(apiKey)}`;
  const cached = clientCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const client = provider === 'openai'
    ? openaiClient(new OpenAI({ apiKey }))
    : anthropicClient(new Anthropic({ apiKey }));
  if (clientCache.size >= MAX_CACHED_CLIENTS) {
    const oldest = clientCache.keys().next();
    if (!oldest.done) {
      clientCache.delete(oldest.value);
    }
  }
  clientCache.set(cacheKey, client);
  return client;
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
  return cachedClient(provider, apiKey);
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
  return cachedClient(provider, apiKey);
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

/** Reset cached clients — test-only escape hatch. */
export function resetLLMClients(): void {
  clientCache.clear();
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
