/**
 * WHAT THE RECORDS SAY ABOUT A PIECE OF WORK, AS SEPARATE TYPED FACTS
 * (backlog 044).
 *
 * Conversation 392 (2026-09-30): the product manager said "#248 already
 * shipped clean, green and merged" when QA had sent it back (5 of 6 proven)
 * and its pull request was unmerged. A later "Stuck?" on #269 was answered
 * from the task's `awaiting_review` while CI had failed and no QA run existed.
 * Both were one word — a run's `completed`, a task's stage — asked to carry
 * four facts it does not hold: what QA judged, whether the change merged,
 * what CI said, and where the request stands. A line in the prompt ("do not
 * call a run shipped") is the lever that failed, so the tools now hand the
 * agent each fact on its own field, typed, with the sentence it reads as.
 *
 * Pure and client-safe: the feature report assembles these from the records
 * it already read (`services/factory/featureReport.ts`), `list_recent_runs`
 * assembles them per run from a batched read, and `read_object` returns the
 * report's copy beside the record's live status — one derivation, so the page,
 * the API and the agent say the same thing (parity rule).
 *
 * Nothing here names an object type, an automation or a tool; the values it
 * reads are the verdict `record_verdict` writes, the pull request a task
 * carries, and GitHub's own events.
 */

import { prLabel } from './liveStatus';

/** What GitHub and the merge action have recorded about one pull request. */
export type PullSignals = {
  /** A done merge for it — a person's press or its trust rule — or GitHub's `pr.merged`. */
  merged: { at: string | null } | null;
  /** GitHub's `pr.closed` without a merge. */
  closed: { at: string | null } | null;
  /** The newest `pr.checks_completed` for it. */
  checks: { conclusion: string | null; failedChecks: string | null; headSha: string | null; at: string | null } | null;
};

/**
 * A pull request URL as the records keep it: no trailing slash or tab.
 * @param url - The URL as written.
 */
export function normalisePullUrl(url: string): string {
  return url.trim().replace(/\/(files|commits|checks)\/?$/, '').replace(/\/$/, '');
}

/** No signal at all — nothing is recorded, which is never read as a "no". */
export const NO_PULL_SIGNALS: PullSignals = { merged: null, closed: null, checks: null };

export type VerdictValue = 'approve' | 'changes' | 'reject';

/** QA's verdict on one attempt, exactly as `record_verdict` wrote it. */
export type VerdictFact = {
  /** Null when QA has not judged this attempt. */
  value: VerdictValue | null;
  proven: number | null;
  total: number | null;
  /** The commit it was read at. */
  commit: string | null;
  at: string | null;
  /** "QA approved it: 6 of 6 proven", "QA sent it back: 5 of 6 proven", "QA has not judged it yet". */
  line: string;
};

/** Whether the change merged — only what a record says, never inferred from a green run. */
export type PullMerge = 'merged' | 'closed' | 'not_merged' | 'no_pull_request';

export type PullFact = {
  url: string | null;
  /** "PR #128". */
  label: string | null;
  merge: PullMerge;
  mergedAt: string | null;
  line: string;
};

/** CI on the attempt's own commit. `not_reported` is an answer, not a pass. */
export type CiState = 'passed' | 'failed' | 'not_reported';

export type CiFact = {
  state: CiState;
  /** The failing checks, as GitHub named them. */
  failedChecks: string | null;
  /** The commit the report is for. */
  commit: string | null;
  at: string | null;
  line: string;
};

/** Whether a merge of this change runs on its own once QA approves it. */
export type MergeRuleFact = {
  /** True: the trust rule merges it; false: a person approves the merge card; null: not established. */
  runsItself: boolean | null;
  riskClass: string | null;
  line: string;
};

/** Where the request stands, derived from every record, in the words a person uses. */
export type RequestStage
  = | 'not_started'
    | 'planning'
    | 'building'
    | 'awaiting_qa'
    | 'changes_asked'
    | 'ready_to_merge'
    | 'merged'
    | 'shipped'
    | 'stopped'
    | 'waiting_on_a_person'
    | 'closed';

export type RequestFact = {
  id: number;
  stage: RequestStage;
  /** The record's own state field, as written (`building`, `shipped` …), or null. */
  recordState: string | null;
  line: string;
};

/** Every fact about one feature's current attempt, each on its own field. */
export type WorkFacts = {
  request: RequestFact;
  /** The attempt these facts are about — the newest task, when there is one. */
  taskId: number | null;
  verdict: VerdictFact;
  pullRequest: PullFact;
  ci: CiFact;
  mergeRule: MergeRuleFact;
  /** True only when a release records it live. Merged is not shipped. */
  shipped: boolean;
  /** What happens next, from these facts. */
  next: string;
};

type Meta = Record<string, unknown>;

const obj = (v: unknown): Meta => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const VERDICTS: ReadonlySet<string> = new Set<VerdictValue>(['approve', 'changes', 'reject']);

/**
 * Two commit ids name the same commit when one is a prefix of the other.
 * @param a - A sha, full or short.
 * @param b - Another.
 */
function sameCommit(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y.slice(0, 7)) || y.startsWith(x.slice(0, 7));
}

/**
 * QA's verdict on an attempt, read off the task.
 * @param task - The attempt's task: its stage and metadata. Null when the work has no task.
 * @param task.status - The task's stage (`awaiting_review`, `review_failed` …).
 * @param task.meta - Its metadata, where `verdict` lives.
 */
export function verdictFact(task: { status: string | null; meta: Meta } | null): VerdictFact {
  const v = obj(task?.meta.verdict);
  const value = typeof v.value === 'string' && VERDICTS.has(v.value) ? v.value as VerdictValue : null;
  const proven = num(v.proven);
  const total = num(v.total);
  const count = proven !== null && total !== null ? `${proven} of ${total} proven` : null;
  const base = { value, proven, total, commit: str(v.commitSha), at: str(v.at) };
  if (value === 'approve') {
    return { ...base, line: `QA approved it${count ? `: ${count}` : ''}` };
  }
  if (value === 'changes') {
    return { ...base, line: v.heldBy === 'person' ? `A person held the merge and sent it back${count ? ` (${count})` : ''}` : `QA sent it back${count ? `: ${count}` : ''}` };
  }
  if (value === 'reject') {
    return { ...base, line: `QA rejected it${count ? `: ${count}` : ''}` };
  }
  if (!task) {
    return { ...base, line: 'No task on record, so no QA verdict' };
  }
  const stage = task.status ?? '';
  if (stage === 'review_failed') {
    return { ...base, line: 'QA ended without a verdict' };
  }
  const ci = obj(task.meta.ciFailure);
  if (stage === 'changes_requested' && str(ci.at)) {
    return { ...base, line: 'QA has not judged it: CI failed and sent it back to the engineer first' };
  }
  return { ...base, line: 'QA has not judged it yet' };
}

/**
 * Whether the change merged, from the records alone.
 * @param url - The pull request, or null.
 * @param signals - What GitHub and the merge action recorded.
 * @param mergedByRecords - A release or a done merge elsewhere in the records lists it.
 */
export function pullFact(url: string | null, signals: PullSignals, mergedByRecords = false): PullFact {
  if (!url) {
    return { url: null, label: null, merge: 'no_pull_request', mergedAt: null, line: 'No pull request on record' };
  }
  const label = prLabel(url) ?? url;
  if (signals.merged || mergedByRecords) {
    const at = signals.merged?.at ?? null;
    return { url, label, merge: 'merged', mergedAt: at, line: `${label} merged${at ? ` ${at}` : ''}` };
  }
  if (signals.closed) {
    return { url, label, merge: 'closed', mergedAt: null, line: `${label} closed without merging` };
  }
  return { url, label, merge: 'not_merged', mergedAt: null, line: `${label} is not merged (nothing records a merge)` };
}

/**
 * CI on the attempt's own commit: GitHub's newest report when it is for this
 * commit, else the failure the factory recorded on the task, else not reported.
 * @param signals - What GitHub recorded.
 * @param task - The attempt: its commit and any recorded CI failure.
 * @param task.commit - The attempt's head commit, when the task names one.
 * @param task.ciFailure - The task's `ciFailure`, when the factory recorded one.
 * @param label - "PR #128", for the line.
 */
export function ciFact(signals: PullSignals, task: { commit: string | null; ciFailure: Meta | null }, label: string | null): CiFact {
  const on = label ? ` on ${label}` : '';
  const checks = signals.checks;
  const forThisCommit = checks && (!task.commit || !checks.headSha || sameCommit(checks.headSha, task.commit));
  if (checks && forThisCommit) {
    const passed = checks.conclusion === 'success';
    return {
      state: passed ? 'passed' : 'failed',
      failedChecks: passed ? null : checks.failedChecks,
      commit: checks.headSha,
      at: checks.at,
      line: passed ? `CI passed${on}` : `CI failed${on}${checks.failedChecks ? ` (${checks.failedChecks})` : ''}`,
    };
  }
  const failure = task.ciFailure;
  if (failure && str(failure.at)) {
    const names = str(failure.checks);
    return { state: 'failed', failedChecks: names, commit: task.commit, at: str(failure.at), line: `CI failed${on}${names ? ` (${names})` : ''}` };
  }
  if (checks) {
    return { state: 'not_reported', failedChecks: null, commit: task.commit, at: null, line: `CI has not reported on this attempt's commit${on} (the last report was for ${checks.headSha?.slice(0, 7) ?? 'another commit'})` };
  }
  return { state: 'not_reported', failedChecks: null, commit: task.commit, at: null, line: label ? `CI has not reported${on}` : 'No pull request, so no CI' };
}

/**
 * The merge rule for this change, as a fact.
 * @param runsItself - What the trust ladder says a merge of this class does; null when it could not be read.
 * @param riskClass - The class the merge would carry.
 */
export function mergeRuleFact(runsItself: boolean | null, riskClass: string | null): MergeRuleFact {
  const cls = riskClass ? ` (${riskClass})` : '';
  if (runsItself === true) {
    return { runsItself, riskClass, line: `This merge${cls} runs itself on its trust rule once QA approves; no card, nobody presses merge` };
  }
  if (runsItself === false) {
    return { runsItself, riskClass, line: `A person approves this merge${cls}: once QA approves, the merge card lands on Review, and anyone in the workspace can approve it` };
  }
  return { runsItself, riskClass, line: 'Whether this merge runs itself is not established' };
}

/**
 * What happens next for one attempt, from its facts — never from its run's
 * status alone.
 * @param f - The attempt's facts.
 * @param f.verdict - QA's verdict.
 * @param f.pullRequest - The merge state.
 * @param f.ci - CI.
 * @param f.mergeRule - Whether the merge runs itself.
 * @param f.shipped - A release records it live.
 * @param f.taskStage - The task's stage.
 * @param f.superseded - A newer attempt exists for the same work.
 */
export function nextForAttempt(f: { verdict: VerdictFact; pullRequest: PullFact; ci: CiFact; mergeRule: MergeRuleFact; shipped: boolean; taskStage: string | null; superseded?: boolean }): string {
  if (f.shipped) {
    return 'Nothing: a release records it live';
  }
  if (f.pullRequest.merge === 'merged') {
    return 'Merged; the release is recorded once it is live';
  }
  if (f.superseded) {
    return 'A newer attempt replaced this one; read that attempt';
  }
  if (f.pullRequest.merge === 'closed') {
    return 'Its pull request was closed; nothing from it merges';
  }
  if (f.verdict.value === 'approve') {
    return f.mergeRule.runsItself === true
      ? 'It merges on its own on its trust rule'
      : f.mergeRule.runsItself === false ? 'The merge card waits on Review for a person to approve' : 'The merge is next';
  }
  if (f.verdict.value === 'changes') {
    return 'The next attempt builds with what QA found';
  }
  if (f.verdict.value === 'reject') {
    return 'Nothing: QA rejected it';
  }
  if (f.pullRequest.merge === 'no_pull_request') {
    return f.taskStage === 'running' || f.taskStage === 'dispatched' ? 'The engineer is still building it' : 'No pull request, so nothing for QA or a merge';
  }
  if (f.ci.state === 'failed') {
    return 'CI failed, so QA does not start; the factory sends it back to the engineer with what failed';
  }
  if (f.ci.state === 'not_reported') {
    return 'Waiting for CI; QA starts when it is green';
  }
  if (f.taskStage === 'review_failed') {
    return 'QA ended without a verdict; the factory starts the review again';
  }
  return 'QA reviews it';
}

/**
 * The request's stage from the feature report's state (the page's own read)
 * and the delivery facts.
 * @param stateKey - `ReportState.key`.
 * @param opts - The delivery facts.
 * @param opts.merged - Its pull request is recorded merged.
 * @param opts.shipped - A release records it live.
 * @param opts.closed - The record is closed without a build.
 * @param opts.decidingMerge - The open decision is the merge card.
 */
export function requestStageOf(stateKey: string, opts: { merged: boolean; shipped: boolean; closed: boolean; decidingMerge: boolean }): RequestStage {
  if (opts.shipped) {
    return 'shipped';
  }
  if (opts.merged) {
    return 'merged';
  }
  switch (stateKey) {
    case 'released':
      return 'merged';
    case 'merge':
      return 'ready_to_merge';
    case 'qa':
      return 'awaiting_qa';
    case 'changes':
      return 'changes_asked';
    case 'building':
    case 'recovering':
      return 'building';
    case 'planning':
      return 'planning';
    case 'stuck':
      return 'stopped';
    case 'approve':
      return opts.decidingMerge ? 'ready_to_merge' : 'waiting_on_a_person';
    case 'decide':
    case 'blocked':
      return 'waiting_on_a_person';
    default:
      return opts.closed ? 'closed' : 'not_started';
  }
}

/** How each stage reads. */
export const REQUEST_STAGE_LINE: Record<RequestStage, string> = {
  not_started: 'Not started',
  planning: 'Planning',
  building: 'Building',
  awaiting_qa: 'Awaiting QA',
  changes_asked: 'Changes asked',
  ready_to_merge: 'QA approved, not merged yet',
  merged: 'Merged, not yet recorded live',
  shipped: 'Shipped (a release records it live)',
  stopped: 'Stopped',
  waiting_on_a_person: 'Waiting on a person',
  closed: 'Closed without a build',
};
