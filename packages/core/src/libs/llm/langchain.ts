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
 * Defaults match rev-ai (`server/llm.py`).
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AwsCredentials } from '@/services/ApiTokenService';
import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatBedrockConverse } from '@langchain/aws';
import { ChatOpenAI } from '@langchain/openai';
import { bedrockRegion, resolveBedrockCredentials } from './bedrockCredentials';
import { thinkingBudgetFor } from './modelPrefs';
import { resolveOrgProviderKey } from './orgKey';
import { CachingChatAnthropic, CachingChatBedrockConverse, promptCacheAllowed } from './promptCache';
import { llmMode } from './replay';
import { getReplayCache } from './replayCache';
import { buildScriptedChatModel } from './scripted';

/**
 * Model roles. Add a new role here (not a new env var) when you need
 * a model for a new purpose; lets us swap a role's underlying model
 * without grep-replacing IDs across services.
 */
export type ModelRole = 'main' | 'classifier' | 'embedder' | 'skillTurn' | 'extractor';

/** Provider tag — narrow alphabet so the env validation is straightforward. */
/**
 * Whether this Anthropic model REFUSES sampling parameters.
 *
 * Claude 4.7, 4.8 and the whole 5 family answer `temperature` / `top_p` /
 * `top_k` with a 400 ("`temperature` is deprecated for this model"). The 4.6
 * generation only deprecated them and still honours what it is sent, which
 * matters because `claude-sonnet-4-6` is the default main model: dropping the
 * parameter there would silently move every default call off `temperature: 0`
 * and make deterministic work non-deterministic. So the line is drawn at 4.7,
 * not at "4.6 and newer" — an earlier version of this function included 4.6
 * and would have done exactly that.
 *
 * Bedrock ids decorate the model name (`us.anthropic.claude-sonnet-5-v1:0`),
 * so the match is deliberately a substring rather than an exact id.
 * @param model
 */
export function anthropicOmitsSampling(model: string): boolean {
  return /claude-(?:opus-4-[78]|sonnet-5|opus-5|fable-5|mythos-5)/.test(model);
}

/**
 * Whether this Anthropic model takes ADAPTIVE thinking rather than a token
 * budget.
 *
 * From 4.6 the API's thinking control is `{ type: 'adaptive' }`: the model
 * decides how much to think per request. `budget_tokens` is deprecated on
 * 4.6 and answered with a 400 from 4.7 up, and so is the `temperature: 1`
 * the budgeted form used to require. Older models still need the budgeted
 * form. The 4.6 line here is deliberately one generation earlier than
 * `anthropicOmitsSampling`'s 4.7: adaptive is *supported* on 4.6, so there
 * is no reason to keep sending it a deprecated shape.
 * @param model
 */
export function anthropicAdaptiveThinking(model: string): boolean {
  return /claude-(?:sonnet-4-6|opus-4-[678]|sonnet-5|opus-5|fable-5|mythos-5)/.test(model);
}

/**
 * Whether this Anthropic model thinks when a request leaves `thinking` out, and
 * takes `{ type: 'disabled' }` to stop. On these models "no thinking field" is
 * not "no thinking", so an `off` has to be sent. Fable 5 and Mythos 5 answer
 * `disabled` with a 400 and are left out, as is anything newer than Opus 5
 * until its behaviour is known.
 * @param model - The model id, bare or Bedrock-decorated.
 */
export function anthropicThinksUnlessDisabled(model: string): boolean {
  return /claude-(?:sonnet|opus)-5(?!-\d)/.test(model);
}

/**
 * The output cap when a caller sets none. LangChain's own table stops at the
 * 4.x family — `claude-sonnet-5` falls to its 4096 fallback, shared with
 * adaptive thinking — and production showed what that buys (2026-09-18): a
 * `render_document` call whose HTML ran past the cap arrived as truncated JSON
 * with no `html`, twice, while a 6 KB markdown squeaked through. The 5 family
 * answers up to 64k; 32k leaves room for a long tool argument and the
 * thinking that precedes it. Older models keep LangChain's 16384.
 * @param model - The bare Anthropic model id.
 */
export function defaultAnthropicMaxTokens(model: string): number {
  return /claude-(?:sonnet-5|opus-5|fable-5|mythos-5)/.test(model) ? 32_000 : 16_384;
}

export type LangChainProvider = 'anthropic' | 'openai' | 'bedrock' | 'scripted';

/** Every value `VOCION_LLM_PROVIDER` may be set to, for validation + error text. */
const PROVIDERS: readonly LangChainProvider[] = ['anthropic', 'openai', 'bedrock', 'scripted'];

/** Defaults if the per-role / per-provider env vars are not set. */
const DEFAULTS: Record<LangChainProvider, Record<ModelRole, string>> = {
  anthropic: {
    main: 'claude-sonnet-4-6',
    classifier: 'claude-haiku-4-5-20251001',
    // No first-party embedding model from Anthropic today. Embedder
    // calls should resolve to a different provider via env override
    // until we add a dedicated registry path.
    embedder: 'claude-haiku-4-5-20251001',
    // The scoped skill-turn executor (one skill, read-only tools, structured
    // output). Its own role so the latency/quality tradeoff is measured via
    // VOCION_LLM_MODEL_SKILLTURN, not hardcoded; a bigger model buys
    // first-time-right redrafts, not speed.
    skillTurn: 'claude-sonnet-4-6',
    // Per-document candidate extraction from an ingested page: JSON only,
    // no tools, one bounded call. Its own role so the cost/quality trade is
    // measured through VOCION_LLM_MODEL_EXTRACTOR rather than riding on
    // whatever `main` happens to be.
    extractor: 'claude-sonnet-4-6',
  },
  openai: {
    main: 'gpt-4o',
    classifier: 'gpt-4o-mini',
    embedder: 'text-embedding-3-small',
    skillTurn: 'gpt-4o',
    extractor: 'gpt-4o',
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
    skillTurn: 'us.anthropic.claude-sonnet-4-6',
    extractor: 'us.anthropic.claude-sonnet-4-6',
  },
  scripted: {
    main: 'scripted',
    classifier: 'scripted',
    embedder: 'scripted',
    skillTurn: 'scripted',
    extractor: 'scripted',
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
export function resolveProvider(role: ModelRole): LangChainProvider {
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

/**
 * The provider a bare model id belongs to, read off the id's shape — or null
 * when the shape says nothing.
 *
 * Exists for the one call site that names a model without naming a vendor:
 * the model-upgrade test (`services/evals/modelUpgradeTest.ts`), where a person
 * types `gpt-6-astra` and expects it to run on OpenAI without also having to
 * say so. Every other path still passes the provider explicitly — see
 * `chatModelOptionsFor` in `services/agents/harness.ts` for why a bare
 * `model:` in workspace YAML is NOT resolved this way (those ids were authored
 * for a different harness, and guessing would send a Bedrock id to Anthropic).
 *
 * The rules are the vendors' own naming: OpenAI ids start with `gpt-`, `o<n>`
 * or `text-`; Anthropic's start with `claude-`; a Bedrock id carries a vendor
 * segment (`anthropic.`, `amazon.`, `meta.`) or a cross-region prefix. Nothing
 * else is guessed — an unknown shape returns null and the caller decides.
 * @param modelId - A bare model id as a provider would report it.
 */
export function inferProviderForModel(modelId: string): LangChainProvider | null {
  const id = modelId.trim().toLowerCase();
  if (/^(?:us|eu|apac|global)\./.test(id) || /^(?:anthropic|amazon|meta|mistral|cohere)\./.test(id)) {
    return 'bedrock';
  }
  if (id.startsWith('claude-')) {
    return 'anthropic';
  }
  if (id.startsWith('gpt-') || id.startsWith('text-') || /^o\d/.test(id) || id.startsWith('chat-')) {
    return 'openai';
  }
  return null;
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
 * The model id a role resolves to on a NAMED provider — the agent's vendor
 * rather than the env's (`services/AgentService.ts` model preferences).
 * @param role
 * @param provider
 */
export function resolvedModelIdFor(role: ModelRole, provider: LangChainProvider): string {
  return resolveModel(role, provider);
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
   * Extended thinking for THIS model, chosen per conversation
   * (`libs/llm/modelPrefs.ts`). Wins over `VOCION_THINKING_BUDGET`: `off`
   * turns thinking off even when the env turns it on, and says so on models
   * that think unless told not to; an effort sends its
   * budget on budgeted models and adaptive thinking on models that size
   * their own. Anthropic and Bedrock-Claude only; ignored elsewhere.
   */
  thinking?: 'off' | 'low' | 'medium' | 'high';
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
  /**
   * Ask the vendor to cache the prompt prefix on every call this model makes.
   *
   * On by default for Anthropic and Bedrock, which is what stops an agent loop
   * paying full input price for the same system prompt, tool list and
   * conversation history on every turn — see `./promptCache.ts` for the
   * measured reason and for what silently does not cache. Pass `false` for an
   * agent whose prompt must never sit in a vendor's cache; the whole process
   * can be switched off with `VOCION_PROMPT_CACHE=0`.
   *
   * OpenAI ignores this: its caching is automatic and has no per-call switch.
   */
  promptCache?: boolean;
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
  if (provider === 'scripted') {
    // A written part, for reproducible chat use cases (`./scripted.ts`).
    // No key, no network, no replay cache: the script IS the recording.
    return buildScriptedChatModel();
  }
  const model = opts.model ?? resolveModel(role, provider);
  const temperature = opts.temperature ?? 0;
  // Record/replay (demo sandbox): the LangChain cache only intercepts
  // non-streamed generations, so both modes force streaming off. In
  // replay mode the cache never misses (fallback generation), so the
  // provider below is constructed but never called.
  const mode = llmMode();
  const streaming = mode === 'live' ? (opts.streaming ?? true) : false;
  // Caching is the default, and the class carrying it is chosen here because
  // neither vendor integration takes the instruction at construction time.
  // Replay mode builds a model it never calls, so the choice is moot there.
  const caching = (opts.promptCache ?? true) && promptCacheAllowed();
  const Anthropic = caching ? CachingChatAnthropic : ChatAnthropic;
  const Bedrock = caching ? CachingChatBedrockConverse : ChatBedrockConverse;

  switch (provider) {
    case 'anthropic': {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? (mode === 'replay' ? 'replay-mode-no-key' : undefined);
      if (!apiKey) {
        throw new Error(`ANTHROPIC_API_KEY is not set; cannot construct chat model for role ${role}`);
      }
      const thinkingBudget = opts.thinking ? thinkingBudgetFor(opts.thinking) : resolveThinkingBudget(role);
      if (thinkingBudget !== null && anthropicAdaptiveThinking(model)) {
        // 4.6+: the switch is still VOCION_THINKING_BUDGET (set = on), but the
        // number is not sent — the model sizes its own thinking. No
        // `temperature` either: 4.7+ reject it, and thinking never took a
        // value other than the default anyway. This branch was `enabled` +
        // `budget_tokens` + `temperature: 1` until 2026-09-15, all three of
        // which 4.7+ answer with a 400.
        return withReplay(new Anthropic({
          model,
          streaming,
          apiKey,
          thinking: { type: 'adaptive' },
          maxTokens: opts.maxTokens ?? defaultAnthropicMaxTokens(model),
        }));
      }
      if (thinkingBudget !== null) {
        return withReplay(new Anthropic({
          model,
          // Pre-4.6: budgeted thinking requires temperature 1 — override the
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
      return withReplay(new Anthropic({
        model,
        // 4.6+/5-family models 400 on any sampling parameter — omit it.
        ...(anthropicOmitsSampling(model) ? {} : { temperature }),
        streaming,
        apiKey,
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.thinking === 'off' && anthropicThinksUnlessDisabled(model) ? { thinking: { type: 'disabled' as const } } : {}),
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
      return withReplay(new Bedrock({
        model,
        region: opts.region ?? bedrockRegion(),
        // Bedrock is a different transport to the same models, so it refuses
        // the same parameters. This branch sent `temperature` unconditionally
        // until 2026-09-15, which meant a 5-family model reached through
        // Bedrock still 400'd after the Anthropic branch was fixed.
        ...(anthropicOmitsSampling(model) ? {} : { temperature }),
        streaming,
        ...(opts.awsCredentials ? { credentials: opts.awsCredentials } : {}),
        ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.thinking === 'off' && anthropicThinksUnlessDisabled(model)
          ? { additionalModelRequestFields: { thinking: { type: 'disabled' } } }
          : {}),
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
  if (provider === 'scripted') {
    return buildChatModel(role, { ...opts, provider });
  }
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
 * Prompt caching moved out of this file on 2026-09-22 (LARK-261).
 *
 * `withPromptCache(messages)` used to live here. It marked the LAST message's
 * final text block as cacheable, which is the wrong end of the prompt: what
 * repeats between calls is the system prompt, the tool list and the settled
 * history, not the newest user message. It also had no call site, so nothing
 * was ever cached by it.
 *
 * Caching is now a property of the model rather than of a message array — see
 * `./promptCache.ts`, and the `promptCache` option above — so every call made
 * through the built model caches, including the calls the agent graph makes
 * that this codebase never touches.
 */
