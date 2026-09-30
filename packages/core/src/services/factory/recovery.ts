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
export type FailureClass = 'plan_required' | 'environment' | 'no_changes' | 'checks_failed' | 'lost' | 'transient' | 'no_plan' | 'stale_plan' | 'refused_other';

export type Failure = {
  class: FailureClass;
  /** One sentence a person reads: what went wrong. */
  sentence: string;
  /** The failing checks' own output, trimmed, when checks failed. */
  tail: string | null;
  /** The names of the checks that failed. */
  failedChecks: string[];
  /**
   * `stale_plan` only: the paths the plan names that the repository no longer
   * has, and the closest ones it does (`apps/send-api/**` → `apps/stamp-api/**`),
   * plus what the worker or the engineer said — the brief a new plan starts from.
   */
  stale?: { kind: 'paths_missing' | 'out_of_bounds' | 'derived'; missing: string[]; suggest: string[]; reason: string; detail: string | null };
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
  // What a person reads counts this stage's attempts against this stage's
  // budget, the same count `stopIfAtLimit` stops on (#246 read "attempt 4 of 3").
  const ofStage = attemptsOf(state, entry.kind) + 1;
  const stage = entry.kind === 'plan' ? 'planning' : entry.trigger === 'recovery' || entry.trigger === 'retry' ? 'recovering' : null;
  const why = bare(entry.line);
  const plain = why.replace(/^Recovered:\s*/, '');
  const line = stage === 'planning'
    ? `Planning — ${why}`
    : stage === 'recovering' ? `Recovering (attempt ${ofStage} of ${state.limit}): ${plain}` : null;
  const text = entry.kind === 'plan'
    ? `${entry.trigger === 'recovery' ? 'Recovered: planning first because' : 'Planning first:'} ${why}.`
    : stage === 'recovering' ? `Recovered: ${plain} (attempt ${ofStage} of ${state.limit}).` : `Attempt ${ofStage} of ${state.limit} started: ${why}.`;
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
/**
 * The worker's own environment failing before any work starts: its service
 * sidecars, the install, the schema sync (#124, 2026-09-28: "services failed:
 * prisma:sync failed", twice in forty seconds, from a worker image older than
 * the repository). Another attempt on the same worker fails the same way.
 */
const ENVIRONMENT = /\b(?:services failed|postinstall failed|npm ci failed|prisma:sync failed|prisma migrate deploy failed)\b/i;
const LOST = /lease (?:expired|lost)|lost the lease/i;
const TRANSIENT = /claim failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network (?:error|is unreachable)|could not resolve host|\b50\d\b|\b429\b|rate limit|temporarily unavailable|prepare failed:.*(?:clone|fetch|could not read|unable to access)/i;

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
 * @param run.result - Its result, where the worker puts a typed `failure` ({@link typedStale}).
 */
export function classifyFailure(run: { status: string; error: string | null; failures?: Array<{ scope?: string | null; message?: string | null }> | null; result?: Record<string, unknown> | null }): Failure {
  const f = classifyRaw(run);
  return { ...f, sentence: bare(humanize(f.sentence)) };
}

/** The worker's typed failure kinds that mean the plan no longer fits the repository. */
const STALE_KINDS = new Set(['paths_missing', 'out_of_bounds']);

/**
 * THE WORKER SAYS WHAT KIND OF FAILURE IT WAS (squatch-core #119). Run 411
 * (#130, 2026-09-29) was sent plan #136's paths — `apps/send-api/...`, from
 * before the rename to `apps/stamp-*` — and Claude stopped in 28s: "the plan
 * can't be built inside the allowed paths". The worker now refuses that run
 * itself (`paths_missing`, with the directories that do exist) or reports
 * Claude's own words (`out_of_bounds`), on `result.failure`; the failure
 * entries carry the same kind as their scope. Read the kind, never the words.
 * @param run - The run.
 * @param run.result - Its result, where the worker puts `failure`.
 * @param run.failures - Its failures, whose scope may name the kind.
 */
export function typedStale(run: { result?: Record<string, unknown> | null; failures?: Array<{ scope?: string | null; message?: string | null }> | null }): Failure['stale'] | null {
  const raw = run.result?.failure;
  const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  if (f && typeof f.kind === 'string' && STALE_KINDS.has(f.kind)) {
    return {
      kind: f.kind as 'paths_missing' | 'out_of_bounds',
      missing: strings(f.missing),
      suggest: strings(f.suggest),
      reason: typeof f.reason === 'string' ? f.reason : '',
      detail: typeof f.detail === 'string' ? f.detail : null,
    };
  }
  const entry = (run.failures ?? []).find(e => STALE_KINDS.has(String(e.scope ?? '')));
  return entry ? { kind: String(entry.scope) as 'paths_missing' | 'out_of_bounds', missing: [], suggest: [], reason: String(entry.message ?? ''), detail: null } : null;
}

/**
 * The sentence a stale plan's failure reads as.
 * @param stale - What made it stale.
 */
function staleSentence(stale: NonNullable<Failure['stale']>): string {
  const reason = bare(firstSentence(stale.reason || 'the plan names paths the repository does not have', 300));
  return stale.kind === 'out_of_bounds'
    ? `the plan no longer fits the repository: the engineer stopped because the work cannot be built inside its paths (${reason})`
    : `the plan no longer fits the repository: ${reason}`;
}

/**
 * A stale plan as a failure, for a stop the records explain on their own
 * (the plan names app or package directories the repo record no longer has).
 * @param stale - What made it stale.
 */
export function staleFailure(stale: NonNullable<Failure['stale']>): Failure {
  return { class: 'stale_plan', sentence: bare(staleSentence(stale)), tail: null, failedChecks: [], stale };
}

function classifyRaw(run: { status: string; error: string | null; failures?: Array<{ scope?: string | null; message?: string | null }> | null; result?: Record<string, unknown> | null }): Failure {
  const stale = typedStale(run);
  if (stale) {
    return staleFailure(stale);
  }
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
  if (failures.some(f => f.scope === 'services') || ENVIRONMENT.test(error)) {
    return { class: 'environment', sentence: firstSentence(error || failures.find(f => f.scope === 'services')?.message || 'the worker\'s environment failed'), tail: null, failedChecks: [] };
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
    case 'environment':
      return 'rebuild the worker (or fix the repository\'s environment) so it can set up, then press Build';
    case 'no_plan':
      return 'write the plan, or say the work does not need one, then press Build';
    case 'stale_plan':
      return `approve a plan written against the repository as it is now${failure.stale?.suggest.length ? ` (it names ${failure.stale.suggest.slice(0, 4).join(', ')})` : ''}, then press Build`;
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
    case 'environment':
      return 'the factory asks you, because the worker\'s environment fails before any work starts';
    case 'no_plan':
      return 'the factory asks for the plan again';
    case 'stale_plan':
      return 'the factory plans again against the repository as it is, and the new plan replaces the old one';
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
    | { do: 'replan'; why: string; brief: string }
    | { do: 'dispatch'; why: string; note: string | null }
    | { do: 'escalate'; why: string; unblock: string };

/**
 * What the factory does about a failed run, within the limit.
 *
 * - `plan_required` — plan first (the build dispatches itself once it is approved).
 * - `stale_plan` — the plan names paths the repository no longer has, or the
 *   engineer said the work cannot be built inside them: plan again, with the
 *   reason and the suggested paths in the brief; the new plan supersedes it.
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
 * @param input.environmentDelta - What changed in the worker or the repo's environment since the failed run (`environment` only).
 * @param input.planWhy - Why the plan was needed, when a planning step ended without one (`no_plan`).
 * @param input.stalePlan - The plan the failed run was sent is stale by the records ({@link stalePlanRoots}): a `no_changes` failure is read as `stale_plan`.
 */
export function recoveryDecision(input: { failure: Failure; attempts: number; limit?: number; contractDelta?: string[]; lastWasInfraRetry?: boolean; environmentDelta?: string[]; planWhy?: string; stalePlan?: NonNullable<Failure['stale']> | null }): RecoveryDecision {
  // "No changes" against a plan the records already show is stale (an older
  // worker, which says only "no changes") is the stale plan, not the engineer.
  const failure = input.failure.class === 'no_changes' && input.stalePlan ? staleFailure(input.stalePlan) : input.failure;
  const limit = input.limit ?? RECOVERY_LIMIT;
  // THE WORKER'S ENVIRONMENT IS NOT AN ATTEMPT (#124, 2026-09-28). A worker
  // that cannot set itself up fails the same way on every try, so nothing is
  // spent on it: it runs again only when the worker or the repo's
  // environment has changed since, and otherwise a person is asked at once.
  if (failure.class === 'environment' && (input.environmentDelta ?? []).length === 0) {
    return { do: 'escalate', why: `Stopped: the worker's environment is failing before any work starts: ${failure.sentence}; it needs a person or a worker rebuild`, unblock: unblockFor(failure) };
  }
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
    case 'environment':
      return { do: 'dispatch', why: `the worker's environment changed since (${(input.environmentDelta ?? []).join('; ')})`, note: null };
    case 'no_plan':
      return { do: 'plan', why: input.planWhy ?? failure.sentence };
    // A STALE PLAN IS PLANNED AGAIN, never sent again as it is (the same
    // paths fail the same way) and never read as "no changes" (a person would
    // be asked to name paths the tree already names).
    case 'stale_plan':
      return { do: 'replan', why: failure.sentence, brief: replanBrief(failure) };
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

/**
 * What changed in the worker or the repo's environment between a failed run
 * and now: a different worker version, or a different `environment` block on
 * the contract the records give. An unknown version is never a change.
 * @param before - The failed run.
 * @param before.workerVersion - The version that claimed it.
 * @param before.environment - The environment its contract carried.
 * @param after - Now.
 * @param after.workerVersion - The newest version a worker has reported since.
 * @param after.environment - The environment the records give now.
 */
export function environmentDelta(before: { workerVersion: string | null; environment: unknown }, after: { workerVersion: string | null; environment: unknown }): string[] {
  const out: string[] = [];
  if (after.workerVersion && after.workerVersion !== before.workerVersion) {
    out.push(`worker ${before.workerVersion ?? 'of unknown version'} → ${after.workerVersion}`);
  }
  if (JSON.stringify(before.environment ?? null) !== JSON.stringify(after.environment ?? null)) {
    out.push('the repository\'s environment on the contract');
  }
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
  // A RED DEFAULT BRANCH IS FIXED WITHOUT A CARD (backlog 049). The factory
  // filed it on GitHub's own evidence (`ciFailed.ts`), listing the pull
  // requests it blocks; every one of them waits on it, so a tap in front of
  // the build only lengthens the wait. The build still goes through QA and the
  // merge's own trust rule, and Undo cancels it until a worker claims it.
  const pipelineFix = m.pipelineFix && typeof m.pipelineFix === 'object' && !Array.isArray(m.pipelineFix) ? m.pipelineFix as Record<string, unknown> : null;
  if (fix && pipelineFix && str(pipelineFix.repo)) {
    const blocks = Array.isArray(pipelineFix.blocks) ? pipelineFix.blocks.length : 0;
    return { do: 'start', why: `${str(pipelineFix.branch) ?? 'the default branch'} of ${str(pipelineFix.repo)} is red, and ${blocks} pull request${blocks === 1 ? ' waits' : 's wait'} on it` };
  }
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
    // The refusal the factory carries (a stale plan's brief, the worker's own
    // "plan is required") is what the planner reads; the rule's triggers stay
    // on the gate.
    return { go: false, why: input.planFirst || decision.triggers.map(t => t.why).join('; '), triggers: decision.triggers };
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
    const built = Math.max(1, attemptsOf(s, 'build'));
    return { stage: 'recovering', label: `Recovering (attempt ${built} of ${s.limit})`, line: s.line ?? `Recovering (attempt ${built} of ${s.limit}).` };
  }
  return { stage: 'stopped', label: `Stopped after ${n} attempt${n === 1 ? '' : 's'}`, line: s.line ?? `Stopped after ${n} attempts; a person decides what happens next.` };
}

/** Failures that are the machine's, not the work's: a new worker is what answers them. */
export const INFRASTRUCTURE_FAILURES: ReadonlySet<FailureClass> = new Set<FailureClass>(['transient', 'lost', 'environment']);

/** One option on a stop's ask, in the ask's own shape. */
export type StopOption = { id: 'approve' | 'reject'; label: string; description: string; recommended?: boolean };

/**
 * THE STOP'S APPROVE SAYS WHAT IT DOES (Chris, 2026-09-28, ask #220: approved
 * "go ahead as proposed" on "Stopped: Open alerts — the infrastructure failed
 * twice… press Build" without knowing what it would do). Approve builds
 * again (`answerRecoveryAsk`), and the words say so — on an infrastructure
 * stop, on which worker, and that the ask resolves itself when the worker is
 * rebuilt first.
 * @param requestId - The request.
 * @param failure - What stopped it, when a run failed.
 */
export function stopOptions(requestId: number, failure: Pick<Failure, 'class' | 'sentence'> | null): StopOption[] {
  const infra = failure !== null && INFRASTRUCTURE_FAILURES.has(failure.class);
  return [
    infra
      ? {
          id: 'approve',
          label: 'Build again on the current worker image',
          description: `Starts a new build of request #${requestId} on whichever worker image is deployed when you approve. It stopped on the infrastructure (${bare(failure.sentence)}), so approve once the worker is fixed; when the worker is rebuilt first, this ask resolves itself and the build starts.`,
        }
      : {
          id: 'approve',
          label: 'Build again',
          description: `Starts a new build of request #${requestId}; a note you write here goes to the engineer as what to change.`,
        },
    { id: 'reject', label: 'Leave it stopped', description: `Nothing runs; request #${requestId} stays stopped until someone presses Build.` },
  ];
}

/** A worker the workspace knows of: an environment record for one, or a version a run reported. */
export type WorkerSighting = { version: string; at: string; source: 'environment' | 'run' };

/**
 * Was the worker rebuilt after the stop? An environment record for a worker
 * (`surface: worker`, updated by the deploy's record-environment step) deployed
 * after the stop, or a run that reported a worker version other than the one
 * that failed, claimed after it. The newest wins; null when neither.
 * @param opts - What is known.
 * @param opts.stoppedAt - When the stop was filed.
 * @param opts.failedVersion - The worker version the failed run reported, if any.
 * @param opts.environments - Worker environment records: slug, last deploy, sha.
 * @param opts.reported - Versions runs reported, with when the run was claimed.
 */
export function workerRebuiltSince(opts: {
  stoppedAt: Date;
  failedVersion: string | null;
  environments: Array<{ slug: string; lastDeployedAt: string | null; lastDeployedSha: string | null }>;
  reported: Array<{ version: string; at: Date }>;
}): WorkerSighting | null {
  const after = opts.stoppedAt.getTime();
  const seen: WorkerSighting[] = [];
  for (const e of opts.environments) {
    const t = e.lastDeployedAt ? Date.parse(e.lastDeployedAt) : Number.NaN;
    if (Number.isFinite(t) && t > after) {
      seen.push({ version: `${e.slug}${e.lastDeployedSha ? ` ${e.lastDeployedSha.slice(0, 8)}` : ''}`, at: new Date(t).toISOString(), source: 'environment' });
    }
  }
  for (const r of opts.reported) {
    if (r.at.getTime() > after && r.version && r.version !== opts.failedVersion) {
      seen.push({ version: r.version, at: r.at.toISOString(), source: 'run' });
    }
  }
  return seen.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

/** The app or package a path lives in: `apps/send-api/prisma/x` → `apps/send-api`. */
const ROOT = /^((?:apps|packages|services)\/[\w.-]+)(?:\/|$)/;

/**
 * Name tokens, last first: `stamp-api` → ['api', 'stamp'].
 * @param name - A directory name.
 */
const nameTokens = (name: string): string[] => name.toLowerCase().split(/[-_.]+/).filter(Boolean).reverse();

/**
 * The closest existing sibling of a directory that is gone, by suffix
 * (`send-api` → `stamp-api` among stamp-api, stamp-web, stamp-marketing);
 * a tie is broken on the leading tokens, and left unsuggested rather than guessed.
 * The same rule as the worker's preflight (squatch-core `factory/worker/preflight.mjs`).
 * @param name - The missing directory's name.
 * @param siblings - The names that exist beside it.
 */
export function closestSibling(name: string, siblings: string[]): string | null {
  const want = nameTokens(name);
  let best: string | null = null;
  let score: [number, number] = [0, 0];
  let tie = false;
  for (const s of siblings) {
    if (s === name) {
      continue;
    }
    const have = nameTokens(s);
    let suffix = 0;
    while (suffix < want.length && suffix < have.length && want[suffix] === have[suffix]) {
      suffix++;
    }
    if (suffix === 0) {
      continue;
    }
    const a = [...want].reverse();
    const b = [...have].reverse();
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
      prefix++;
    }
    if (suffix > score[0] || (suffix === score[0] && prefix > score[1])) {
      best = s;
      score = [suffix, prefix];
      tie = false;
    } else if (suffix === score[0] && prefix === score[1]) {
      tie = true;
    }
  }
  return tie ? null : best;
}

/**
 * IS THE PLAN STALE BY THE RECORDS? A plan's components name the apps and
 * packages it changes (`apps/send-api/prisma/schema/core.prisma — …`). When
 * the repo record's riskDefaults and productPaths — what the repository is
 * now — list app or package roots and none of them is one the plan names, the
 * plan was written before a rename (#130's plan #136, 2026-09-25, against
 * `apps/stamp-*` from 2026-09-28). Only `apps/`, `packages/` and `services/`
 * roots are judged, and only when the repo record lists some.
 * @param components - The plan's components.
 * @param repo - The repo record's metadata.
 * @param repo.riskDefaults
 * @param repo.productPaths
 * @returns The missing roots and their closest successors, or null when the plan fits.
 */
export function stalePlanRoots(components: string[], repo: { riskDefaults?: unknown; productPaths?: unknown } | null): NonNullable<Failure['stale']> | null {
  if (!repo) {
    return null;
  }
  const globs = [
    ...Object.keys(repo.riskDefaults && typeof repo.riskDefaults === 'object' ? repo.riskDefaults as Record<string, unknown> : {}),
    ...Object.values(repo.productPaths && typeof repo.productPaths === 'object' ? repo.productPaths as Record<string, unknown> : {}).flatMap(v => (Array.isArray(v) ? v.map(String) : [])),
  ];
  const known = new Set(globs.map(g => ROOT.exec(g)?.[1]).filter((x): x is string => Boolean(x)));
  if (known.size === 0) {
    return null;
  }
  const heads = components.map(c => c.split(/\s+[\u2014-]\s+|\s\(/)[0]?.trim() ?? '');
  const missing = [...new Set(heads.map(h => ROOT.exec(h)?.[1]).filter((x): x is string => Boolean(x) && !known.has(x!)))];
  if (missing.length === 0) {
    return null;
  }
  const pairs = missing.map((root) => {
    const [parent, name] = root.split('/') as [string, string];
    const sibling = closestSibling(name, [...known].filter(k => k.startsWith(`${parent}/`)).map(k => k.slice(parent.length + 1)));
    return { root, now: sibling ? `${parent}/${sibling}` : null };
  });
  const named = pairs.map(p => (p.now ? `${p.root} (now ${p.now})` : p.root));
  return { kind: 'derived', missing, suggest: pairs.flatMap(p => (p.now ? [p.now] : [])), reason: `it names ${named.join(', ')}, which the repository no longer has`, detail: null };
}

/**
 * The planner's brief for a stale plan: why the last one failed, which paths
 * are gone and which exist, and that the new plan replaces it. Fits the
 * dispatch's `planFirst` (1000 characters).
 * @param failure - The stale-plan failure.
 */
export function replanBrief(failure: Failure): string {
  const st = failure.stale;
  const parts = [
    `the approved plan no longer fits the repository, so it is planned again and the new plan replaces it: ${bare(failure.sentence.replace(/^the plan no longer fits the repository:\s*/, ''))}`,
    st && st.missing.length > 0 ? `Paths the repository does not have: ${st.missing.slice(0, 6).join(', ')}` : null,
    st && st.suggest.length > 0 ? `Name these instead: ${st.suggest.slice(0, 6).join(', ')}` : null,
    st?.detail ? `The engineer said: ${bare(st.detail.replace(/\s+/g, ' ').slice(0, 400))}` : null,
    'Read the repository as it is now; name every package the change touches, its tests and any migrations directory',
  ].filter((p): p is string => Boolean(p));
  const text = `${parts.map(bare).join('. ')}.`;
  return text.length > 1000 ? `${text.slice(0, 998).trimEnd()}…` : text;
}

/**
 * Automatic attempts of ONE stage since a person last acted. Planning and
 * building each get the whole limit: #246 (2026-09-29) spent two of its three
 * on planning runs the platform's own checks refused, and its first build,
 * which QA sent back with one gap, was stopped before its retry.
 * @param state - The recovery state.
 * @param kind - The stage: plan or build.
 */
export function attemptsOf(state: Pick<RecoveryState, 'attempts'>, kind: RecoveryEntry['kind']): number {
  return state.attempts.filter(a => a.kind === kind).length;
}
