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
import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';

/**
 * Model roles. Add a new role here (not a new env var) when you need
 * a model for a new purpose; lets us swap a role's underlying model
 * without grep-replacing IDs across services.
 */
export type ModelRole = 'main' | 'classifier' | 'embedder';

/** Provider tag — narrow alphabet so the env validation is straightforward. */
export type LangChainProvider = 'anthropic' | 'openai';

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
};

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
  if (raw !== 'anthropic' && raw !== 'openai') {
    throw new Error(
      `unknown llm provider "${raw}" for role ${role}; expected 'anthropic' or 'openai'`,
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
  const streaming = opts.streaming ?? true;

  switch (provider) {
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(`ANTHROPIC_API_KEY is not set; cannot construct chat model for role ${role}`);
      }
      const thinkingBudget = resolveThinkingBudget(role);
      if (thinkingBudget !== null) {
        return new ChatAnthropic({
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
        });
      }
      return new ChatAnthropic({
        model,
        temperature,
        streaming,
        apiKey,
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      });
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(`OPENAI_API_KEY is not set; cannot construct chat model for role ${role}`);
      }
      return new ChatOpenAI({
        model,
        temperature,
        streaming,
        apiKey,
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      });
    }
  }
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
