import type { FailedRun } from './failureEscalation';
import { describe, expect, it } from 'vitest';
import { classifyFailure, escalationsFrom, taskKeyOf } from './failureEscalation';

const AT = new Date('2026-09-21T10:00:00Z');

function run(over: Partial<FailedRun> = {}): FailedRun {
  return { id: 1, agentSlug: 'task-engineer', status: 'failed', error: 'worker timed out after 300s', attempt: 0, input: { taskId: 'T-1' }, at: AT, ...over };
}

describe('classifyFailure', () => {
  it('reads a lost run as a lapsed lease whatever it recorded', () => {
    expect(classifyFailure({ status: 'lost', error: 'anything at all' })).toBe('lease-lost');
  });

  it('names the classes the factory actually produces', () => {
    expect(classifyFailure({ status: 'failed', error: 'worker timed out after 300s' })).toBe('worker-timeout');
    expect(classifyFailure({ status: 'failed', error: 'git clone failed: repository not found' })).toBe('git-clone');
    expect(classifyFailure({ status: 'failed', error: 'the worker refused the contract: paths are unbounded' })).toBe('contract-refused');
    expect(classifyFailure({ status: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:5432' })).toBe('missing-service');
    expect(classifyFailure({ status: 'failed', error: 'checks failed: 3 tests red' })).toBe('check-failed');
    expect(classifyFailure({ status: 'failed', error: 'no changes produced' })).toBe('no-changes');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyFailure({ status: 'failed', error: 'something nobody wrote a pattern for' })).toBe('unknown');
    expect(classifyFailure({ status: 'failed', error: null })).toBe('unknown');
  });
});

describe('taskKeyOf', () => {
  it('groups by the task, not the run', () => {
    expect(taskKeyOf({ agentSlug: 'a', input: { taskId: 'T-9' } })).toBe(taskKeyOf({ agentSlug: 'a', input: { taskId: 'T-9' } }));
    expect(taskKeyOf({ agentSlug: 'a', input: { taskId: 'T-9' } })).not.toBe(taskKeyOf({ agentSlug: 'a', input: { taskId: 'T-8' } }));
  });

  it('separates two agents doing the same thing', () => {
    expect(taskKeyOf({ agentSlug: 'a', input: { missionSlug: 'm' } })).not.toBe(taskKeyOf({ agentSlug: 'b', input: { missionSlug: 'm' } }));
  });
});

describe('escalationsFrom', () => {
  it('escalates nothing for one retryable failure — a timeout is a log line', () => {
    expect(escalationsFrom([run()])).toEqual([]);
  });

  it('still escalates nothing on a second attempt', () => {
    expect(escalationsFrom([run({ id: 1 }), run({ id: 2 })])).toEqual([]);
  });

  it('escalates the same task failing a third time, with a recommendation', () => {
    const out = escalationsFrom([run({ id: 1 }), run({ id: 2 }), run({ id: 3, at: new Date('2026-09-21T12:00:00Z') })]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ attempts: 3, trigger: 'attempts-exhausted', failureClass: 'worker-timeout', runId: 3 });
    expect(out[0]!.contract.recommendation).toMatch(/lease|split/i);
    expect(out[0]!.contract.impactOfDelay).not.toBe('');
    expect(out[0]!.contract.actions.map(a => a.id)).toContain('fix-and-retry');
  });

  it('counts re-claims of one run as attempts', () => {
    expect(escalationsFrom([run({ attempt: 3 })])).toHaveLength(1);
  });

  it('escalates a failure class with no retry policy on its first occurrence', () => {
    const out = escalationsFrom([run({ error: 'the worker refused the contract: the objective is not testable' })]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ trigger: 'no-retry-policy', failureClass: 'contract-refused' });
    expect(out[0]!.contract.recommendation).toMatch(/rewrite the task contract/i);
  });

  it('never raises a bare error message — every exception is a decision', () => {
    const out = escalationsFrom([run({ error: 'no changes produced' })]);

    expect(out[0]!.contract.decision).toMatch(/decide/i);
    expect(out[0]!.contract.why.length).toBeGreaterThan(0);
    expect(out[0]!.contract.why.length).toBeLessThanOrEqual(2);
    expect(out[0]!.contract.actions.length).toBeGreaterThanOrEqual(2);
  });

  it('is one exception per unrecovered task, not one per failure', () => {
    const out = escalationsFrom([
      run({ id: 1, error: 'checks failed' }),
      run({ id: 2, error: 'checks failed' }),
      run({ id: 3, error: 'checks failed' }),
    ]);

    expect(out).toHaveLength(1);
  });

  it('keeps two different tasks apart', () => {
    const out = escalationsFrom([
      run({ id: 1, input: { taskId: 'A' }, error: 'checks failed' }),
      run({ id: 2, input: { taskId: 'B' }, error: 'checks failed' }),
    ]);

    expect(out).toHaveLength(2);
  });
});
