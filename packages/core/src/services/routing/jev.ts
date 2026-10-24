/**
 * JEV, AS A CLASSIFIER (ADR 0006). TypeSafe's decision model answers two typed
 * questions about a task before it runs: which of the candidates Vocion
 * supplies should do it (a `choice`), and how hard it should think (a `score`
 * on low / medium / high). Jev never generates anything and never sees a
 * candidate Vocion did not offer.
 *
 * PROVIDERS. TypeSafe's own System One API is the primary one:
 * `POST {TYPESAFE_BASE_URL ?? https://api.typesafe.ai}/v1/systemone` with a
 * TypeSafe key. An OpenRouter key (`sk-or-…`) still works: OpenRouter serves
 * the same System One API at `https://openrouter.ai/api/v1/systemone`, with
 * the model named `typesafe/jev-…`. The request and response are the same
 * shape on both (docs.typesafe.ai/api/system-one, read 2026-10-23); which
 * provider answered is recorded on every run.
 *
 * Plain `fetch`, no SDK: Vocion has no build-time or runtime dependency on
 * Jev. Every failure (no answer in time, a 4xx/5xx/529, a body that is not the
 * documented shape) comes back as a `JevFailure`, never a throw, so the caller
 * falls back to its static route and no run ever fails because of Jev.
 *
 * The key is a bearer token and is never logged, never put in an error, and
 * never returned: `decide` takes it and drops it.
 */

import process from 'node:process';

export const TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
/**
 * The pinned model. A version, never the `jev-latest` alias (the SDK's
 * default): an alias moves when TypeSafe ships, and confidence thresholds are
 * tuned per version. 1.13 is the version the published routing accuracy was
 * measured on (jev-recipes `model-route`, 2026-10-04); `jev-1.14.0` is current
 * and can be chosen with `TYPESAFE_DEFAULT_MODEL`.
 */
export const DEFAULT_JEV_MODEL = 'jev-1.13.0';
/** Below this choice confidence the answer is not used. */
export const DEFAULT_MIN_CONFIDENCE = 0.6;
/** Jev answers in well under a second; a dispatch waits at most this long. */
export const DEFAULT_TIMEOUT_MS = 3000;

export type JevProvider = 'openrouter' | 'typesafe';

export type Effort = 'high' | 'low' | 'medium';
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];

/** The option Jev may pick when no candidate fits. */
export const NONE = 'none';

/** Jev's settings for this installation, from the environment. */
export type JevSettings = { model: string; minConfidence: number; timeoutMs: number; baseUrl: string };

/**
 * The installation's Jev settings: `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_BASE_URL`
 * (https only), `VOCION_JEV_MIN_CONFIDENCE` (0–1) and `VOCION_JEV_TIMEOUT_MS`
 * (250–10000), each with its default.
 * @param env - The environment.
 */
export function jevSettings(env: Record<string, string | undefined> = process.env): JevSettings {
  const model = (env.TYPESAFE_DEFAULT_MODEL ?? '').trim();
  const base = (env.TYPESAFE_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const conf = Number(env.VOCION_JEV_MIN_CONFIDENCE);
  const timeout = Number(env.VOCION_JEV_TIMEOUT_MS);
  return {
    model: /^[\w.~-]+(?:\/[\w.:-]+)?$/.test(model) ? model : DEFAULT_JEV_MODEL,
    minConfidence: Number.isFinite(conf) && conf > 0 && conf <= 1 ? conf : DEFAULT_MIN_CONFIDENCE,
    timeoutMs: Number.isFinite(timeout) && timeout >= 250 && timeout <= 10_000 ? Math.round(timeout) : DEFAULT_TIMEOUT_MS,
    baseUrl: /^https:\/\/[\w.-]+(?::\d+)?(?:\/[\w./-]*)?$/.test(base) ? base : TYPESAFE_BASE_URL,
  };
}

/**
 * The model's name on OpenRouter: `jev-1.13.0` → `typesafe/jev-1.13`,
 * `jev-latest` → `~typesafe/jev-latest`; a name already carrying a maker is kept.
 * @param model - TypeSafe's name.
 */
export function openRouterModel(model: string): string {
  if (model.includes('/')) {
    return model;
  }
  if (model === 'jev-latest' || model === 'jev-preview') {
    return `~typesafe/${model}`;
  }
  return `typesafe/${model.replace(/^(jev-\d+\.\d+)\.0$/, '$1')}`;
}

/**
 * Which provider a key belongs to: OpenRouter keys begin `sk-or-`.
 * @param key - The key.
 */
export function jevProviderOf(key: string): JevProvider {
  return key.startsWith('sk-or-') ? 'openrouter' : 'typesafe';
}

/** Where a call goes and as which model. */
export type JevEndpoint = { provider: JevProvider; url: string; model: string };

/**
 * The endpoint for a key: an OpenRouter key (`sk-or-`) goes to OpenRouter's
 * System One API, any other to TypeSafe's (or `TYPESAFE_BASE_URL`). Pure.
 * @param key - The key.
 * @param settings - The installation's settings.
 */
export function jevEndpoint(key: string, settings: Pick<JevSettings, 'model' | 'baseUrl'>): JevEndpoint {
  if (jevProviderOf(key) === 'openrouter') {
    return { provider: 'openrouter', url: `${OPENROUTER_BASE_URL}/v1/systemone`, model: openRouterModel(settings.model) };
  }
  return { provider: 'typesafe', url: `${settings.baseUrl}/v1/systemone`, model: settings.model.replace(/^typesafe\//, '') };
}

/** One thing Jev may pick: an id of Vocion's, described by what it is good at and what it costs. */
export type JevCandidate = { id: string; text: string };

/** What Jev is asked about. */
export type JevQuestion = {
  /** The task, as Jev reads it: a JSON object of facts at dispatch. */
  state: Record<string, unknown>;
  /** The candidates. One candidate means Jev is asked for the effort only. */
  candidates: readonly JevCandidate[];
  /**
   * What is being decided (ADR 0006): a factory task's engine and model
   * (`engineering`, the default), an agent turn's model and effort (`turn`),
   * or which agent answers a message (`agent`: a choice only, no effort).
   */
  purpose?: JevPurpose;
};

export type JevPurpose = 'agent' | 'engineering' | 'turn';

export type JevAnswer = {
  /** The candidate picked, `none`, or null when only the effort was asked. */
  choice: string | null;
  confidence: number | null;
  probabilities: Record<string, number>;
  effort: Effort | null;
  effortConfidence: number | null;
  /** The exact model that answered (`jev-1.13.0`; OpenRouter: `typesafe/jev-1.13-20260917`). */
  model: string | null;
  /** Billable input tokens (output tokens are free). */
  inputTokens: number | null;
  /** USD, when the provider reports it (OpenRouter does; TypeSafe reports tokens only). */
  costUsd: number | null;
  latencyMs: number;
};

/** Why there is no answer. `reason` is a short phrase with no secret in it. */
export type JevFailure = { failed: true; kind: 'bad_response' | 'http' | 'network' | 'timeout'; reason: string; status?: number; latencyMs: number };

/** How each purpose's questions are worded. The effort scale is low, medium, high in that order. */
const WORDING: Record<JevPurpose, { effort: string | null; scale: string[]; choice: string; none: string }> = {
  engineering: {
    effort: 'How much reasoning effort does the engineering work described in state need?',
    scale: [
      'low: a small, well-specified change with one obvious approach; little reasoning needed',
      'medium: a routine change across a few files, or one needing some care to get right',
      'high: a large, ambiguous, cross-cutting or risky change; deep reasoning pays for itself',
    ],
    choice: 'Which candidate should do the engineering work described in state? Prefer the cheapest candidate whose description covers the work.',
    none: 'None of the candidates above fits this work.',
  },
  turn: {
    effort: 'How much effort does the request described in state deserve from the assistant answering it?',
    scale: [
      'low: a lookup, a short factual answer from one place, a yes/no or a greeting',
      'medium: gather from a few places and synthesise, prepare for a meeting, draft or revise a reply',
      'high: research or analysis across many sources or a long period, a plan, a document, a comparison or a ranking across many items',
    ],
    choice: 'Which model should handle the request described in state? Prefer the cheapest candidate whose description covers the request.',
    none: 'None of the candidates above fits this request.',
  },
  agent: {
    effort: null,
    scale: [],
    choice: 'Which agent on the roster should answer the message described in state? Judge what the person wants done, then which agent owns that work.',
    none: 'No agent on the roster clearly owns this; the lead should answer.',
  },
};

/**
 * The request body. Pure.
 * @param q - The question.
 * @param model - The Jev model.
 */
export function jevRequestBody(q: JevQuestion, model: string): Record<string, unknown> {
  const words = WORDING[q.purpose ?? 'engineering'];
  const questions: Record<string, unknown> = {};
  if (words.effort) {
    questions.effort = { type: 'score', instructions: words.effort, criteria: words.scale };
  }
  if (q.candidates.length > 1 || !words.effort) {
    questions.candidate = {
      type: 'choice',
      instructions: words.choice,
      criteria: {
        ...Object.fromEntries(q.candidates.map(c => [c.id, c.text])),
        [NONE]: words.none,
      },
    };
  }
  return { model, state: q.state, questions };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Jev's answer from a response body, or why it cannot be read. Pure. Every
 * answer is checked by its `type` first, as the reference asks: a missing key
 * or an unexpected type is a bad response, never a default.
 * @param body - The parsed JSON.
 * @param q - The question it answers.
 * @param latencyMs - How long it took.
 */
export function readJevResponse(body: unknown, q: JevQuestion, latencyMs: number): JevAnswer | JevFailure {
  const bad = (reason: string): JevFailure => ({ failed: true, kind: 'bad_response', reason, latencyMs });
  if (!isObj(body) || !isObj(body.answers)) {
    return bad('the response carried no answers');
  }
  const answers = body.answers;
  let choice: string | null = null;
  let confidence: number | null = null;
  let probabilities: Record<string, number> = {};
  const asksEffort = WORDING[q.purpose ?? 'engineering'].effort !== null;
  if (q.candidates.length > 1 || !asksEffort) {
    const c = answers.candidate;
    if (!isObj(c) || c.type !== 'choice' || typeof c.choice !== 'string') {
      return bad('the candidate answer was missing or not a choice');
    }
    choice = c.choice;
    confidence = numOrNull(c.confidence);
    probabilities = isObj(c.probabilities) ? Object.fromEntries(Object.entries(c.probabilities).filter(([, v]) => typeof v === 'number')) as Record<string, number> : {};
  }
  let effort: Effort | null = null;
  let effortConfidence: number | null = null;
  if (asksEffort) {
    const e = answers.effort;
    if (!isObj(e) || e.type !== 'score' || numOrNull(e.score) === null) {
      return bad('the effort answer was missing or not a score');
    }
    effort = EFFORTS[Math.min(2, Math.max(0, Math.round(e.score as number)))]!;
    effortConfidence = numOrNull(e.confidence);
  }
  const usage = isObj(body.usage) ? body.usage : {};
  return {
    choice,
    confidence,
    probabilities,
    effort,
    effortConfidence,
    model: typeof body.model === 'string' ? body.model : null,
    inputTokens: numOrNull(usage.input_tokens),
    costUsd: numOrNull(usage.cost),
    latencyMs,
  };
}

/** Seams for tests. */
export type JevDeps = { fetch?: typeof fetch; now?: () => number };

/**
 * Ask Jev. Never throws, never logs the key.
 * @param key - The TypeSafe (or OpenRouter) key.
 * @param q - The question.
 * @param settings - Model, base URL and timeout.
 * @param deps - Seams for tests.
 */
export async function decide(key: string, q: JevQuestion, settings: Pick<JevSettings, 'model' | 'timeoutMs' | 'baseUrl'>, deps: JevDeps = {}): Promise<JevAnswer | JevFailure> {
  const now = deps.now ?? Date.now;
  const started = now();
  const endpoint = jevEndpoint(key, settings);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const res = await (deps.fetch ?? fetch)(endpoint.url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(jevRequestBody(q, endpoint.model)),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { failed: true, kind: 'http', status: res.status, reason: `Jev (${endpoint.provider}) answered HTTP ${res.status}`, latencyMs: now() - started };
    }
    const body = await res.json().catch(() => null);
    return readJevResponse(body, q, now() - started);
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
    return aborted
      ? { failed: true, kind: 'timeout', reason: `no answer within ${settings.timeoutMs} ms`, latencyMs: now() - started }
      : { failed: true, kind: 'network', reason: `Jev (${endpoint.provider}) could not be reached`, latencyMs: now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a result is a failure.
 * @param r - The result.
 */
export function isJevFailure(r: JevAnswer | JevFailure): r is JevFailure {
  return 'failed' in r;
}
