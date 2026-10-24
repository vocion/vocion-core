/**
 * JEV, AS A CLASSIFIER (ADR 0006). TypeSafe's decision model, reached through
 * OpenRouter's Decisions API (`POST /api/alpha/decisions`), answers two typed
 * questions about a task before it runs: which of the candidates Vocion
 * supplies should do it (a `choice`), and how hard it should think (a
 * `score` on low / medium / high). Jev never generates anything and never
 * sees a candidate Vocion did not offer.
 *
 * Plain `fetch`, no SDK: Vocion has no build-time or runtime dependency on
 * Jev. Every failure (no answer in time, a 4xx/5xx, a body that is not the
 * documented shape) comes back as a `JevFailure`, never a throw, so the caller
 * falls back to its static route and no run ever fails because of Jev.
 *
 * The key is a bearer token and is never logged, never put in an error, and
 * never returned: `decide` takes it and drops it.
 */

import process from 'node:process';

/** The Decisions API. Alpha: the shape below is the one documented on 2026-10-23. */
export const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
/**
 * The pinned model. 1.13 is the version the published routing accuracy figures
 * were measured on (jev-recipes `model-route`, 2026-10-04); 1.14 is current
 * and can be chosen with `VOCION_JEV_MODEL`. Thresholds are per version.
 */
export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13';
/** Below this choice confidence the answer is not used. */
export const DEFAULT_MIN_CONFIDENCE = 0.6;
/** Jev answers in well under a second; a dispatch waits at most this long. */
export const DEFAULT_TIMEOUT_MS = 3000;

export type Effort = 'high' | 'low' | 'medium';
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];

/** The option Jev may pick when no candidate fits. */
export const NONE = 'none';

/** Jev's settings for this installation, from the environment. */
export type JevSettings = { model: string; minConfidence: number; timeoutMs: number };

/**
 * The installation's Jev settings: `VOCION_JEV_MODEL`, `VOCION_JEV_MIN_CONFIDENCE`
 * (0–1) and `VOCION_JEV_TIMEOUT_MS` (250–10000), each with its default.
 * @param env - The environment.
 */
export function jevSettings(env: Record<string, string | undefined> = process.env): JevSettings {
  const model = (env.VOCION_JEV_MODEL ?? '').trim();
  const conf = Number(env.VOCION_JEV_MIN_CONFIDENCE);
  const timeout = Number(env.VOCION_JEV_TIMEOUT_MS);
  return {
    model: /^[\w.~-]+\/[\w.:-]+$/.test(model) ? model : DEFAULT_JEV_MODEL,
    minConfidence: Number.isFinite(conf) && conf > 0 && conf <= 1 ? conf : DEFAULT_MIN_CONFIDENCE,
    timeoutMs: Number.isFinite(timeout) && timeout >= 250 && timeout <= 10_000 ? Math.round(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

/** One thing Jev may pick: an id of Vocion's, described by what it is good at and what it costs. */
export type JevCandidate = { id: string; text: string };

/** What Jev is asked about. */
export type JevQuestion = {
  /** The task, as Jev reads it: a JSON object of facts at dispatch. */
  state: Record<string, unknown>;
  /** The candidates. One candidate means Jev is asked for the effort only. */
  candidates: readonly JevCandidate[];
};

/** Jev's answer, read. */
export type JevAnswer = {
  /** The candidate picked, `none`, or null when only the effort was asked. */
  choice: string | null;
  confidence: number | null;
  probabilities: Record<string, number>;
  effort: Effort | null;
  effortConfidence: number | null;
  /** The exact build that answered (`typesafe/jev-1.13-20260917`). */
  model: string | null;
  /** USD, when OpenRouter reports it. */
  costUsd: number | null;
  latencyMs: number;
};

/** Why there is no answer. `reason` is a short phrase with no secret in it. */
export type JevFailure = { failed: true; kind: 'bad_response' | 'http' | 'network' | 'timeout'; reason: string; status?: number; latencyMs: number };

const EFFORT_SCALE = [
  'low: a small, well-specified change with one obvious approach; little reasoning needed',
  'medium: a routine change across a few files, or one needing some care to get right',
  'high: a large, ambiguous, cross-cutting or risky change; deep reasoning pays for itself',
];

/**
 * The request body. Pure.
 * @param q - The question.
 * @param model - The Jev model.
 */
export function jevRequestBody(q: JevQuestion, model: string): Record<string, unknown> {
  const questions: Record<string, unknown> = {
    effort: {
      type: 'score',
      instructions: 'How much reasoning effort does the engineering work described in state need?',
      criteria: EFFORT_SCALE,
    },
  };
  if (q.candidates.length > 1) {
    questions.candidate = {
      type: 'choice',
      instructions: 'Which candidate should do the engineering work described in state? Prefer the cheapest candidate whose description covers the work.',
      criteria: {
        ...Object.fromEntries(q.candidates.map(c => [c.id, c.text])),
        [NONE]: 'None of the candidates above fits this work.',
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
  if (q.candidates.length > 1) {
    const c = answers.candidate;
    if (!isObj(c) || c.type !== 'choice' || typeof c.choice !== 'string') {
      return bad('the candidate answer was missing or not a choice');
    }
    choice = c.choice;
    confidence = numOrNull(c.confidence);
    probabilities = isObj(c.probabilities) ? Object.fromEntries(Object.entries(c.probabilities).filter(([, v]) => typeof v === 'number')) as Record<string, number> : {};
  }
  const e = answers.effort;
  if (!isObj(e) || e.type !== 'score' || numOrNull(e.score) === null) {
    return bad('the effort answer was missing or not a score');
  }
  const level = Math.min(2, Math.max(0, Math.round(e.score as number)));
  const usage = isObj(body.usage) ? body.usage : {};
  return {
    choice,
    confidence,
    probabilities,
    effort: EFFORTS[level]!,
    effortConfidence: numOrNull(e.confidence),
    model: typeof body.model === 'string' ? body.model : null,
    costUsd: numOrNull(usage.cost),
    latencyMs,
  };
}

/** Seams for tests. */
export type JevDeps = { fetch?: typeof fetch; now?: () => number; url?: string };

/**
 * Ask Jev. Never throws, never logs the key.
 * @param key - The OpenRouter key.
 * @param q - The question.
 * @param settings - Model and timeout.
 * @param deps - Seams for tests.
 */
export async function decide(key: string, q: JevQuestion, settings: Pick<JevSettings, 'model' | 'timeoutMs'>, deps: JevDeps = {}): Promise<JevAnswer | JevFailure> {
  const now = deps.now ?? Date.now;
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const res = await (deps.fetch ?? fetch)(deps.url ?? JEV_DECISIONS_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Vocion' },
      body: JSON.stringify(jevRequestBody(q, settings.model)),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { failed: true, kind: 'http', status: res.status, reason: `Jev answered HTTP ${res.status}`, latencyMs: now() - started };
    }
    const body = await res.json().catch(() => null);
    return readJevResponse(body, q, now() - started);
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
    return aborted
      ? { failed: true, kind: 'timeout', reason: `no answer within ${settings.timeoutMs} ms`, latencyMs: now() - started }
      : { failed: true, kind: 'network', reason: 'Jev could not be reached', latencyMs: now() - started };
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
