/**
 * What a worker run actually says, split into the facts it is actually made
 * of.
 *
 * `worker_run.status` is one text column, and the factory has been asking it
 * to carry four independent facts at once. The result is rows that read
 * "status failed, progress complete, checks passed, pull request opened",
 * which is not a display bug: it is one field answering four questions and
 * getting three of them wrong. A person reading that row cannot tell whether
 * the work happened, whether it was any good, whether anything was kept, or
 * whether the factory went back and fixed it.
 *
 * So a run is read here as four independent concepts:
 *
 * - **Execution**: did the worker reach a verdict on the work it was given?
 *   `completed` | `failed` | `cancelled` (plus `running` and `queued` while
 *   it is still alive). A worker that ran the whole task and then had its
 *   completion call time out executed completely; the timeout is a reporting
 *   fault, not a work fault.
 * - **Verification**: did the required checks pass? `passed` | `failed` |
 *   `not_run`. A run that never got as far as running a check did not fail
 *   verification, it never verified.
 * - **Output**: what exists now because of the run? `pull_request` |
 *   `work_preserved` (a WIP branch and draft pull request kept off a failed
 *   verification) | `no_changes` | `none`.
 * - **Disposition**: what became of the TASK, across every attempt.
 *   `accepted` | `rejected` | `retried` | `open`. This one is a property of
 *   the group, not of the row, so it is computed by {@link withRunRecovery}.
 *
 * Nothing here needs a migration. Every fact is derived from columns the
 * table already has (`status`, `error`, `progress`, `result`, `input`,
 * `attempt`, `stop_requested`), which is what makes this a reading of the
 * existing record rather than a rewrite of it. A migration would freeze
 * today's inference into the row and make the next worker's vocabulary a
 * schema change; a derivation stays correctable.
 *
 * Pure and DB-free on purpose: the page renderer, the feature report and the
 * tests all read the same functions.
 */

export type RunExecution = 'completed' | 'failed' | 'cancelled' | 'running' | 'queued';
export type RunVerification = 'passed' | 'failed' | 'not_run';
export type RunOutput = 'pull_request' | 'work_preserved' | 'no_changes' | 'none';
export type RunDisposition = 'accepted' | 'rejected' | 'retried' | 'open';

/**
 * Why an unsuccessful run was unsuccessful. Every red row on Activity used to
 * say "failed" while the causes were a refused contract, a missing
 * repository, a missing Postgres, a failed typecheck, a failed test, no
 * changes produced, a stop from Vocion, and a deadline or a spend cap. Those
 * are five different problems with five different owners:
 *
 * - `contract`: the task was refused before any work started. The contract is
 *   wrong, so the lead that wrote it owns it.
 * - `environment`: the machine could not be made ready (clone failed, a
 *   service the contract asked for never came up). Infrastructure owns it.
 * - `verification`: the worker did the work and the checks said no. The
 *   change owns it, and a retry is the normal answer.
 * - `worker`: the worker itself broke or went quiet mid task.
 * - `control`: Vocion stopped it on purpose, or a deadline or spend cap ran
 *   out. Nothing is broken; a person or a policy decided.
 */
export type FailureClass = 'contract' | 'environment' | 'verification' | 'worker' | 'control';

/** How, if at all, the factory recovered from an unsuccessful run. */
export type RunRecovery
  = { kind: 'retried'; attempt: number; runId: number | string; minutesLater: number | null; accepted: boolean }
    | { kind: 'preserved'; url: string | null }
    | { kind: 'unresolved' }
    | { kind: 'none' };

/** The subset of a worker_run row these functions read. */
export type RunLike = {
  id: number | string;
  status: string;
  attempt?: number | null;
  error?: string | null;
  summary?: string | null;
  cents?: number | null;
  stopRequested?: boolean | null;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
  progress?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  input?: Record<string, unknown> | null;
  counts?: Record<string, number> | null;
};

export type RunFacts = {
  execution: RunExecution;
  verification: RunVerification;
  output: RunOutput;
  /** The pull request or preserved branch the output points at. */
  outputUrl: string | null;
  /** Null on a run that was not unsuccessful. */
  failureClass: FailureClass | null;
  /** True when the run ended with the work done and the checks green. */
  successful: boolean;
  /** The run's evidence as a sentence, from the structure rather than the prose. */
  headline: string;
  checksPassed: number;
  checksTotal: number;
  filesChanged: number | null;
};

function text(...parts: Array<unknown>): string {
  return parts.filter(p => typeof p === 'string').join(' ').toLowerCase();
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * The task a run belongs to. Five attempts at one rename are five rows and
 * one piece of work, and the page groups on this so the work is the unit and
 * the attempts read underneath it.
 *
 * In order of how much the key is worth: the contract's own `task_id`, then
 * the record the run was queued for, then the run's own id, which groups a
 * run with nothing to group it with under itself rather than piling every
 * orphan into one bucket.
 * @param run - The run.
 */
export function taskKey(run: RunLike): string {
  const task = obj(obj(run.input).task);
  const fromContract = str(task.task_id) ?? (typeof task.task_id === 'number' ? String(task.task_id) : null);
  if (fromContract) {
    return fromContract;
  }
  const record = obj(obj(run.input).record);
  if (record.type !== undefined && record.id !== undefined) {
    return `${String(record.type)}:${String(record.id)}`;
  }
  return `run-${String(run.id)}`;
}

/**
 * The engineering task record a run was queued for, when it names one.
 * @param run
 */
export function taskRecordId(run: RunLike): string | null {
  const record = obj(obj(run.input).record);
  return record.id === undefined || record.id === null ? null : String(record.id);
}

/**
 * The request the run's contract serves, for the link back to the outcome.
 * @param run
 */
export function requestId(run: RunLike): string | null {
  return str(obj(obj(run.input).task).request_id);
}

function checkTally(run: RunLike): { passed: number; total: number } {
  const checks = obj(run.result).checks;
  if (Array.isArray(checks) && checks.length > 0) {
    const passed = checks.filter(c => obj(c).status === 'passed').length;
    return { passed, total: checks.length };
  }
  // A worker whose completion call never landed still described its checks in
  // its own summary line ("3/3 checks passed"), so the tally survives the
  // call that was lost.
  const fromSummary = /(\d+)\/(\d+) checks passed/.exec(run.summary ?? '');
  if (fromSummary) {
    return { passed: Number(fromSummary[1]), total: Number(fromSummary[2]) };
  }
  return { passed: 0, total: 0 };
}

function wasStopped(run: RunLike): boolean {
  const said = text(run.error, obj(run.progress).note);
  return run.stopRequested === true
    || said.includes('stopped by vocion')
    || said.includes('cancel, cap or deadline');
}

/**
 * Did the worker reach a verdict on the work it was given?
 *
 * The distinction that matters: a worker that ran the task, ran the checks
 * and reported "verification failed: required checks failed: typecheck"
 * EXECUTED COMPLETELY. Its verdict was negative, which is what
 * {@link verificationOf} is for. A worker that was refused before it started,
 * or could not clone the repository, did not execute at all.
 * @param run - The run.
 */
export function executionOf(run: RunLike): RunExecution {
  if (run.status === 'queued') {
    return 'queued';
  }
  if (run.status === 'running' || run.status === 'paused' || run.status === 'awaiting_review') {
    return 'running';
  }
  if (run.status === 'cancelled' || wasStopped(run)) {
    return 'cancelled';
  }
  if (run.status === 'completed') {
    return 'completed';
  }
  const phase = str(obj(run.progress).phase);
  if (phase === 'complete') {
    return 'completed';
  }
  // A `fail` phase whose note is a verdict on the WORK is a completed
  // execution with a negative verdict. A `fail` phase whose note is about the
  // contract, the machine or the worker is an execution that never happened.
  if (phase === 'fail' && verificationOf(run) === 'failed') {
    return 'completed';
  }
  return 'failed';
}

/**
 * Did the required checks pass? `not_run` is a real answer and not a polite
 * way of saying failed: a contract refused before a container started never
 * reached a check, and reporting that as a failed verification blames the
 * change for something the change never got to do.
 * @param run - The run.
 */
export function verificationOf(run: RunLike): RunVerification {
  const said = text(run.error, obj(run.progress).note);
  if (said.includes('verification failed') || said.includes('required checks failed')) {
    return 'failed';
  }
  const { passed, total } = checkTally(run);
  if (total > 0) {
    return passed === total ? 'passed' : 'failed';
  }
  return 'not_run';
}

/**
 * What exists now because of the run. A failed verification that kept the
 * branch and opened a draft pull request produced something a person can
 * pick up, and a run that produced no diff at all produced nothing; calling
 * both of them "failed" throws away the only difference that matters when
 * deciding what to do next.
 * @param run - The run.
 */
export function outputOf(run: RunLike): { output: RunOutput; url: string | null } {
  const merged = str(obj(run.result).pr_url);
  if (merged) {
    return { output: 'pull_request', url: merged };
  }
  const kept = str(obj(run.progress).prUrl);
  const said = `${run.error ?? ''} ${str(obj(run.progress).note) ?? ''}`;
  const keptInProse = /work kept on \S+: (\S+)/i.exec(said);
  if (kept || keptInProse) {
    return { output: 'work_preserved', url: kept ?? keptInProse![1] ?? null };
  }
  if (said.toLowerCase().includes('no changes in the working tree')) {
    return { output: 'no_changes', url: null };
  }
  return { output: 'none', url: null };
}

/**
 * Why an unsuccessful run was unsuccessful, or null when it was not. The
 * order is the order of the pipeline: a contract is refused before a machine
 * is prepared, which happens before checks run, so the earliest thing that
 * went wrong is the thing to report.
 * @param run - The run.
 */
export function classifyFailure(run: RunLike): FailureClass | null {
  const execution = executionOf(run);
  const verification = verificationOf(run);
  if (execution === 'running' || execution === 'queued') {
    return null;
  }
  if (execution === 'completed' && verification !== 'failed') {
    return null;
  }
  const said = text(run.error, obj(run.progress).note);
  if (execution === 'cancelled') {
    return 'control';
  }
  if (said.includes('contract refused') || said.includes('is not a contract field')) {
    return 'contract';
  }
  if (said.includes('prepare failed') || said.includes('services failed') || said.includes('does not exist') || said.includes('nothing listens')) {
    return 'environment';
  }
  if (verification === 'failed') {
    return 'verification';
  }
  if (said.includes('deadline') || said.includes('cap')) {
    return 'control';
  }
  return 'worker';
}

/**
 * The worker's self-report, read rather than pasted. The prose the worker
 * sends is good evidence and terrible primary copy:
 *
 * > Task send-0011-qa-probe (ui): changed 1 file(s) inside allowed_paths, 2/2
 * > checks passed, opened https://github.com/...
 *
 * Vocion already holds every one of those facts as structure, so the row
 * says "1 file changed, 2/2 checks passed, #27" and the worker's own
 * paragraph stays inside the run, where an investigator can read it whole.
 * @param run - The run.
 */
export function headlineOf(run: RunLike): string {
  const parts: string[] = [];
  const files = obj(run.result).files_changed;
  const count = Array.isArray(files)
    ? files.length
    : typeof run.counts?.filesChanged === 'number' ? run.counts.filesChanged : null;
  if (count !== null) {
    parts.push(`${count} file${count === 1 ? '' : 's'} changed`);
  }
  const { passed, total } = checkTally(run);
  if (total > 0) {
    parts.push(`${passed}/${total} checks passed`);
  }
  const { output, url } = outputOf(run);
  if (output === 'pull_request' && url) {
    parts.push(prLabel(url));
  }
  if (output === 'work_preserved') {
    parts.push(url ? `work preserved on ${prLabel(url)}` : 'work preserved');
  }
  if (output === 'no_changes') {
    parts.push('no changes produced');
  }
  if (parts.length > 0) {
    return parts.join(', ');
  }
  // Nothing structured to read: say what stopped it, in one clause, rather
  // than the whole stack of prose.
  const said = str(run.error) ?? str(obj(run.progress).note);
  return said ? said.split(/[.:]\s|\n/)[0]!.trim() : 'no report';
}

/**
 * A pull request URL as `#27`, or its last segment when it is not one.
 * @param url
 */
function prLabel(url: string): string {
  const numbered = /\/(?:pull|merge_requests)\/(\d+)/.exec(url);
  return numbered ? `#${numbered[1]}` : url.split('/').filter(Boolean).at(-1) ?? url;
}

/**
 * Every fact a row needs, read off one run.
 * @param run
 */
export function runFacts(run: RunLike): RunFacts {
  const execution = executionOf(run);
  const verification = verificationOf(run);
  const { output, url } = outputOf(run);
  const { passed, total } = checkTally(run);
  const files = obj(run.result).files_changed;
  return {
    execution,
    verification,
    output,
    outputUrl: url,
    failureClass: classifyFailure(run),
    successful: execution === 'completed' && verification === 'passed',
    headline: headlineOf(run),
    checksPassed: passed,
    checksTotal: total,
    filesChanged: Array.isArray(files)
      ? files.length
      : typeof run.counts?.filesChanged === 'number' ? run.counts.filesChanged : null,
  };
}

function at(v: Date | string | null | undefined): number | null {
  if (!v) {
    return null;
  }
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** The run it was handed, with the facts read off it. */
export type RunWithFacts<T extends RunLike = RunLike> = T & {
  facts: RunFacts;
  taskKey: string;
  recovery: RunRecovery;
  disposition: RunDisposition;
};

/**
 * Every run, with the two facts that only exist across a group: whether the
 * factory recovered, and what became of the task.
 *
 * "Failed" on its own is the weakest thing Activity can say about a run,
 * because on a factory that retries, most failures are already fixed by the
 * time anyone reads them. "Retried as attempt 5 and accepted 43 minutes
 * later" is the answer to the question the reader actually has.
 *
 * Recovery is read forward in time within the run's own task: the first
 * LATER attempt that succeeded. Failing that, work preserved on a pull
 * request is a partial recovery, because a person can pick it up. Failing
 * both, the run is unresolved, and unresolved is the number worth putting on
 * the page.
 * @param runs - The runs in view, in any order.
 */
export function withRunRecovery<T extends RunLike>(runs: T[]): Array<RunWithFacts<T>> {
  const decorated = runs.map(r => ({ run: r, facts: runFacts(r), key: taskKey(r) }));
  const byTask = new Map<string, typeof decorated>();
  for (const d of decorated) {
    byTask.set(d.key, [...(byTask.get(d.key) ?? []), d]);
  }
  // Within a task, order by when the run started; ties fall back to the id,
  // which is monotonic for the same org.
  for (const [, group] of byTask) {
    group.sort((a, b) => (at(a.run.createdAt) ?? 0) - (at(b.run.createdAt) ?? 0) || Number(a.run.id) - Number(b.run.id));
  }

  return decorated.map(({ run, facts, key }) => {
    const group = byTask.get(key)!;
    const i = group.findIndex(g => g.run.id === run.id);
    const later = group.slice(i + 1);
    const laterSuccess = later.find(g => g.facts.successful);
    const alive = facts.execution === 'running' || facts.execution === 'queued';

    let recovery: RunRecovery;
    if (facts.successful || alive) {
      recovery = { kind: 'none' };
    } else if (laterSuccess) {
      const from = at(run.completedAt) ?? at(run.createdAt);
      const to = at(laterSuccess.run.completedAt) ?? at(laterSuccess.run.createdAt);
      recovery = {
        kind: 'retried',
        // Which attempt AT THIS TASK it was, not the run row's own `attempt`,
        // which counts re-claims of one run and is 1 on every row here.
        attempt: group.indexOf(laterSuccess) + 1,
        runId: laterSuccess.run.id,
        minutesLater: from !== null && to !== null ? Math.max(0, Math.round((to - from) / 60_000)) : null,
        accepted: true,
      };
    } else if (facts.output === 'work_preserved') {
      recovery = { kind: 'preserved', url: facts.outputUrl };
    } else {
      recovery = { kind: 'unresolved' };
    }

    const anySuccess = group.some(g => g.facts.successful);
    const isLast = i === group.length - 1;
    const disposition: RunDisposition = alive
      ? 'open'
      : facts.successful
        ? 'accepted'
        : later.length > 0
          ? 'retried'
          : anySuccess || !isLast ? 'retried' : 'rejected';

    return { ...run, facts, taskKey: key, recovery, disposition };
  });
}

/**
 * Recovery as the one line a row shows.
 * @param recovery
 */
export function recoveryLabel(recovery: RunRecovery): string | null {
  switch (recovery.kind) {
    case 'none':
      return null;
    case 'retried':
      return recovery.minutesLater === null
        ? `retried as attempt ${recovery.attempt} and accepted`
        : `retried as attempt ${recovery.attempt}, accepted ${recovery.minutesLater}m later`;
    case 'preserved':
      return recovery.url ? `work preserved on ${prLabel(recovery.url)}` : 'work preserved';
    default:
      return 'unresolved, no successful retry';
  }
}

export type RunSummary = {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  lost: number;
  verificationPassed: number;
  verificationFailed: number;
  spendCents: number;
  /** Spend on runs that did not end with the work done and the checks green. */
  unsuccessfulSpendCents: number;
  unsuccessful: number;
  recovered: number;
  unresolved: number;
  failureClasses: Record<FailureClass, number>;
  tasks: number;
};

/**
 * The figures the summary strip reports. The old strip said 20 runs, 7
 * completed, 0 lost, 0 running and never said how many did not work, which
 * was the dominant condition on the screen. Everything here is a count of one
 * concept at a time, so no figure contradicts the one beside it.
 * @param runs - The runs in view.
 */
export function summarizeRuns(runs: RunLike[]): RunSummary {
  const decorated = withRunRecovery(runs);
  const classes: Record<FailureClass, number> = { contract: 0, environment: 0, verification: 0, worker: 0, control: 0 };
  const summary: RunSummary = {
    runs: decorated.length,
    completed: 0,
    failed: 0,
    cancelled: 0,
    running: 0,
    lost: runs.filter(r => r.status === 'lost').length,
    verificationPassed: 0,
    verificationFailed: 0,
    spendCents: 0,
    unsuccessfulSpendCents: 0,
    unsuccessful: 0,
    recovered: 0,
    unresolved: 0,
    failureClasses: classes,
    tasks: new Set(decorated.map(d => d.taskKey)).size,
  };
  for (const d of decorated) {
    const cents = d.cents ?? 0;
    summary.spendCents += cents;
    if (d.facts.execution === 'completed') {
      summary.completed += 1;
    }
    if (d.facts.execution === 'failed') {
      summary.failed += 1;
    }
    if (d.facts.execution === 'cancelled') {
      summary.cancelled += 1;
    }
    if (d.facts.execution === 'running' || d.facts.execution === 'queued') {
      summary.running += 1;
    }
    if (d.facts.verification === 'passed') {
      summary.verificationPassed += 1;
    }
    if (d.facts.verification === 'failed') {
      summary.verificationFailed += 1;
    }
    if (d.facts.failureClass) {
      classes[d.facts.failureClass] += 1;
    }
    if (!d.facts.successful && d.facts.execution !== 'running' && d.facts.execution !== 'queued') {
      summary.unsuccessful += 1;
      summary.unsuccessfulSpendCents += cents;
      if (d.recovery.kind === 'retried' || d.recovery.kind === 'preserved') {
        summary.recovered += 1;
      } else {
        summary.unresolved += 1;
      }
    }
  }
  return summary;
}
