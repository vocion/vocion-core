/**
 * LangChain chat model factory.
 *
 * Provides role-based model selection for the deepagents runtime
 * (Phase 4) and any other LangChain-based call site. The existing
 * `getLLMClient(provider)` / `LLMClient` API in `./registry.ts` stays
 * untouched — it backs the plugin SDK's `ctx.llm` and operates over
 * provider-neutral message arrays. This file lives alongside it for
 * LangChain-specific surfaces.
 *
 * Defaults match rev-ai (`/var/www/metacto/spinutech/kickoff-demo/server/llm.py`).
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AwsCredentials } from '@/services/ApiTokenService';
import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatBedrockConverse } from '@langchain/aws';
import { ChatOpenAI } from '@langchain/openai';
import { bedrockRegion, resolveBedrockCredentials } from './bedrockCredentials';
import { resolveOrgProviderKey } from './orgKey';
import { llmMode } from './replay';
import { getReplayCache } from './replayCache';

/**
 * Model roles. Add a new role here (not a new env var) when you need
 * a model for a new purpose; lets us swap a role's underlying model
 * without grep-replacing IDs across services.
 */
export type ModelRole = 'main' | 'classifier' | 'embedder';

/** Provider tag — narrow alphabet so the env validation is straightforward. */
export type LangChainProvider = 'anthropic' | 'openai' | 'bedrock';

/** Every value `VOCION_LLM_PROVIDER` may be set to, for validation + error text. */
const PROVIDERS: readonly LangChainProvider[] = ['anthropic', 'openai', 'bedrock'];

/** Defaults if the per-role / per-provider env vars are not set. */
const DEFAULTS: Record<LangChainProvider, Record<ModelRole, string>> = {
  anthropic: {
    main: 'claude-sonnet-4-6',
    classifier: 'claude-haiku-4-5-20251001',
    // No first-party embedding model from Anthropic today. Embedder
    // calls should resolve to a different provider via env override
    // until we add a dedicated registry path.
    embedder: 'claude-haiku-4-5-20251001',
  },
  openai: {
    main: 'gpt-4o',
    classifier: 'gpt-4o-mini',
    embedder: 'text-embedding-3-small',
  },
  // Bedrock model ids, unlike the other two providers', are not the plain model
  // names. These are the US cross-region inference profiles (the `us.` prefix),
  // and they are what the account must have model access granted for. Both
  // Claude entries match `packages/agent-runtime/src/model.ts`, so an agent
  // answers on the same model whichever harness ran it.
  //
  // Verified against the Bedrock model cards on 2026-09-03: Claude Sonnet 4.6
  // is offered in us-east-1/us-west-2 only as a cross-region profile — there is
  // no in-region id to fall back to — and both Claude models support Converse.
  bedrock: {
    main: 'us.anthropic.claude-sonnet-4-6',
    classifier: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    // Titan Text Embeddings G1. Named here for completeness, but the embedder
    // role does not build a chat model — `libs/retrieval/embedder.ts` owns the
    // embedding path and reads its own env var, because Titan speaks
    // `InvokeModel` rather than Converse.
    embedder: 'amazon.titan-embed-text-v1',
  },
};

/**
 * Whether a string is a provider we can build.
 * @param value - The raw env value, already lowercased.
 */
function isLangChainProvider(value: string): value is LangChainProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Pick the provider for a given role. Resolution order:
 *
 *   1. VOCION_LLM_PROVIDER_<ROLE>  (e.g. VOCION_LLM_PROVIDER_MAIN=anthropic)
 *   2. VOCION_LLM_PROVIDER         (process-wide default)
 *   3. 'anthropic'                 (per the ADR)
 *
 * Returned values are normalised to lowercase.
 * @param role
 */
function resolveProvider(role: ModelRole): LangChainProvider {
  const roleSpecific = process.env[`VOCION_LLM_PROVIDER_${role.toUpperCase()}`];
  const fallback = process.env.VOCION_LLM_PROVIDER;
  const raw = (roleSpecific || fallback || 'anthropic').toLowerCase();
  if (!isLangChainProvider(raw)) {
    throw new Error(
      `unknown llm provider "${raw}" for role ${role}; expected one of ${PROVIDERS.join(', ')}`,
    );
  }
  return raw;
}

function resolveModel(role: ModelRole, provider: LangChainProvider): string {
  const override = process.env[`VOCION_LLM_MODEL_${role.toUpperCase()}`];
  if (override) {
    return override;
  }
  return DEFAULTS[provider][role];
}

/**
 * The model id `buildChatModel(role)` would construct — for audit stamps (e.g. `classifier_version`).
 * @param role
 */
export function resolvedModelId(role: ModelRole): string {
  return resolveModel(role, resolveProvider(role));
}

/**
 * Extended-thinking opt-in (Anthropic only).
 *
 * When `VOCION_THINKING_BUDGET` is set to a positive integer (tokens,
 * e.g. 2048) and the role is `main`, the Anthropic model is constructed
 * with extended thinking enabled. Two hard API constraints apply:
 *
 *   - `thinking: { type: 'enabled', budget_tokens: N }` requires
 *     `temperature: 1` — any other value is rejected with a 400.
 *   - `budget_tokens` must be ≥ 1024 and < `max_tokens`.
 *
 * Note: `budget_tokens` is deprecated (but functional) on the 4.6
 * family (our default main model is claude-sonnet-4-6) and REMOVED on
 * Opus 4.7+/Fable — those models 400 on it and take
 * `thinking: { type: 'adaptive' }` instead. If `VOCION_LLM_MODEL_MAIN`
 * is pointed at a 4.7+ model, this flag must be revisited.
 *
 * Registered as an optional server var in `src/libs/Env.ts`; read via
 * `process.env` here to match the other `VOCION_LLM_*` vars in this file.
 * @param role
 */
function resolveThinkingBudget(role: ModelRole): number | null {
  if (role !== 'main') {
    return null;
  }
  const raw = process.env.VOCION_THINKING_BUDGET;
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  // Anthropic enforces a 1024-token minimum thinking budget.
  return Math.max(parsed, 1024);
}

/** Options for `buildChatModel`. Override the per-role default if needed. */
export type BuildChatModelOptions = {
  /** Override the resolved provider. */
  provider?: LangChainProvider;
  /** Override the resolved model ID. */
  model?: string;
  /** Default `0` for determinism in agents; override for chat completions. */
  temperature?: number;
  /** Anthropic-only: enable streaming. Default `true`. */
  streaming?: boolean;
  /** Cap on output tokens. Unset = the provider integration's default. */
  maxTokens?: number;
  /**
   * Provider key to authenticate with. Wins over the env var, and is how an
   * org's own stored key reaches the model. Unset falls back to the server's
   * key, which is the right answer for any org that has not supplied one.
   *
   * Bedrock ignores this — its credential is a pair, so it reads
   * `awsCredentials` instead.
   */
  apiKey?: string;
  /**
   * Bedrock only: the AWS key pair to sign with, and how an org's own stored
   * pair reaches the model. Unset leaves the AWS SDK's credential chain in
   * charge, which is what lets `AWS_BEARER_TOKEN_BEDROCK` or a host's instance
   * role authenticate the call.
   */
  awsCredentials?: AwsCredentials;
  /**
   * Bedrock only: override the region. Defaults to `AWS_REGION`, then
   * `us-west-2`.
   */
  region?: string;
};

/**
 * Return a LangChain `BaseChatModel` configured for `role`.
 *
 * Mirrors rev-ai's `build_chat_model(role)` (`server/llm.py:42`). The
 * model + provider are env-driven so the same call site stays valid
 * across deployments.
 * @param role
 * @param opts
 */
export function buildChatModel(
  role: ModelRole,
  opts: BuildChatModelOptions = {},
): BaseChatModel {
  const provider = opts.provider ?? resolveProvider(role);
  const model = opts.model ?? resolveModel(role, provider);
  const temperature = opts.temperature ?? 0;
  // Record/replay (demo sandbox): the LangChain cache only intercepts
  // non-streamed generations, so both modes force streaming off. In
  // replay mode the cache never misses (fallback generation), so the
  // provider below is constructed but never called.
  const mode = llmMode();
  const streaming = mode === 'live' ? (opts.streaming ?? true) : false;

  switch (provider) {
    case 'anthropic': {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? (mode === 'replay' ? 'replay-mode-no-key' : undefined);
      if (!apiKey) {
        throw new Error(`ANTHROPIC_API_KEY is not set; cannot construct chat model for role ${role}`);
      }
      const thinkingBudget = resolveThinkingBudget(role);
      if (thinkingBudget !== null) {
        return withReplay(new ChatAnthropic({
          model,
          // Extended thinking requires temperature 1 — override the
          // deterministic default 0 ONLY on this opt-in path.
          temperature: 1,
          streaming,
          apiKey,
          thinking: { type: 'enabled', budget_tokens: thinkingBudget },
          // budget_tokens must be < max_tokens. The langchain default for
          // the 4.x family is 16384; raise the cap when a large budget
          // would collide with it, and keep any caller-supplied cap above
          // the thinking budget.
          ...(opts.maxTokens
            ? { maxTokens: Math.max(opts.maxTokens, thinkingBudget + 4096) }
            : thinkingBudget + 4096 > 16384
              ? { maxTokens: thinkingBudget + 4096 }
              : {}),
        }));
      }
      return withReplay(new ChatAnthropic({
        model,
        temperature,
        streaming,
        apiKey,
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      }));
    }
    case 'openai': {
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? (mode === 'replay' ? 'replay-mode-no-key' : undefined);
      if (!apiKey) {
        throw new Error(`OPENAI_API_KEY is not set; cannot construct chat model for role ${role}`);
      }
      return withReplay(new ChatOpenAI({
        model,
        temperature,
        streaming,
        apiKey,
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      }));
    }
    case 'bedrock': {
      // No key check and no throw for a missing credential, unlike the two
      // branches above. Bedrock's identity comes from the AWS SDK's credential
      // chain when `awsCredentials` is unset, and that chain resolves at request
      // time from four possible sources — a Bedrock API key in
      // `AWS_BEARER_TOKEN_BEDROCK`, an access key pair in the environment, a
      // shared profile, or the host's instance role. Refusing here because one
      // named env var is empty would break every host that authenticates by
      // instance role, which is how the deployed path already works.
      return withReplay(new ChatBedrockConverse({
        model,
        region: opts.region ?? bedrockRegion(),
        temperature,
        streaming,
        ...(opts.awsCredentials ? { credentials: opts.awsCredentials } : {}),
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      }));
    }
  }
}

/**
 * Return a LangChain `BaseChatModel` for `role`, built on **the org's own
 * provider key** when it has stored one and on the server's key otherwise.
 *
 * This is the per-request form of {@link buildChatModel}. Async because
 * resolving the org's key means decrypting a row, so any call site that has an
 * org id and is already inside an async function should prefer it — that is
 * what puts a customer's model spend on the customer's own account.
 *
 * An explicit `opts.apiKey` still wins; the lookup is skipped entirely in that
 * case.
 * @param role - Which model role to build.
 * @param orgId - The org the call is being made for.
 * @param opts - The same overrides {@link buildChatModel} accepts.
 */
export async function buildChatModelForOrg(
  role: ModelRole,
  orgId: string,
  opts: BuildChatModelOptions = {},
): Promise<BaseChatModel> {
  if (opts.apiKey) {
    return buildChatModel(role, opts);
  }
  const provider = opts.provider ?? resolveProvider(role);
  if (provider === 'bedrock') {
    // Bedrock resolves a pair, not a key, so it cannot go through
    // `resolveOrgProviderKey` — that helper returns a single string and for the
    // `aws` platform would hand back the access key id, which authenticates
    // nothing. An explicit `opts.awsCredentials` still wins, matching how
    // `opts.apiKey` short-circuits the lookup above.
    if (opts.awsCredentials) {
      return buildChatModel(role, { ...opts, provider });
    }
    const { keyPair } = await resolveBedrockCredentials(orgId);
    // `?? undefined` rather than passing null: an org with no stored pair must
    // fall through to the AWS credential chain, not override it with an empty
    // value.
    return buildChatModel(role, { ...opts, provider, awsCredentials: keyPair ?? undefined });
  }
  const apiKey = await resolveOrgProviderKey(provider, orgId);
  // `?? undefined` rather than passing null: an org with no stored key must
  // fall through to the env var, not override it with an empty value.
  return buildChatModel(role, { ...opts, provider, apiKey: apiKey ?? undefined });
}

/**
 * Attach the record/replay file cache in non-live modes. In `record`,
 * generations are persisted after each real call; in `replay`, the cache
 * always answers (recorded or fallback) and the provider is never hit.
 * @param model
 */
function withReplay<T extends BaseChatModel>(model: T): T {
  if (llmMode() !== 'live') {
    model.cache = getReplayCache();
  }
  return model;
}

/**
 * Anthropic prompt-caching helper.
 *
 * Marks the trailing message-content block as cacheable with the
 * ephemeral cache type. Anthropic's prompt cache keys on a hash of all
 * content up to and including the most-recently marked block, so the
 * common pattern is: mark the last shared block (system prompt, large
 * playbook injection, etc.) before any per-turn content.
 *
 * Usage:
 *   const msgs = withPromptCache([
 *     { role: 'system', content: largeSystemPrompt },
 *     ...userMessages,
 *   ]);
 *
 * The helper is a no-op for non-Anthropic models — the
 * `cache_control` field is ignored by other providers.
 */
export type CacheableMessageContent
  = | string
    | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;

export type CacheableMessage = {
  role: string;
  content: CacheableMessageContent;
};

export function withPromptCache<T extends CacheableMessage>(messages: T[]): T[] {
  if (messages.length === 0) {
    return messages;
  }
  // Find the last message that has string or text-block content and
  // mark its final text block as cacheable. Keep other messages
  // untouched.
  const last = messages[messages.length - 1];
  if (!last) {
    return messages;
  }
  const blocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
    = typeof last.content === 'string'
      ? [{ type: 'text', text: last.content }]
      : [...last.content];
  if (blocks.length === 0) {
    return messages;
  }
  const lastBlock = blocks[blocks.length - 1];
  if (!lastBlock) {
    return messages;
  }
  blocks[blocks.length - 1] = { ...lastBlock, cache_control: { type: 'ephemeral' } };
  const updated = { ...last, content: blocks } as T;
  return [...messages.slice(0, -1), updated];
}
