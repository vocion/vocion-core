/**
 * When a failure is a log line, and when it is a decision.
 *
 * Chris red-teamed Review on 2026-09-21 and found 45 rows of which the large
 * majority were things no person should ever see: a worker timed out, a clone
 * failed, a contract was refused, a check went red, a run produced no changes.
 * Those are OPERATIONAL EVENTS. They belong on the run, inside the work item,
 * which already show them, and putting them in front of a person costs
 * attention and buys nothing, there is no decision to make, because the
 * factory's own next attempt is the answer.
 *
 * A failure earns a person's attention only when the factory CANNOT RECOVER:
 *
 *   - the same task has failed a third time, so retrying is no longer a plan;
 *   - or the failure's class has no retry policy at all, so nothing will be
 *     tried again unless a person changes something.
 *
 * At that point it stops being a failure and becomes an EXCEPTION: a decision
 * object with a recommendation ("restart the db task definition and retry"),
 * what it blocks, and what happens if it is ignored. That is the only shape in
 * which an operational failure reaches Review.
 *
 * Pure: no database, no registry. `InboxService` gathers the failed runs and
 * asks; the tests read this file alone.
 */

import type { DecisionContract } from './decisionContract';

/** Attempts of one task before retrying stops being a plan. */
export const ESCALATE_AFTER_ATTEMPTS = 3;

/**
 * What sort of failure this was. The classes are the ones the factory
 * actually produces; `unknown` is everything else, and is deliberately
 * retryable-with-a-limit rather than escalated on sight, an unrecognised
 * message is not evidence that a retry would not work.
 */
export type FailureClass
  = | 'worker-timeout'
    | 'lease-lost'
    | 'git-clone'
    | 'contract-refused'
    | 'missing-service'
    | 'check-failed'
    | 'no-changes'
    | 'budget-exhausted'
    | 'permission-denied'
    | 'unknown';

/**
 * What the platform knows about a failure class: whether anything will retry
 * it, what it would recommend a person do when nothing will, and the two
 * sentences that make the exception a decision rather than an alarm.
 */
export type FailureClassPolicy = {
  /** How the class reads on a row: "Worker timed out". */
  label: string;
  /**
   * Whether the factory retries this class on its own. `null` means NOTHING
   * will try again, the exception is raised on the first occurrence, because
   * waiting for a third attempt that never comes is waiting forever.
   */
  retry: { /** Attempts the factory makes before this stops being its problem. */ maxAttempts: number } | null;
  /** What the system thinks should be done. Mandatory: a class with no view of its own has no business interrupting anyone. */
  recommendation: string;
  /** The strongest one or two reasons, for the Why on the card. */
  why: string[];
  /** What happens if this waits. */
  impactOfDelay: string;
};

/**
 * The table. One row per class, read by the escalation rule and by the tests.
 *
 * A class is retryable when a second attempt could plausibly succeed without
 * anything changing, a timeout, a lapsed lease, a clone against a flaky
 * remote, an unrecognised error. A class is NOT retryable when the same input
 * will produce the same output forever: a contract the worker refused, a
 * service that is not there, a check that is red on the merits, a run that
 * correctly produced no changes, an exhausted budget, a denied permission.
 * Those are decisions, and they are decisions the first time.
 */
export const FAILURE_CLASSES: Readonly<Record<FailureClass, FailureClassPolicy>> = {
  'worker-timeout': {
    label: 'Worker timed out',
    retry: { maxAttempts: ESCALATE_AFTER_ATTEMPTS },
    recommendation: 'Raise the run\'s lease or split the task, then retry it.',
    why: ['The task has now timed out on every attempt, so the next one will time out too.', 'The work is sized wrong for the lease it was given, and only a person can resize it.'],
    impactOfDelay: 'The task stays undone and nothing else will pick it up.',
  },
  'lease-lost': {
    label: 'Worker stopped reporting',
    retry: { maxAttempts: ESCALATE_AFTER_ATTEMPTS },
    recommendation: 'Restart the worker\'s task definition and retry the run.',
    why: ['Three workers in a row took the lease and stopped heartbeating, which points at the host rather than the task.'],
    impactOfDelay: 'Every task routed to this worker keeps being claimed and dropped.',
  },
  'git-clone': {
    label: 'Could not clone the repository',
    retry: { maxAttempts: ESCALATE_AFTER_ATTEMPTS },
    recommendation: 'Check the deploy key and the repository URL on the workspace, then retry.',
    why: ['Three clones failed, so this is credentials or the URL, not the network.'],
    impactOfDelay: 'No task against this repository can start.',
  },
  'contract-refused': {
    label: 'The worker refused the contract',
    retry: null,
    recommendation: 'Rewrite the task contract, the objective, the paths it may touch, or the checks, and file it again.',
    why: ['The worker read the contract and would not accept it, so the same contract will be refused again.'],
    impactOfDelay: 'The request that asked for this is not being worked on, and nothing says so on the board.',
  },
  'missing-service': {
    label: 'A service it needs is not there',
    retry: null,
    recommendation: 'Stand the service up, or point the workspace at one that is running, then retry.',
    why: ['Nothing retries a dependency that does not exist; the next attempt fails identically.'],
    impactOfDelay: 'Every task that needs this service fails the same way.',
  },
  'check-failed': {
    label: 'A check went red',
    retry: null,
    recommendation: 'Read the failing check and decide: fix the change, or change the check.',
    why: ['A red check is a verdict on the work, not a flake, retrying it re-runs the same verdict.'],
    impactOfDelay: 'The change sits unmerged and the request behind it stays open.',
  },
  'no-changes': {
    label: 'The run produced no changes',
    retry: null,
    recommendation: 'Decide whether the request was already satisfied, close it, or whether the contract was too narrow to do the work.',
    why: ['A run that correctly produced nothing will produce nothing again.'],
    impactOfDelay: 'The request looks in-progress while nothing is happening to it.',
  },
  'budget-exhausted': {
    label: 'The run hit its budget',
    retry: null,
    recommendation: 'Raise the cap for this task, or split it, then retry.',
    why: ['The cap is a person\'s number; nothing raises it on its own.'],
    impactOfDelay: 'The task stops here with the money already spent and no result.',
  },
  'permission-denied': {
    label: 'Permission denied',
    retry: null,
    recommendation: 'Grant the missing permission, or take the step out of the contract.',
    why: ['A denied permission is the same on every attempt.'],
    impactOfDelay: 'The task cannot finish, and any task needing the same grant will fail too.',
  },
  'unknown': {
    label: 'The run failed',
    retry: { maxAttempts: ESCALATE_AFTER_ATTEMPTS },
    recommendation: 'Read the error on the run and decide whether the task, the worker or the contract is wrong.',
    why: ['The same task has failed three times with an error the platform does not recognise, so no retry policy covers it.'],
    impactOfDelay: 'The task stays undone and no automation will pick it up again.',
  },
};

/** Patterns that name a class from what the run recorded. First match wins; order matters. */
const PATTERNS: ReadonlyArray<[RegExp, FailureClass]> = [
  [/\b(?:timed?\s*out|deadline exceeded|exceeded its lease)\b/i, 'worker-timeout'],
  [/\b(?:lease (?:lapsed|expired)|no heartbeat|heartbeat (?:lapsed|missing)|worker (?:vanished|went away))\b/i, 'lease-lost'],
  [/\b(?:git clone|could not clone|clone failed|repository not found|could not read from remote)\b/i, 'git-clone'],
  [/\b(?:contract (?:refused|rejected|invalid)|refused the contract|cannot accept this contract)\b/i, 'contract-refused'],
  [/\b(?:ECONNREFUSED|connection refused|service unavailable|not reachable|no such host|getaddrinfo)\b/i, 'missing-service'],
  [/\bchecks? failed|\btests? failed|\blint failed|\btypecheck failed|\bbuild failed/i, 'check-failed'],
  [/\b(?:no changes(?: produced| to commit)?|nothing to commit|produced no diff)\b/i, 'no-changes'],
  [/\b(?:budget|cap) (?:exhausted|exceeded|reached)\b/i, 'budget-exhausted'],
  [/\b(?:permission denied|forbidden|not authori[sz]ed|403)\b/i, 'permission-denied'],
];

/**
 * Which class a failure belongs to. A `lost` run is a lapsed lease whatever
 * its error says, because that is what `lost` MEANS in the control plane.
 * @param opts
 * @param opts.status - The run's status: `failed` or `lost`.
 * @param opts.error - Whatever the worker recorded, or null.
 */
export function classifyFailure(opts: { status: string; error?: string | null }): FailureClass {
  if (opts.status === 'lost') {
    return 'lease-lost';
  }
  const error = opts.error?.trim();
  if (!error) {
    return 'unknown';
  }
  for (const [pattern, cls] of PATTERNS) {
    if (pattern.test(error)) {
      return cls;
    }
  }
  return 'unknown';
}

/** The columns of a failed run the escalation rule reads. */
export type FailedRun = {
  id: number;
  agentSlug: string;
  status: string;
  error: string | null;
  /** How many times the lease was taken. 0 on a run that failed on its first claim. */
  attempt: number;
  input: Record<string, unknown>;
  at: Date;
};

/**
 * The identity of the TASK behind a run, so three runs of one task are three
 * attempts rather than three failures. The worker's input is worker-defined,
 * so this reads the keys the factory actually sets, `input.task.task_id`
 * first, which is what the harness sends, and falls back to the agent, never
 * to the run id, which would make every run its own task and no third attempt
 * would ever be found.
 * @param run
 */
export function taskKeyOf(run: Pick<FailedRun, 'agentSlug' | 'input'>): string {
  const input = run.input ?? {};
  // The task contract is nested under `task` and is snake_case: that is the
  // shape the external-worker harness actually sends, read off production on
  // 2026-09-21. Reading only the flat camelCase keys made every failed run
  // its own task, and no third attempt would ever have been found.
  const task = (typeof input.task === 'object' && input.task !== null && !Array.isArray(input.task) ? input.task : {}) as Record<string, unknown>;
  for (const key of ['task_id', 'taskId', 'taskKey', 'contract_id', 'contractId', 'engineeringTaskId', 'request_id', 'requestId'] as const) {
    const value = task[key] ?? input[key];
    if (typeof value === 'string' && value.trim()) {
      return `${run.agentSlug}:task:${value.trim()}`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${run.agentSlug}:task:${value}`;
    }
  }
  const mission = input.missionSlug;
  if (typeof mission === 'string' && mission.trim()) {
    return `${run.agentSlug}:mission:${mission.trim()}`;
  }
  const message = input.message;
  if (typeof message === 'string' && message.trim()) {
    return `${run.agentSlug}:message:${message.trim().slice(0, 200).toLowerCase()}`;
  }
  return `${run.agentSlug}:agent`;
}

/** An operational failure the factory cannot recover from, as a decision. */
export type FailureException = {
  /** Stable across attempts, the same unrecovered task is one exception, not one per run. */
  key: string;
  taskKey: string;
  failureClass: FailureClass;
  /** The newest failed run, which is the one a person opens. */
  runId: number;
  agentSlug: string;
  /** How many attempts this task has now cost. */
  attempts: number;
  /** Why it escalated: the retry budget ran out, or there was never a retry policy. */
  trigger: 'attempts-exhausted' | 'no-retry-policy';
  at: Date;
  /** What the run last said, verbatim, the evidence under the recommendation. */
  error: string | null;
  contract: DecisionContract;
};

/**
 * How many attempts one run represents. `attempt` counts re-claims, so a run
 * that failed on its first claim reads 0 and is one attempt.
 * @param run
 */
function attemptsOf(run: FailedRun): number {
  return Math.max(1, run.attempt);
}

/**
 * The exceptions hiding in a set of failed and lost runs, one per task the
 * factory cannot recover, never one per failure.
 *
 * Runs are grouped by task. A group escalates when its class has no retry
 * policy (the first failure is already the decision) or when its attempts
 * have reached the class's limit. Everything else returns nothing: it is a
 * log line, and the run record already has it.
 * @param runs - Failed and lost worker runs, any order.
 */
export function escalationsFrom(runs: FailedRun[]): FailureException[] {
  const groups = new Map<string, FailedRun[]>();
  for (const run of runs) {
    const key = taskKeyOf(run);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const out: FailureException[] = [];
  for (const [taskKey, group] of groups) {
    const newest = group.reduce((m, r) => (r.at > m.at ? r : m));
    const failureClass = classifyFailure(newest);
    const policy = FAILURE_CLASSES[failureClass];
    // Attempts across the whole task: each run carries its own re-claims, and
    // a task re-queued after a failure is a fresh run with attempt 0.
    const attempts = group.reduce((n, r) => n + attemptsOf(r), 0);
    const trigger: FailureException['trigger'] | null = policy.retry === null
      ? 'no-retry-policy'
      : attempts >= policy.retry.maxAttempts ? 'attempts-exhausted' : null;
    if (trigger === null) {
      continue;
    }
    out.push({
      key: `exception:${taskKey}`,
      taskKey,
      failureClass,
      runId: newest.id,
      agentSlug: newest.agentSlug,
      attempts,
      trigger,
      at: newest.at,
      error: newest.error,
      contract: contractFor({ failureClass, attempts, trigger, agentSlug: newest.agentSlug, runId: newest.id }),
    });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * The decision an exception puts in front of a person: what must be decided,
 * what the system thinks, why, what waiting costs, and the labelled choices.
 * Never a bare error message.
 * @param e
 * @param e.failureClass
 * @param e.attempts
 * @param e.trigger
 * @param e.agentSlug
 * @param e.runId
 */
function contractFor(e: { failureClass: FailureClass; attempts: number; trigger: FailureException['trigger']; agentSlug: string; runId: number }): DecisionContract {
  const policy = FAILURE_CLASSES[e.failureClass];
  const why = e.trigger === 'no-retry-policy'
    ? [...policy.why, 'No retry policy covers this class, so nothing will try it again on its own.']
    : [...policy.why, `${e.attempts} attempts, all of them this failure.`];
  return {
    decision: `${policy.label} on ${e.agentSlug} and the factory cannot recover it, decide how to unblock the task.`,
    recommendation: policy.recommendation,
    recommendationWhyNot: null,
    // Two at most: the strongest reasons, not the whole log.
    why: why.slice(0, 2),
    impactOfDelay: policy.impactOfDelay,
    actions: [
      { id: 'retry', label: 'Retry the task', description: 'Queue it again as it stands.' },
      { id: 'fix-and-retry', label: 'Fix, then retry', description: policy.recommendation, recommended: true },
      { id: 'drop', label: 'Stop trying', description: 'Close the task and say so on the request behind it.' },
    ],
  };
}
