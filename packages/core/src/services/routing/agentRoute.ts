/**
 * DYNAMIC ROUTING FOR AGENT TURNS (ADR 0006, phase 2). The factory's engine
 * router (`route.ts`) asks Jev which engine, model and effort a task gets.
 * This asks the same of an agent turn run on the in-process loop: a person's
 * chat (full page or in app), a mission, a scheduled automation, any other
 * agent run. One question, two answers:
 *
 *   - which of the agent's candidate chat models answers (`harness.routeModels`,
 *     or the workspace's `defaults.routeModels` folded onto it at apply time),
 *     described by capability and relative cost;
 *   - the effort: for a person's chat the turn's level (Quick, Standard,
 *     Deep, `services/agents/effort.ts`), in Auto's place; for any other run
 *     the model's thinking, and only on a model that thinks.
 *
 * THE KEY TURNS IT ON. With no Jev (TypeSafe) API key — workspace override,
 * then instance, then `TYPESAFE_API_KEY` — `routeAgentTurn` returns null and
 * the caller changes nothing: the same model, the same effort, the same
 * ledger rows. With a key, every failure (no answer in time, an HTTP error,
 * low confidence, `none`, a pick outside the candidates) runs the agent's
 * configured model and says why. A chat waits at most
 * `VOCION_JEV_CHAT_TIMEOUT_MS` (1500 ms), beside Auto's own read, so a person
 * is never held for Jev; other runs take `VOCION_JEV_TIMEOUT_MS`.
 *
 * HARD LIMITS FIRST, never put to Jev: a candidate whose vendor has no
 * credential for this workspace (its own stored key, else the server's) is
 * dropped; so is one outside `VOCION_ALLOWED_MODELS` when the installation
 * sets it; the agent's budget and the turn's ceilings are enforced by the
 * same guards as always (`budgetStop.ts`, `effort.ts`), whatever model runs.
 * A person who chose a model or a level, an eval, and a caller that names a
 * model are never routed.
 *
 * Decisions are cached briefly (the same request in the same conversation, a
 * re-run of the same scheduled prompt), and after three failures in a row a
 * workspace skips Jev for a minute, so an outage costs one timeout, not one
 * per turn.
 */

import type { Effort, JevAnswer, JevCandidate, JevDeps, JevFailure, JevProvider, JevQuestion, JevSettings } from './jev';
import type { KeyScope } from './jevKey';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { decide, isJevFailure, jevEndpoint, jevSettings, NONE, questionVersion } from './jev';

export type ChatProvider = 'anthropic' | 'bedrock' | 'openai';
export type CostTier = 'high' | 'low' | 'medium';

/** What kind of run a turn is. Evals are never routed and so never appear here. */
export type TurnKind = 'automation' | 'chat' | 'mission' | 'other';

/** One chat model an agent offers Jev. */
export type AgentRouteModel = { model: string; provider?: ChatProvider; about?: string; cost?: CostTier };

/** A candidate as Jev is shown it, with what it maps back to. */
export type AgentCandidate = JevCandidate & { model: string; provider: ChatProvider; cost: CostTier };

/** What is recorded on every model call the turn makes (`model_call.route_detail`). Never a key. */
export type AgentRouteDetail = {
  kind: TurnKind;
  /** Whether Jev was called (false when skipped, or answered from the cache). */
  asked: boolean;
  cached: boolean;
  candidates: number;
  choice: { model: string; provider: ChatProvider } | null;
  confidence: number | null;
  effort: Effort | null;
  effortConfidence: number | null;
  /** In words, for the turn's line and the Routing view. */
  reason: string;
  jevModel: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  keyScope: KeyScope | null;
  provider: JevProvider | null;
  fallback: string | null;
  /** Which wording of the question was asked (`questionVersion`). */
  questionVersion: string;
};

export type AgentRoute = {
  /** `jev`: Jev's answer is used. `configured`: the agent's configured model runs (`detail.fallback` says why). */
  selector: 'configured' | 'jev';
  /** The model Jev chose, or null when the configured one stands. */
  model: { model: string; provider: ChatProvider } | null;
  /** Jev's effort, when it was trusted. */
  effort: Effort | null;
  detail: AgentRouteDetail;
};

export type AgentRouteInput = {
  orgId: string;
  agentSlug: string;
  kind: TurnKind;
  /** The person's message, or the run's prompt. */
  message: string;
  conversationId?: number | null;
  /** The agent's `harness.routeModels` (factory engine entries are ignored). */
  routeModels?: unknown;
  /** The model that runs when nothing routes: the agent's own, else the deployment's. */
  configured: { model: string; provider: ChatProvider };
  /** The agent leads teammates (told to Jev as a fact). */
  leadsTeammates?: boolean;
};

export type AgentRouteDeps = {
  resolveKey?: (orgId: string) => Promise<{ key: string; scope: KeyScope } | null>;
  decide?: (key: string, q: JevQuestion, settings: Pick<JevSettings, 'model' | 'timeoutMs' | 'baseUrl'>, deps?: JevDeps) => Promise<JevAnswer | JevFailure>;
  settings?: JevSettings;
  /** Whether a vendor has a credential for this workspace. */
  hasCredential?: (orgId: string, provider: ChatProvider) => Promise<boolean>;
  env?: Record<string, string | undefined>;
  now?: () => number;
};

const COSTS: CostTier[] = ['low', 'medium', 'high'];
const PROVIDERS: ChatProvider[] = ['anthropic', 'openai', 'bedrock'];
/** How much of the request Jev reads. */
const MESSAGE_CHARS = 2000;
export const DEFAULT_CHAT_TIMEOUT_MS = 1500;

/**
 * The chat timeout: `VOCION_JEV_CHAT_TIMEOUT_MS`, 250–5000, default 1500.
 * @param env - The environment.
 */
export function chatTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.VOCION_JEV_CHAT_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 250 && v <= 5000 ? Math.round(v) : DEFAULT_CHAT_TIMEOUT_MS;
}

/**
 * The vendor a model id belongs to, read off its shape, or null. The same
 * rules as `libs/llm/langchain.ts` `inferProviderForModel`, spelled here so
 * this module never loads the LLM module.
 * @param model - The id.
 */
export function providerOfModel(model: string): ChatProvider | null {
  const id = model.trim().toLowerCase();
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

/**
 * Whether a model takes a thinking effort: Claude, on Anthropic or Bedrock.
 * @param model - The id.
 * @param provider - Its vendor.
 */
export function supportsThinking(model: string, provider: ChatProvider): boolean {
  return provider !== 'openai' && /claude-/i.test(model);
}

/**
 * An agent's chat-model candidates from its harness. Factory entries (with an
 * `engine`) and anything malformed are left out. Pure.
 * @param raw - `harness.routeModels`.
 */
export function readAgentRouteModels(raw: unknown): AgentRouteModel[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((m): AgentRouteModel[] => {
    const r = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
    if (r.engine !== undefined || typeof r.model !== 'string' || !r.model.trim()) {
      return [];
    }
    return [{
      model: r.model.trim(),
      ...(typeof r.provider === 'string' && (PROVIDERS as string[]).includes(r.provider) ? { provider: r.provider as ChatProvider } : {}),
      ...(typeof r.about === 'string' && r.about.trim() ? { about: r.about.trim().slice(0, 400) } : {}),
      ...(typeof r.cost === 'string' && (COSTS as string[]).includes(r.cost) ? { cost: r.cost as CostTier } : {}),
    }];
  }).slice(0, 12);
}

/**
 * The installation's model fence, from `VOCION_ALLOWED_MODELS` (comma
 * separated ids; a trailing `*` matches a prefix), or null for no fence.
 * @param env - The environment.
 */
export function allowedModels(env: Record<string, string | undefined> = process.env): string[] | null {
  const list = (env.VOCION_ALLOWED_MODELS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * Whether a model is inside the fence.
 * @param model - The id.
 * @param fence - `allowedModels()`.
 */
export function modelAllowed(model: string, fence: string[] | null): boolean {
  return !fence || fence.some(f => (f.endsWith('*') ? model.startsWith(f.slice(0, -1)) : model === f));
}

/**
 * The candidates Jev may pick from, after the hard limits: each one's vendor
 * known and holding a credential here, and inside the fence. The configured
 * model always passes (it is what runs today). With no declared candidates,
 * the configured model is the only one.
 * @param input - The turn.
 * @param ready - Whether a vendor has a credential.
 * @param fence - The installation's model fence.
 */
export async function agentCandidates(
  input: Pick<AgentRouteInput, 'orgId' | 'routeModels' | 'configured'>,
  ready: (provider: ChatProvider) => Promise<boolean>,
  fence: string[] | null,
): Promise<{ candidates: AgentCandidate[]; dropped: string[] }> {
  const declared = readAgentRouteModels(input.routeModels);
  const list: AgentRouteModel[] = declared.length > 0 ? declared : [{ model: input.configured.model, provider: input.configured.provider, cost: 'medium' }];
  const out: AgentCandidate[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    const provider = m.provider ?? providerOfModel(m.model);
    const key = `${provider}\u0000${m.model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const isConfigured = m.model === input.configured.model && provider === input.configured.provider;
    if (!provider) {
      dropped.push(`${m.model}: its vendor is not named and its id does not say`);
      continue;
    }
    if (!isConfigured && !modelAllowed(m.model, fence)) {
      dropped.push(`${m.model}: outside VOCION_ALLOWED_MODELS`);
      continue;
    }
    if (!isConfigured && !(await ready(provider))) {
      dropped.push(`${m.model}: no ${provider} credential in this workspace`);
      continue;
    }
    const cost = m.cost ?? 'medium';
    out.push({
      id: `m${out.length + 1}`,
      model: m.model,
      provider,
      cost,
      text: `${m.about ? `${m.about} ` : ''}Model: ${m.model} (${provider}). Relative cost: ${cost}.`,
    });
  }
  return { candidates: out, dropped };
}

/**
 * What Jev is told about the turn. Facts only, no secrets: the request (cut
 * to 2000 characters), what kind of run it is, and the agent.
 * @param input - The turn.
 */
export function turnState(input: Pick<AgentRouteInput, 'kind' | 'message' | 'agentSlug' | 'leadsTeammates'>): Record<string, unknown> {
  const kinds: Record<TurnKind, string> = {
    chat: 'a person chatting with an assistant at work, waiting for the answer',
    mission: 'a standing mission the assistant runs on its own',
    automation: 'a scheduled automation the assistant runs on its own',
    other: 'an assistant run started by the system',
  };
  return {
    request: input.message.slice(0, MESSAGE_CHARS),
    run: kinds[input.kind],
    assistant: input.agentSlug,
    ...(input.leadsTeammates === undefined ? {} : { leads_a_team: input.leadsTeammates }),
  };
}

/* ---------------------------- cache and breaker --------------------------- */

type Cached = { at: number; answer: JevAnswer };
const cache = new Map<string, Cached>();
const CACHE_LIMIT = 500;
const breaker = new Map<string, { failures: number; openUntil: number }>();
const BREAKER_FAILURES = 3;
const BREAKER_MS = 60_000;

/**
 * How long a decision is reused: a chat's for 10 minutes (a retry or a resend
 * in the same conversation), a scheduled run's for 6 hours (the same prompt
 * on its next tick).
 * @param kind - The run.
 */
function cacheTtlMs(kind: TurnKind): number {
  return kind === 'chat' ? 10 * 60_000 : 6 * 60 * 60_000;
}

function cacheKey(input: AgentRouteInput, candidates: AgentCandidate[], jevModel: string): string {
  const scope = input.kind === 'chat' ? String(input.conversationId ?? '') : '';
  const text = input.message.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MESSAGE_CHARS);
  return createHash('sha256').update([input.orgId, input.agentSlug, input.kind, scope, jevModel, candidates.map(c => `${c.provider}:${c.model}:${c.cost}`).join('|'), text].join('\u0000')).digest('hex');
}

/**
 * Whether a workspace is skipping Jev after failures in a row.
 * @param orgId - The workspace.
 * @param at - Now.
 */
export function jevBreakerOpen(orgId: string, at: number): boolean {
  const t = breaker.get(orgId);
  return Boolean(t && t.openUntil > at);
}

/**
 * Count a Jev call's outcome toward the breaker: three failures in a row skip
 * Jev for a minute; a success resets.
 * @param orgId - The workspace.
 * @param ok - Whether Jev answered.
 * @param at - Now.
 */
export function noteJevOutcome(orgId: string, ok: boolean, at: number): void {
  if (ok) {
    breaker.delete(orgId);
    return;
  }
  const t = breaker.get(orgId) ?? { failures: 0, openUntil: 0 };
  t.failures += 1;
  if (t.failures >= BREAKER_FAILURES) {
    t.openUntil = at + BREAKER_MS;
    t.failures = 0;
  }
  breaker.set(orgId, t);
}

/** Forget every cached decision and breaker (tests). */
export function resetAgentRouteState(): void {
  cache.clear();
  breaker.clear();
}

/* --------------------------------- route ---------------------------------- */

async function defaultHasCredential(orgId: string, provider: ChatProvider, env: Record<string, string | undefined>): Promise<boolean> {
  try {
    if (provider === 'bedrock') {
      if (env.AWS_BEARER_TOKEN_BEDROCK || env.AWS_ACCESS_KEY_ID || env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI || env.AWS_WEB_IDENTITY_TOKEN_FILE) {
        return true;
      }
      const { resolveBedrockCredentials } = await import('@/libs/llm/bedrockCredentials');
      return (await resolveBedrockCredentials(orgId)).keyPair !== null;
    }
    if ((provider === 'anthropic' && env.ANTHROPIC_API_KEY) || (provider === 'openai' && env.OPENAI_API_KEY)) {
      return true;
    }
    const { resolveOrgProviderKey } = await import('@/libs/llm/orgKey');
    return Boolean(await resolveOrgProviderKey(provider, orgId));
  } catch {
    return false;
  }
}

/**
 * Route one agent turn. Null when no Jev key is configured: the caller then
 * changes nothing. Never throws.
 * @param input - The turn.
 * @param deps - Seams for tests.
 */
export async function routeAgentTurn(input: AgentRouteInput, deps: AgentRouteDeps = {}): Promise<AgentRoute | null> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  let resolved: { key: string; scope: KeyScope } | null;
  try {
    resolved = await (deps.resolveKey ?? (async (orgId: string) => (await import('./jevKey')).resolveJevKey(orgId)))(input.orgId);
  } catch {
    // A key that will not read, or a database that will not answer: off, exactly as with no key.
    return null;
  }
  if (!resolved) {
    return null;
  }
  const settings = deps.settings ?? jevSettings(env);
  const endpoint = jevEndpoint(resolved.key, settings);
  const base: AgentRouteDetail = {
    kind: input.kind,
    asked: false,
    cached: false,
    candidates: 0,
    choice: null,
    confidence: null,
    effort: null,
    effortConfidence: null,
    reason: '',
    jevModel: null,
    latencyMs: null,
    costUsd: null,
    inputTokens: null,
    keyScope: resolved.scope,
    provider: endpoint.provider,
    fallback: null,
    questionVersion: questionVersion('turn'),
  };
  const configured = (detail: AgentRouteDetail, why: string): AgentRoute => ({
    selector: 'configured',
    model: null,
    effort: null,
    detail: { ...detail, fallback: why, reason: `the configured model (${input.configured.model}): ${why}` },
  });

  const ready = (provider: ChatProvider) => (deps.hasCredential ? deps.hasCredential(input.orgId, provider) : defaultHasCredential(input.orgId, provider, env));
  const { candidates, dropped } = await agentCandidates(input, ready, allowedModels(env));
  base.candidates = candidates.length;
  if (candidates.length === 0) {
    return configured(base, `no candidate model is usable here (${dropped.join('; ').slice(0, 200)})`);
  }
  // One candidate: Jev is asked the effort only, and only when the effort does
  // something — a chat's level, or a model that thinks.
  if (candidates.length === 1 && input.kind !== 'chat' && !supportsThinking(candidates[0]!.model, candidates[0]!.provider)) {
    return configured(base, `${candidates[0]!.model} takes no thinking effort and there is no other candidate`);
  }
  if (jevBreakerOpen(input.orgId, now())) {
    return configured(base, 'Jev failed three times in a row; skipped for a minute');
  }

  const key = cacheKey(input, candidates, endpoint.model);
  const hit = cache.get(key);
  let answer: JevAnswer | JevFailure;
  let cached = false;
  if (hit && now() - hit.at < cacheTtlMs(input.kind)) {
    answer = hit.answer;
    cached = true;
  } else {
    const timeoutMs = input.kind === 'chat' ? Math.min(chatTimeoutMs(env), settings.timeoutMs) : settings.timeoutMs;
    answer = await (deps.decide ?? decide)(resolved.key, { state: turnState(input), candidates, purpose: 'turn' }, { ...settings, timeoutMs }).catch((): JevFailure => ({ failed: true, kind: 'network', reason: 'Jev could not be reached', latencyMs: 0 }));
  }
  if (isJevFailure(answer)) {
    noteJevOutcome(input.orgId, false, now());
    return configured({ ...base, asked: true, jevModel: endpoint.model, latencyMs: answer.latencyMs }, answer.reason);
  }
  noteJevOutcome(input.orgId, true, now());
  if (!cached) {
    cache.set(key, { at: now(), answer });
    while (cache.size > CACHE_LIMIT) {
      cache.delete(cache.keys().next().value!);
    }
  }

  const picked = candidates.length === 1 ? candidates[0]! : candidates.find(c => c.id === answer.choice) ?? null;
  const detail: AgentRouteDetail = {
    ...base,
    asked: !cached,
    cached,
    choice: picked ? { model: picked.model, provider: picked.provider } : null,
    confidence: answer.confidence,
    effort: answer.effort,
    effortConfidence: answer.effortConfidence,
    jevModel: answer.model ?? endpoint.model,
    latencyMs: cached ? null : answer.latencyMs,
    costUsd: cached ? null : answer.costUsd,
    inputTokens: cached ? null : answer.inputTokens,
  };
  if (candidates.length > 1) {
    if (answer.choice === NONE) {
      return configured(detail, 'Jev found no candidate fits this request');
    }
    if (!picked) {
      return configured(detail, `Jev picked "${String(answer.choice).slice(0, 40)}", which is not a candidate`);
    }
    if (answer.confidence === null || answer.confidence < settings.minConfidence) {
      return configured(detail, `Jev's confidence ${answer.confidence === null ? 'was missing' : answer.confidence.toFixed(2)} is below ${settings.minConfidence}`);
    }
  }
  const effortTrusted = answer.effort !== null && (answer.effortConfidence ?? 0) >= settings.minConfidence;
  // A model that does not think takes no thinking effort outside a chat (where the effort is the turn's level).
  const effortApplies = input.kind === 'chat' || supportsThinking(picked!.model, picked!.provider);
  const effort = effortTrusted && effortApplies ? answer.effort : null;
  if (candidates.length === 1 && !effort) {
    return configured(detail, `Jev's effort confidence ${answer.effortConfidence === null ? 'was missing' : answer.effortConfidence.toFixed(2)} is below ${settings.minConfidence}`);
  }
  const moved = picked!.model !== input.configured.model || picked!.provider !== input.configured.provider;
  const conf = answer.confidence === null ? '' : ` (confidence ${answer.confidence.toFixed(2)})`;
  const reason = candidates.length > 1
    ? `Jev chose ${picked!.model}${conf}${effort ? `, ${effort} effort` : ''}`
    : `Jev set ${effort} effort on ${picked!.model}`;
  return {
    selector: 'jev',
    model: moved ? { model: picked!.model, provider: picked!.provider } : null,
    effort,
    detail: { ...detail, reason: `${reason}${cached ? ' (cached)' : ''}` },
  };
}
