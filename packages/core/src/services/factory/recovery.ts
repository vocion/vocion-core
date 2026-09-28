/**
 * THE FACTORY CARRIES A REQUEST THROUGH (backlog 038). The policy, pure.
 *
 * Three things stopped the factory on 2026-09-28, each with its fix named in
 * its own record: a P1 filed in chat that nothing started, a Build that sent
 * a contract the worker refused because the plan rule required a plan, and a
 * failed run ("no changes", "plan is required") that sat at "Engineering
 * stopped" for hours. This module decides, from the records alone, what the
 * factory does next in each case; `carry.ts` reads and writes them.
 *
 *   intakeDecision   a request was filed: start it, card it, or leave it to triage
 *   planGate         a contract is about to be sent: build, or plan first
 *   classifyFailure  a run failed: what kind of failure, in one sentence
 *   recoveryDecision what to do about it, within the limit
 *
 * THE LIMIT. At most {@link RECOVERY_LIMIT} automatic attempts per request
 * since the last person action — a build the intake started, a plan the
 * factory asked for, a run it sent again. Then one ask to the owner with
 * every attempt, its failure and what would unblock it. A person pressing
 * Build, approving a plan or answering that ask starts the count again.
 */

import type { PlanTrigger } from './planRule';
import { planRequirement } from './planRule';

/** Automatic attempts per request since the last person action. */
export const RECOVERY_LIMIT = 3;

/** What a failed engineering run's failure was, as far as the records say. */
export type FailureClass = 'plan_required' | 'no_changes' | 'checks_failed' | 'lost' | 'transient' | 'refused_other';

export type Failure = {
  class: FailureClass;
  /** One sentence a person reads: what went wrong. */
  sentence: string;
  /** The failing checks' own output, trimmed, when checks failed. */
  tail: string | null;
  /** The names of the checks that failed. */
  failedChecks: string[];
};

/** Why an automatic step was taken. `retry` is QA's send-back (`autoRetryOf`). */
export type AttemptTrigger = 'request' | 'recovery' | 'plan' | 'retry';

/** One automatic step on a request. */
export type RecoveryEntry = {
  n: number;
  at: string;
  kind: 'build' | 'plan';
  trigger: AttemptTrigger;
  runId: number | null;
  taskId: number | null;
  /** Why this step was taken, as the Activity line reads. */
  line: string;
  /** Filled when the step's run fails. */
  failure: { class: FailureClass; sentence: string } | null;
};

/** One line of the factory's own account, shown on the feature page's Activity. */
export type RecoveryLogLine = { at: string; text: string; runId: number | null };

/**
 * `request.metadata.recovery` — where the factory's own carrying of a
 * request stands. Written only by the factory; read by the feature page and
 * the Work queue.
 */
export type RecoveryState = {
  /** `planning` — a plan is being written; `recovering` — an automatic attempt is out; `stopped` — the limit was reached and a person is asked. */
  stage: 'planning' | 'recovering' | 'stopped' | null;
  /** The stage in a sentence: "Planning — the allowed paths span 2 packages …". */
  line: string | null;
  /** Automatic steps since the last person action. */
  attempts: RecoveryEntry[];
  /** When a person last acted, and so when the count started. */
  since: string | null;
  limit: number;
  /** The escalation ask, when one is open. */
  askId: number | null;
  /** When planning was asked for, so a plan that never arrives is noticed. */
  planRequestedAt: string | null;
  /** Failed runs already dealt with, so the event and the sweep never act twice. */
  handledRunIds: number[];
  /** Newest last, bounded. */
  log: RecoveryLogLine[];
};

const LOG_MAX = 30;
const HANDLED_MAX = 40;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * The recovery state off a request's metadata, with every field defaulted.
 * @param meta - The request's metadata.
 */
export function readRecovery(meta: Record<string, unknown> | null | undefined): RecoveryState {
  const raw = (meta?.recovery && typeof meta.recovery === 'object' && !Array.isArray(meta.recovery) ? meta.recovery : {}) as Record<string, unknown>;
  const stage = raw.stage === 'planning' || raw.stage === 'recovering' || raw.stage === 'stopped' ? raw.stage : null;
  return {
    stage,
    line: str(raw.line),
    attempts: Array.isArray(raw.attempts) ? (raw.attempts as RecoveryEntry[]).filter(a => a && typeof a === 'object') : [],
    since: str(raw.since),
    limit: typeof raw.limit === 'number' && raw.limit > 0 ? raw.limit : RECOVERY_LIMIT,
    askId: typeof raw.askId === 'number' ? raw.askId : null,
    planRequestedAt: str(raw.planRequestedAt),
    handledRunIds: Array.isArray(raw.handledRunIds) ? (raw.handledRunIds as unknown[]).map(Number).filter(Number.isInteger) : [],
    log: Array.isArray(raw.log) ? (raw.log as RecoveryLogLine[]).filter(l => l && typeof l.text === 'string') : [],
  };
}

/**
 * A line on the factory's own account, newest last.
 * @param state - The state.
 * @param text - What happened, in a sentence.
 * @param at - When.
 * @param runId - The run it was about, when there is one.
 */
export function logLine(state: RecoveryState, text: string, at: string, runId: number | null = null): RecoveryState {
  return { ...state, log: [...state.log, { at, text, runId }].slice(-LOG_MAX) };
}

/**
 * A person acted: pressed Build, approved a plan, answered the ask. The count
 * starts again; what happened before stays in the log.
 * @param state - The state.
 * @param at - When.
 * @param what - What they did, for the log.
 */
export function personActed(state: RecoveryState, at: string, what: string): RecoveryState {
  return logLine({ ...state, stage: null, line: null, attempts: [], since: at, askId: null, planRequestedAt: null }, what, at);
}

/**
 * An automatic step was taken.
 * @param state - The state.
 * @param entry - The step, without its number.
 */
export function noteAttempt(state: RecoveryState, entry: Omit<RecoveryEntry, 'n' | 'failure'>): RecoveryState {
  const n = state.attempts.length + 1;
  const stage = entry.kind === 'plan' ? 'planning' : entry.trigger === 'recovery' || entry.trigger === 'retry' ? 'recovering' : null;
  const why = bare(entry.line);
  const plain = why.replace(/^Recovered:\s*/, '');
  const line = stage === 'planning'
    ? `Planning — ${why}`
    : stage === 'recovering' ? `Recovering (attempt ${n} of ${state.limit}): ${plain}` : null;
  const text = entry.kind === 'plan'
    ? `${entry.trigger === 'recovery' ? 'Recovered: planning first because' : 'Planning first:'} ${why}.`
    : stage === 'recovering' ? `Recovered: ${plain} (attempt ${n} of ${state.limit}).` : `Attempt ${n} of ${state.limit} started: ${why}.`;
  return logLine({
    ...state,
    stage,
    line,
    attempts: [...state.attempts, { ...entry, n, failure: null }],
    ...(entry.kind === 'plan' ? { planRequestedAt: entry.at } : {}),
  }, text, entry.at, entry.runId);
}

/**
 * A run's failure is dealt with: it is written on the attempt that sent the
 * run, and the run is marked handled.
 * @param state - The state.
 * @param runId - The failed run.
 * @param failure - What it was.
 */
export function markHandled(state: RecoveryState, runId: number, failure: Failure): RecoveryState {
  const attempts = state.attempts.map(a => (a.runId === runId ? { ...a, failure: { class: failure.class, sentence: failure.sentence } } : a));
  return { ...state, attempts, handledRunIds: [...new Set([...state.handledRunIds, runId])].slice(-HANDLED_MAX) };
}

/**
 * A clause with no closing punctuation, so it can be joined into a sentence
 * without doubling the full stop the worker already wrote.
 * @param text - The clause.
 */
export function bare(text: string): string {
  return text.trim().replace(/[\s.;:,!?]+$/, '');
}

/**
 * The worker's field names said the way a person reads them.
 * @param text - A trigger sentence in the worker's words.
 */
function humanize(text: string): string {
  return text.replace(/\ballowed_paths\b/g, 'the change').replace(/\brisk_class is\b/g, 'the risk class is').replace(/\bcontract refused:\s*\d+ problems?:\s*/i, '').replace(/,? over the \d+ the rule allows without a plan/g, '');
}

/**
 * The first sentence of a passage, capped.
 * @param text
 * @param max
 */
function firstSentence(text: string, max = 220): string {
  const one = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** How a plan-required failure's sentence begins; the rest is the rule's own triggers. */
const PLAN_FIRST = 'the change needs a plan first: ';
const PLAN_REQUIRED = /\b(?:a )?plan is required\b/i;
const NO_CHANGES = /produced no changes|left no changes|no changes in the working tree|outside (?:the task's )?allowed_paths|out of bounds|not (?:in|inside) (?:the )?allowed_paths|is blocked and fails the run/i;
const CHECKS_FAILED = /required checks failed/i;
const LOST = /lease (?:expired|lost)|lost the lease/i;
const TRANSIENT = /claim failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network (?:error|is unreachable)|could not resolve host|\b50\d\b|\b429\b|rate limit|temporarily unavailable|services failed|prepare failed:.*(?:clone|fetch|could not read|unable to access)/i;

/**
 * What kind of failure a failed engineering run had, from its own error and
 * failures — the worker's refusal shapes (`factory/worker/worker.mjs`):
 * a contract refusal names "plan is required"; an empty working tree says
 * "Claude produced no changes"; failed checks say "required checks failed"
 * and carry one `check:<name>` failure each; a lapsed lease is reaped to
 * `lost`; a clone, a claim or a 5xx is the infrastructure, not the work.
 * @param run - The run.
 * @param run.status - `failed` or `lost`.
 * @param run.error - Its error.
 * @param run.failures - Its failures.
 */
export function classifyFailure(run: { status: string; error: string | null; failures?: Array<{ scope?: string | null; message?: string | null }> | null }): Failure {
  const f = classifyRaw(run);
  return { ...f, sentence: bare(humanize(f.sentence)) };
}

function classifyRaw(run: { status: string; error: string | null; failures?: Array<{ scope?: string | null; message?: string | null }> | null }): Failure {
  const failures = (run.failures ?? []).map(f => ({ scope: String(f.scope ?? ''), message: String(f.message ?? '') }));
  const error = String(run.error ?? '');
  const all = [error, ...failures.map(f => f.message)].join('\n');
  const checkFailures = failures.filter(f => f.scope.startsWith('check:'));
  const failedChecks = [...new Set(checkFailures.map(f => f.scope.slice('check:'.length)).filter(Boolean))];
  const planLine = [error, ...failures.map(f => f.message)].find(m => PLAN_REQUIRED.test(m));
  if (planLine) {
    // The triggers sit between "plan is required:" and the worker's "Write the plan" instruction.
    const start = planLine.toLowerCase().indexOf('plan is required:');
    const rest = start >= 0 ? planLine.slice(start + 'plan is required:'.length) : '';
    const end = rest.search(/\.\s+Write the plan/i);
    const why = (end >= 0 ? rest.slice(0, end) : rest).trim();
    return { class: 'plan_required', sentence: why ? `${PLAN_FIRST}${bare(firstSentence(why, 300))}` : 'the change needs a plan first', tail: null, failedChecks: [] };
  }
  if (run.status === 'lost' || LOST.test(error)) {
    return { class: 'lost', sentence: 'the worker stopped reporting and its lease lapsed', tail: null, failedChecks: [] };
  }
  if (NO_CHANGES.test(all)) {
    return { class: 'no_changes', sentence: firstSentence(error.replace(/^verification failed:\s*/i, '') || 'the attempt made no changes inside its allowed paths'), tail: null, failedChecks: [] };
  }
  if (CHECKS_FAILED.test(error) || checkFailures.length > 0) {
    const tail = checkFailures.map(f => `${f.scope.slice('check:'.length)}: ${f.message}`).join('\n').slice(-1500) || null;
    return { class: 'checks_failed', sentence: failedChecks.length > 0 ? `the required checks failed (${failedChecks.join(', ')})` : 'the required checks failed', tail, failedChecks };
  }
  if (TRANSIENT.test(all)) {
    return { class: 'transient', sentence: firstSentence(error || 'the infrastructure failed under the run'), tail: null, failedChecks: [] };
  }
  const contract = failures.find(f => f.scope === 'contract');
  return { class: 'refused_other', sentence: firstSentence(contract?.message || error || 'the run failed without saying why'), tail: null, failedChecks: [] };
}

/**
 * What would unblock a failure of this class, when the factory cannot.
 * @param failure
 */
export function unblockFor(failure: Failure): string {
  switch (failure.class) {
    case 'plan_required':
      return 'approve the plan, or send it back with what it must change';
    case 'no_changes':
      return 'name what the change may touch that the contract left out — a path on the plan\'s components, or the repo record\'s productPaths or generatedFrom — then press Build';
    case 'checks_failed':
      return `read the failing check${failure.failedChecks.length === 1 ? '' : 's'}${failure.failedChecks.length ? ` (${failure.failedChecks.join(', ')})` : ''} on the run and press Build with a note on what to change`;
    case 'lost':
    case 'transient':
      return 'check that the worker is running and can reach the repository, then press Build';
    default:
      return `answer what the run refused on: ${failure.sentence}`;
  }
}

/**
 * What the factory does next about a failure of this class, when it carries
 * the request — the half of the sentence a stopped page owes the reader.
 * @param failure - The failure.
 */
export function nextAfter(failure: Failure): string {
  switch (failure.class) {
    case 'plan_required':
      return 'the factory writes the plan first, and the build starts once it is approved';
    case 'checks_failed':
      return 'the factory sends it again with what the checks reported';
    case 'lost':
    case 'transient':
      return 'the factory runs it once more';
    case 'no_changes':
      return 'the factory sends it again if the contract has changed since, and asks you if it has not';
    default:
      return 'the factory asks you, because it cannot answer this refusal itself';
  }
}

export type RecoveryDecision
  = | { do: 'plan'; why: string }
    | { do: 'dispatch'; why: string; note: string | null }
    | { do: 'escalate'; why: string; unblock: string };

/**
 * What the factory does about a failed run, within the limit.
 *
 * - `plan_required` — plan first (the build dispatches itself once it is approved).
 * - `no_changes` — only if the contract the records now give differs from the
 *   one that failed (paths, checks); the same contract again would fail again.
 * - `checks_failed` — send it again with the failing checks' output in the objective.
 * - `lost` / `transient` — send it again, once.
 * - anything else, or the limit reached — one ask to a person.
 * @param input - The facts.
 * @param input.failure - What the failure was.
 * @param input.attempts - Automatic attempts since the last person action.
 * @param input.limit - The limit; {@link RECOVERY_LIMIT} unless configured.
 * @param input.contractDelta - What changed in the contract since the failed run (`no_changes` only).
 * @param input.lastWasInfraRetry - The failed run was itself the one retry of a lost or transient run.
 */
export function recoveryDecision(input: { failure: Failure; attempts: number; limit?: number; contractDelta?: string[]; lastWasInfraRetry?: boolean }): RecoveryDecision {
  const { failure } = input;
  const limit = input.limit ?? RECOVERY_LIMIT;
  if (input.attempts >= limit) {
    return { do: 'escalate', why: `Stopped after ${input.attempts} attempt${input.attempts === 1 ? '' : 's'}: ${failure.sentence}`, unblock: unblockFor(failure) };
  }
  switch (failure.class) {
    case 'plan_required':
      return { do: 'plan', why: failure.sentence.startsWith(PLAN_FIRST) ? failure.sentence.slice(PLAN_FIRST.length) : failure.sentence };
    case 'no_changes': {
      const delta = input.contractDelta ?? [];
      return delta.length > 0
        ? { do: 'dispatch', why: `the last attempt made no changes, and the contract has changed since (${delta.join('; ')})`, note: null }
        : { do: 'escalate', why: `Stopped: the last attempt made no changes, and the records still give the same contract — ${failure.sentence}`, unblock: unblockFor(failure) };
    }
    case 'checks_failed':
      return {
        do: 'dispatch',
        why: failure.sentence,
        note: `The last attempt failed its required checks${failure.failedChecks.length ? ` (${failure.failedChecks.join(', ')})` : ''}. Make them pass before anything else; this is what they reported:\n${failure.tail ?? '(no output was kept)'}`,
      };
    case 'lost':
    case 'transient':
      return input.lastWasInfraRetry
        ? { do: 'escalate', why: `Stopped: the infrastructure failed twice in a row — ${failure.sentence}`, unblock: unblockFor(failure) }
        : { do: 'dispatch', why: `${failure.sentence}; the work itself did not fail, so it runs once more`, note: null };
    default:
      return { do: 'escalate', why: `Stopped: ${failure.sentence}`, unblock: unblockFor(failure) };
  }
}

/**
 * What changed between the contract a run was sent and the one the records
 * give now: paths added or dropped, checks added or dropped.
 * @param before - The failed run's contract (worker shape).
 * @param before.allowed_paths
 * @param before.required_checks
 * @param after - The contract derived now.
 * @param after.allowed_paths
 * @param after.required_checks
 */
export function contractDelta(before: { allowed_paths?: unknown; required_checks?: unknown }, after: { allowed_paths?: unknown; required_checks?: unknown }): string[] {
  const set = (v: unknown) => new Set(Array.isArray(v) ? v.map(String) : []);
  const out: string[] = [];
  const diff = (label: string, a: Set<string>, b: Set<string>) => {
    const added = [...b].filter(x => !a.has(x));
    const dropped = [...a].filter(x => !b.has(x));
    if (added.length > 0) {
      out.push(`${label} added: ${added.join(', ')}`);
    }
    if (dropped.length > 0) {
      out.push(`${label} dropped: ${dropped.join(', ')}`);
    }
  };
  diff('paths', set(before.allowed_paths), set(after.allowed_paths));
  diff('checks', set(before.required_checks), set(after.required_checks));
  return out;
}

export type IntakeDecision = { do: 'start' | 'card' | 'skip'; why: string };

const CLOSED_STATES = new Set(['deferred', 'answered', 'out_of_scope', 'shipped']);

/**
 * A request was filed: does the factory start it, put the Build card in front
 * of a person, or leave it to triage?
 *
 * Starts it, done for you, when a person asked for a fix in a conversation —
 * the record was filed from their turn — and it is a bug or an incident, or a
 * P1, with its acceptance written. The dispatch runs within the trust bar
 * (`factory.dispatch_task.from_request`) and Undo cancels it until a worker
 * claims it. Anything else with its acceptance written gets the Build card;
 * without acceptance there is nothing to build against yet, and triage owns it.
 * @param input - The facts.
 * @param input.meta - The request's metadata.
 * @param input.origin - Where it was filed.
 * @param input.origin.conversationId
 * @param input.origin.byPerson
 */
export function intakeDecision(input: { meta: Record<string, unknown>; origin: { conversationId: number | null; byPerson: boolean } }): IntakeDecision {
  const m = input.meta;
  const state = str(m.state) ?? 'new';
  if (CLOSED_STATES.has(state) || str(m.recommendationState) === 'rejected') {
    return { do: 'skip', why: `it is ${state.replace(/_/g, ' ')}` };
  }
  if (m.duplicateOf !== undefined && m.duplicateOf !== null && m.duplicateOf !== '') {
    return { do: 'skip', why: 'it is a duplicate' };
  }
  const acceptance = Array.isArray(m.acceptance) ? m.acceptance.filter(Boolean) : [];
  if (acceptance.length === 0) {
    return { do: 'skip', why: 'it has no acceptance criteria yet, so triage owns it' };
  }
  const kind = str(m.kind)?.toLowerCase() ?? null;
  const severity = str(m.severity)?.toLowerCase() ?? null;
  const fix = kind === 'bug' || kind === 'incident' || severity === 'p1';
  if (fix && input.origin.conversationId && input.origin.byPerson) {
    const what = [kind, severity?.toUpperCase()].filter(Boolean).join(', ');
    return { do: 'start', why: `a person asked for this fix in conversation #${input.origin.conversationId} (${what}, ${acceptance.length} acceptance criteri${acceptance.length === 1 ? 'on' : 'a'})` };
  }
  return { do: 'card', why: fix ? 'it was not asked for in a conversation, so a person starts it' : 'it is not a fix a person asked for, so a person decides whether to build it' };
}

export type PlanGate = { go: true } | { go: false; why: string; triggers: PlanTrigger[] };

/**
 * BUILD IS ONE PATH THROUGH THE PLAN GATE. The rule the worker enforces
 * (`factory/worker/plan.mjs`, mirrored in `planRule.ts`), read off the exact
 * contract about to be sent, with the context the worker has — none — so the
 * two agree. A required plan with no approved plan on the contract does not
 * build; it plans. `planFirst` is the worker's own refusal, when a run
 * already said so: it is believed over the rule.
 * @param input - The facts.
 * @param input.contract - The worker's contract (snake_case).
 * @param input.planApproved - An approved plan is on the contract.
 * @param input.planFirst - The worker's refusal sentence, when one was given.
 */
export function planGate(input: { contract: Record<string, unknown>; planApproved: boolean; planFirst?: string | null }): PlanGate {
  if (input.planApproved) {
    return { go: true };
  }
  const c = input.contract;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const environment = (c.environment && typeof c.environment === 'object' ? c.environment : {}) as Record<string, unknown>;
  const decision = planRequirement({
    riskClass: typeof c.risk_class === 'string' ? c.risk_class : null,
    allowedPaths: strings(c.allowed_paths),
    dependencies: strings(c.dependencies),
    repo: typeof c.repo === 'string' ? c.repo : null,
    services: strings(environment.services),
    estimateUsd: typeof c.token_budget_usd === 'number' ? c.token_budget_usd : null,
  });
  if (decision.level === 'required') {
    return { go: false, why: decision.triggers.map(t => t.why).join('; '), triggers: decision.triggers };
  }
  if (input.planFirst) {
    return { go: false, why: input.planFirst, triggers: [{ code: 'recorded', why: input.planFirst }] };
  }
  return { go: true };
}

/** The stage a request's page and row show, when the factory is carrying it. */
export type RecoveryStage = { stage: 'planning' | 'recovering' | 'stopped'; label: string; line: string };

/**
 * The stage off a request's metadata: "Planning", "Recovering (attempt N of
 * 3)", "Stopped after N attempts", each with its sentence — or null.
 * @param meta - The request's metadata.
 */
export function recoveryStage(meta: Record<string, unknown> | null | undefined): RecoveryStage | null {
  const s = readRecovery(meta);
  if (!s.stage) {
    return null;
  }
  const n = s.attempts.length;
  if (s.stage === 'planning') {
    return { stage: 'planning', label: 'Planning', line: s.line ?? 'Planning — a plan is being written before the build.' };
  }
  if (s.stage === 'recovering') {
    return { stage: 'recovering', label: `Recovering (attempt ${Math.max(1, n)} of ${s.limit})`, line: s.line ?? `Recovering (attempt ${Math.max(1, n)} of ${s.limit}).` };
  }
  return { stage: 'stopped', label: `Stopped after ${n} attempt${n === 1 ? '' : 's'}`, line: s.line ?? `Stopped after ${n} attempts; a person decides what happens next.` };
}
