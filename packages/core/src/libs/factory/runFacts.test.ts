import type { RunLike } from './runFacts';
import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  executionOf,
  headlineOf,
  outputOf,
  recoveryLabel,
  runFacts,
  summarizeRuns,
  taskKey,
  verificationOf,
  withRunRecovery,
} from './runFacts';

/**
 * Every fixture here is a real shape read off agents.metacto.com on
 * 2026-09-21, trimmed to the fields the functions read. The point of the
 * split is that these rows STOP contradicting themselves, so the fixtures are
 * the rows that contradicted themselves.
 */

function run(over: Partial<RunLike> & { id: number }): RunLike {
  return {
    status: 'completed',
    attempt: 1,
    cents: 0,
    createdAt: new Date('2026-09-21T12:00:00Z'),
    completedAt: new Date('2026-09-21T12:05:00Z'),
    progress: {},
    result: {},
    input: {},
    counts: {},
    ...over,
  };
}

/** Run 351: the row that says failed, complete, passed and opened at once. */
const completionCallLost = run({
  id: 351,
  status: 'failed',
  cents: 42,
  error: 'worker crashed: The operation was aborted due to timeout',
  summary: 'Task send-0007-invite-inviter-name (ui): changed 3 file(s) inside allowed_paths, 3/3 checks passed, opened https://github.com/Meta-CTO/squatch-core/pull/18 from factory/send-0007',
  progress: { phase: 'complete', model: 'claude-sonnet-5', elapsed_s: 204 },
  result: {
    pr_url: 'https://github.com/Meta-CTO/squatch-core/pull/18',
    files_changed: ['a.ts', 'b.ts', 'c.ts'],
    checks: [
      { name: 'typecheck', status: 'passed' },
      { name: 'test', status: 'passed' },
      { name: 'no-em-dashes', status: 'passed' },
    ],
  },
  input: { task: { task_id: 'send-0007-invite-inviter-name', request_id: 'req-7' }, record: { type: 'engineering_task', id: 82 } },
});

/** Run 344: work done, checks red, branch and draft pull request kept. */
const checksRedWorkKept = run({
  id: 344,
  status: 'failed',
  cents: 11,
  error: 'verification failed: required checks failed: no-em-dashes. Work kept on factory/t-kept-work-smoke-wip-344: https://github.com/Meta-CTO/squatch-core/pull/13',
  progress: {
    phase: 'fail',
    prUrl: 'https://github.com/Meta-CTO/squatch-core/pull/13',
    note: 'verification failed: required checks failed: no-em-dashes. Work kept on factory/t-kept-work-smoke-wip-344: https://github.com/Meta-CTO/squatch-core/pull/13',
  },
  counts: { filesChanged: 1 },
  input: { task: { task_id: 'T-kept-work-smoke' } },
  createdAt: new Date('2026-09-21T10:00:00Z'),
  completedAt: new Date('2026-09-21T10:03:00Z'),
});

/** Run 346: the retry of T-kept-work-smoke that worked, two minutes later. */
const retryThatWorked = run({
  id: 346,
  status: 'completed',
  cents: 5,
  result: {
    pr_url: 'https://github.com/Meta-CTO/squatch-core/pull/14',
    files_changed: ['docs/factory.md'],
    checks: [{ name: 'no-em-dashes', status: 'passed' }],
  },
  progress: { phase: 'complete' },
  input: { task: { task_id: 'T-kept-work-smoke' } },
  createdAt: new Date('2026-09-21T10:04:00Z'),
  completedAt: new Date('2026-09-21T10:05:00Z'),
});

const contractRefused = run({
  id: 342,
  status: 'failed',
  error: 'contract refused: 15 problems: task_id is required; product is required; id is not a contract field (write task_id)',
  progress: { phase: 'fail', note: 'contract refused: 15 problems' },
  input: {},
});

const repositoryMissing = run({
  id: 339,
  status: 'failed',
  error: 'prepare failed: git clone --quiet Meta-CTO/squatch-core /workspace/repo failed (128): fatal: repository \'Meta-CTO/squatch-core\' does not exist',
  progress: { phase: 'fail', elapsed_s: 0 },
});

const postgresMissing = run({
  id: 345,
  status: 'failed',
  error: 'services failed: contract asks for postgres but nothing listens at localhost:55433 after 90s',
  progress: { phase: 'fail', note: 'services failed: contract asks for postgres but nothing listens at localhost:55433 after 90s' },
  input: { task: { task_id: 'T-postgres-sidecar-smoke' } },
  createdAt: new Date('2026-09-21T09:00:00Z'),
});

const producedNoChanges = run({
  id: 347,
  status: 'failed',
  cents: 4,
  error: 'verification failed: Claude produced no changes in the working tree (checks on the base: typecheck=passed, test=passed, no-em-dashes=passed)',
  progress: { phase: 'fail', note: 'verification failed: Claude produced no changes in the working tree' },
  input: { task: { task_id: 'T-postgres-sidecar-smoke' } },
  createdAt: new Date('2026-09-21T09:30:00Z'),
});

const stoppedByVocion = run({
  id: 337,
  status: 'failed',
  error: 'stopped by Vocion before the task finished (cancel, cap or deadline)',
  progress: { phase: 'fail', note: 'stopped by Vocion before the task finished (cancel, cap or deadline)' },
  input: { task: { task_id: 'send-0003-posthog' } },
});

describe('the four concepts one status column was carrying', () => {
  it('reads the contradictory row as four facts that agree', () => {
    const facts = runFacts(completionCallLost);

    // The row said "failed". Everything the worker itself recorded says it
    // finished the work and the checks were green; only the completion call
    // was lost. Four independent answers, none of them contradicting another.
    expect(facts.execution).toBe('completed');
    expect(facts.verification).toBe('passed');
    expect(facts.output).toBe('pull_request');
    expect(facts.outputUrl).toBe('https://github.com/Meta-CTO/squatch-core/pull/18');
    expect(facts.failureClass).toBeNull();
    expect(facts.successful).toBe(true);
  });

  it('says execution completed, verification failed, work preserved on the run that kept its branch', () => {
    const facts = runFacts(checksRedWorkKept);

    expect(facts.execution).toBe('completed');
    expect(facts.verification).toBe('failed');
    expect(facts.output).toBe('work_preserved');
    expect(facts.outputUrl).toBe('https://github.com/Meta-CTO/squatch-core/pull/13');
    expect(facts.successful).toBe(false);
  });

  it('does not call a check that never ran a failed check', () => {
    expect(verificationOf(contractRefused)).toBe('not_run');
    expect(verificationOf(repositoryMissing)).toBe('not_run');
    expect(verificationOf(postgresMissing)).toBe('not_run');
    expect(verificationOf(checksRedWorkKept)).toBe('failed');
    expect(verificationOf(completionCallLost)).toBe('passed');
  });

  it('separates a run that was stopped from a run that broke', () => {
    expect(executionOf(stoppedByVocion)).toBe('cancelled');
    expect(executionOf(contractRefused)).toBe('failed');
    expect(executionOf({ ...completionCallLost, status: 'running', progress: { phase: 'implement' } })).toBe('running');
    expect(executionOf({ ...completionCallLost, status: 'queued', progress: {} })).toBe('queued');
  });

  it('tells no changes produced apart from nothing attempted', () => {
    expect(outputOf(producedNoChanges).output).toBe('no_changes');
    expect(outputOf(contractRefused).output).toBe('none');
    expect(outputOf(retryThatWorked).output).toBe('pull_request');
  });
});

describe('failure classification', () => {
  it('names the cause rather than repeating the word failed', () => {
    expect(classifyFailure(contractRefused)).toBe('contract');
    expect(classifyFailure(repositoryMissing)).toBe('environment');
    expect(classifyFailure(postgresMissing)).toBe('environment');
    expect(classifyFailure(checksRedWorkKept)).toBe('verification');
    expect(classifyFailure(producedNoChanges)).toBe('verification');
    expect(classifyFailure(stoppedByVocion)).toBe('control');
  });

  it('classifies a worker that went quiet without a verdict as a worker fault', () => {
    const quiet = run({ id: 900, status: 'lost', error: 'lease lapsed without a heartbeat', progress: { phase: 'implement' } });

    expect(classifyFailure(quiet)).toBe('worker');
  });

  it('leaves a successful or still running run unclassified', () => {
    expect(classifyFailure(completionCallLost)).toBeNull();
    expect(classifyFailure(retryThatWorked)).toBeNull();
    expect(classifyFailure({ ...postgresMissing, status: 'running', error: null, progress: {} })).toBeNull();
  });
});

describe('recovery', () => {
  it('says the factory retried and was accepted, with how long it took', () => {
    const [kept, ok] = withRunRecovery([checksRedWorkKept, retryThatWorked]);

    expect(kept!.recovery).toMatchObject({ kind: 'retried', attempt: 2, runId: 346, minutesLater: 2, accepted: true });
    expect(recoveryLabel(kept!.recovery)).toBe('retried as attempt 2, accepted 2m later');
    expect(kept!.disposition).toBe('retried');
    expect(ok!.recovery).toEqual({ kind: 'none' });
    expect(ok!.disposition).toBe('accepted');
  });

  it('counts work preserved on a pull request as a partial recovery', () => {
    const [only] = withRunRecovery([checksRedWorkKept]);

    expect(only!.recovery).toEqual({ kind: 'preserved', url: 'https://github.com/Meta-CTO/squatch-core/pull/13' });
    expect(recoveryLabel(only!.recovery)).toBe('work preserved on #13');
  });

  it('says unresolved when the retry failed too', () => {
    const [first, second] = withRunRecovery([postgresMissing, producedNoChanges]);

    expect(first!.recovery).toEqual({ kind: 'unresolved' });
    expect(second!.recovery).toEqual({ kind: 'unresolved' });
    expect(recoveryLabel(second!.recovery)).toBe('unresolved, no successful retry');
    // The task WAS retried even though the retry did not work. Disposition
    // and recovery answer different questions and are allowed to differ.
    expect(first!.disposition).toBe('retried');
    expect(second!.disposition).toBe('rejected');
  });
});

describe('grouping attempts under the task', () => {
  it('groups every attempt of one task under the contract task id', () => {
    const rows = withRunRecovery([checksRedWorkKept, retryThatWorked, completionCallLost]);

    expect(rows.map(r => r.taskKey)).toEqual(['T-kept-work-smoke', 'T-kept-work-smoke', 'send-0007-invite-inviter-name']);
  });

  it('falls back to the record, then to the run itself, so an orphan is its own task', () => {
    expect(taskKey(run({ id: 5, input: { record: { type: 'engineering_task', id: 82 } } }))).toBe('engineering_task:82');
    expect(taskKey(run({ id: 5, input: {} }))).toBe('run-5');
    expect(taskKey(run({ id: 5, input: { task: {} }, result: {} }))).toBe('run-5');
  });
});

describe('the worker self-report, read rather than pasted', () => {
  it('renders the structure the prose was describing', () => {
    expect(headlineOf(completionCallLost)).toBe('3 files changed, 3/3 checks passed, #18');
    expect(headlineOf(retryThatWorked)).toBe('1 file changed, 1/1 checks passed, #14');
    expect(headlineOf(checksRedWorkKept)).toBe('1 file changed, work preserved on #13');
    expect(headlineOf(producedNoChanges)).toBe('no changes produced');
  });

  it('falls back to one clause of the failure, not the whole stack', () => {
    expect(headlineOf(contractRefused)).toBe('contract refused');
    expect(headlineOf(repositoryMissing)).toBe('prepare failed');
  });
});

describe('the summary strip', () => {
  const all = [
    completionCallLost,
    checksRedWorkKept,
    retryThatWorked,
    contractRefused,
    repositoryMissing,
    postgresMissing,
    producedNoChanges,
    stoppedByVocion,
  ];

  it('reports every execution outcome, including the one the old strip left out', () => {
    const s = summarizeRuns(all);

    expect(s.runs).toBe(8);
    expect(s.completed + s.failed + s.cancelled + s.running).toBe(8);
    expect(s.failed).toBe(3);
    expect(s.cancelled).toBe(1);
    expect(s.completed).toBe(4);
  });

  it('reports spend and spend on unsuccessful attempts', () => {
    const s = summarizeRuns(all);

    expect(s.spendCents).toBe(62);
    expect(s.unsuccessfulSpendCents).toBe(15);
  });

  it('reports recovery as a fraction rather than a failure count', () => {
    const s = summarizeRuns(all);

    expect(s.unsuccessful).toBe(6);
    expect(s.recovered).toBe(1);
    expect(s.unresolved).toBe(5);
    expect(s.recovered + s.unresolved).toBe(s.unsuccessful);
  });

  it('breaks the failures down by cause', () => {
    expect(summarizeRuns(all).failureClasses).toEqual({ contract: 1, environment: 2, verification: 2, worker: 0, control: 1 });
  });

  it('counts tasks, not just rows, so five attempts at one rename are one piece of work', () => {
    expect(summarizeRuns(all).tasks).toBe(6);
  });
});
