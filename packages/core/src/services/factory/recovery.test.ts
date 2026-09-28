import { describe, expect, it } from 'vitest';
import { classifyFailure, contractDelta, intakeDecision, markHandled, noteAttempt, personActed, planGate, readRecovery, RECOVERY_LIMIT, recoveryDecision, recoveryStage } from './recovery';

// Every name, path and number below is invented. The failure texts are the
// worker's own refusal shapes (factory/worker/worker.mjs), not a live run's.

const AT = '2026-09-28T12:00:00.000Z';

describe('what kind of failure a run had', () => {
  it('reads the worker refusing a contract that needed a plan', () => {
    const f = classifyFailure({
      status: 'failed',
      error: 'contract refused. The contract must match factory/contracts/schema.json … and carry an approved plan when the plan rule requires one (factory/worker/plan.mjs). Nothing was cloned and no model was called.',
      failures: [{ scope: 'contract', message: 'plan is required: allowed_paths spans 2 packages (apps/web, packages/core), over the 1 the rule allows without a plan. Write the plan, have it approved in Review, and put plan.plan_id (or plan.url) and plan.approved_by on the contract. A required plan cannot be skipped.' }],
    });

    expect(f.class).toBe('plan_required');
    expect(f.sentence).toBe('the change needs a plan first: the change spans 2 packages (apps/web, packages/core)');
  });

  it('reads an attempt that made no changes', () => {
    const f = classifyFailure({ status: 'failed', error: 'verification failed: Claude produced no changes in the working tree (checks on the base: typecheck=passed)', failures: [] });

    expect(f.class).toBe('no_changes');
    expect(f.sentence).toBe('Claude produced no changes in the working tree (checks on the base: typecheck=passed)');
  });

  it('reads failed checks with each check\'s own output', () => {
    const f = classifyFailure({ status: 'failed', error: 'verification failed: required checks failed: lint, test', failures: [{ scope: 'check:lint', message: 'src/a.ts:3 no-unused-vars' }, { scope: 'check:test', message: '1 failed: renders the dialog' }] });

    expect(f).toMatchObject({ class: 'checks_failed', sentence: 'the required checks failed (lint, test)', failedChecks: ['lint', 'test'] });
    expect(f.tail).toBe('lint: src/a.ts:3 no-unused-vars\ntest: 1 failed: renders the dialog');
  });

  it('reads a lapsed lease and the infrastructure as not the work', () => {
    expect(classifyFailure({ status: 'lost', error: 'lease expired without a heartbeat' }).class).toBe('lost');
    expect(classifyFailure({ status: 'failed', error: 'prepare failed: git clone failed (128): Could not resolve host: github.example' }).class).toBe('transient');
    expect(classifyFailure({ status: 'failed', error: 'claim failed: 503 {"error":"unavailable"}' }).class).toBe('transient');
  });

  it('calls anything else a refusal, in its own words', () => {
    expect(classifyFailure({ status: 'failed', error: 'bad task input: objective is missing' })).toMatchObject({ class: 'refused_other', sentence: 'bad task input: objective is missing' });
  });
});

describe('what the factory does about it', () => {
  const failure = (cls: Parameters<typeof classifyFailure>[0]) => classifyFailure(cls);

  it('plans first when a plan was required', () => {
    const d = recoveryDecision({ failure: failure({ status: 'failed', error: 'plan is required: the risk class is schema. Write the plan, have it approved.' }), attempts: 0 });

    expect(d).toEqual({ do: 'plan', why: 'the risk class is schema' });
    expect(classifyFailure({ status: 'failed', error: 'contract refused: 1 problem: plan is required: allowed_paths spans 2 packages (apps/a, packages/b), over the 1 the rule allows without a plan.. ' }).sentence).toBe('the change needs a plan first: the change spans 2 packages (apps/a, packages/b)');
  });

  it('sends failed checks again with their output in the objective', () => {
    const d = recoveryDecision({ failure: failure({ status: 'failed', error: 'verification failed: required checks failed: test', failures: [{ scope: 'check:test', message: 'expected 2 to be 3' }] }), attempts: 1 });

    expect(d.do).toBe('dispatch');
    expect(d.do === 'dispatch' && d.note).toContain('test: expected 2 to be 3');
  });

  it('sends a no-changes attempt again only when the contract changed', () => {
    const noChanges = failure({ status: 'failed', error: 'verification failed: Claude produced no changes in the working tree' });

    expect(recoveryDecision({ failure: noChanges, attempts: 1, contractDelta: ['paths added: packages/db/migrations/**'] })).toMatchObject({ do: 'dispatch', why: expect.stringContaining('paths added: packages/db/migrations/**') });
    expect(recoveryDecision({ failure: noChanges, attempts: 1, contractDelta: [] })).toMatchObject({ do: 'escalate', why: expect.stringContaining('the records still give the same contract'), unblock: expect.stringContaining('productPaths or generatedFrom') });
  });

  it('retries the infrastructure once, then asks', () => {
    const lost = failure({ status: 'lost', error: 'lease expired without a heartbeat' });

    expect(recoveryDecision({ failure: lost, attempts: 0 }).do).toBe('dispatch');
    expect(recoveryDecision({ failure: lost, attempts: 1, lastWasInfraRetry: true })).toMatchObject({ do: 'escalate', why: expect.stringContaining('twice in a row') });
  });

  it('stops at the limit whatever the failure, naming what would unblock it', () => {
    const d = recoveryDecision({ failure: failure({ status: 'failed', error: 'verification failed: required checks failed: lint', failures: [{ scope: 'check:lint', message: 'x' }] }), attempts: RECOVERY_LIMIT });

    expect(d).toMatchObject({ do: 'escalate', why: 'Stopped after 3 attempts: the required checks failed (lint)', unblock: expect.stringContaining('lint') });
  });

  it('asks about a refusal it cannot answer', () => {
    expect(recoveryDecision({ failure: failure({ status: 'failed', error: 'bad task input: repo is missing' }), attempts: 0 })).toMatchObject({ do: 'escalate' });
  });
});

describe('what changed in the contract', () => {
  it('names paths and checks added or dropped', () => {
    expect(contractDelta({ allowed_paths: ['apps/api/**'], required_checks: ['test'] }, { allowed_paths: ['apps/api/**', 'packages/db/migrations/**'], required_checks: ['test'] })).toEqual(['paths added: packages/db/migrations/**']);
    expect(contractDelta({ allowed_paths: ['a/b/**'], required_checks: ['test', 'lint'] }, { allowed_paths: ['a/b/**'], required_checks: ['test'] })).toEqual(['checks dropped: lint']);
    expect(contractDelta({ allowed_paths: ['a/b/**'] }, { allowed_paths: ['a/b/**'] })).toEqual([]);
  });
});

describe('a request that was just filed', () => {
  const bug = { kind: 'bug', severity: 'p1', state: 'new', acceptance: ['A member can open the room they were invited to.'] };

  it('starts the fix a person asked for in a conversation', () => {
    expect(intakeDecision({ meta: bug, origin: { conversationId: 12, byPerson: true } })).toMatchObject({ do: 'start', why: expect.stringContaining('conversation #12') });
    expect(intakeDecision({ meta: { ...bug, kind: 'incident', severity: 'p2' }, origin: { conversationId: 12, byPerson: true } }).do).toBe('start');
    expect(intakeDecision({ meta: { ...bug, kind: 'gap', severity: 'p1' }, origin: { conversationId: 12, byPerson: true } }).do).toBe('start');
  });

  it('cards anything else that is ready to build', () => {
    expect(intakeDecision({ meta: bug, origin: { conversationId: null, byPerson: true } }).do).toBe('card');
    expect(intakeDecision({ meta: bug, origin: { conversationId: 12, byPerson: false } }).do).toBe('card');
    expect(intakeDecision({ meta: { ...bug, kind: 'idea', severity: undefined }, origin: { conversationId: 12, byPerson: true } }).do).toBe('card');
  });

  it('leaves to triage what has no acceptance, and never touches a closed or duplicate one', () => {
    expect(intakeDecision({ meta: { ...bug, acceptance: [] }, origin: { conversationId: 12, byPerson: true } }).do).toBe('skip');
    expect(intakeDecision({ meta: { ...bug, state: 'deferred' }, origin: { conversationId: 12, byPerson: true } }).do).toBe('skip');
    expect(intakeDecision({ meta: { ...bug, duplicateOf: 40 }, origin: { conversationId: 12, byPerson: true } }).do).toBe('skip');
  });
});

describe('the plan gate on a contract', () => {
  const contract = { risk_class: 'logic', allowed_paths: ['apps/web/src/**'], required_checks: ['test'], repo: 'https://github.com/Acme/northwind-core.git' };

  it('builds a one-package logic change', () => {
    expect(planGate({ contract, planApproved: false })).toEqual({ go: true });
  });

  it('plans first when the rule requires it and no plan is approved', () => {
    const g = planGate({ contract: { ...contract, allowed_paths: ['apps/web/src/**', 'packages/core/src/**'] }, planApproved: false });

    expect(g.go).toBe(false);
    expect(!g.go && g.why).toMatch(/span 2 packages/);
    expect(planGate({ contract: { ...contract, risk_class: 'schema' }, planApproved: false }).go).toBe(false);
  });

  it('builds when the plan is approved, and believes the worker over the rule', () => {
    expect(planGate({ contract: { ...contract, risk_class: 'schema' }, planApproved: true })).toEqual({ go: true });
    expect(planGate({ contract, planApproved: false, planFirst: 'the worker said so' })).toMatchObject({ go: false, why: 'the worker said so' });
  });
});

describe('the count and the stage', () => {
  it('counts automatic steps, marks a failed run handled, and starts again when a person acts', () => {
    let s = readRecovery({});
    s = noteAttempt(s, { at: AT, kind: 'build', trigger: 'request', runId: 7, taskId: 70, line: 'a person asked for it' });
    s = markHandled(s, 7, classifyFailure({ status: 'failed', error: 'verification failed: required checks failed: test', failures: [{ scope: 'check:test', message: 'x' }] }));
    s = noteAttempt(s, { at: AT, kind: 'build', trigger: 'recovery', runId: 8, taskId: 71, line: 'the required checks failed (test)' });

    expect(s.attempts.map(a => a.n)).toEqual([1, 2]);
    expect(s.attempts[0]!.failure?.class).toBe('checks_failed');
    expect(s.handledRunIds).toEqual([7]);
    expect(recoveryStage({ recovery: s })).toMatchObject({ stage: 'recovering', label: 'Recovering (attempt 2 of 3)' });

    const reset = personActed(s, AT, 'Build pressed by owner@example.test.');

    expect(reset.attempts).toEqual([]);
    expect(reset.handledRunIds).toEqual([7]);
    expect(reset.log.at(-1)?.text).toBe('Build pressed by owner@example.test.');
    expect(recoveryStage({ recovery: reset })).toBeNull();
  });

  it('says Planning with the rule\'s sentence, and Stopped after the attempts', () => {
    const planning = noteAttempt(readRecovery({}), { at: AT, kind: 'plan', trigger: 'recovery', runId: null, taskId: null, line: 'the allowed paths span 2 packages (apps/web, packages/core)' });

    expect(recoveryStage({ recovery: planning })).toEqual({ stage: 'planning', label: 'Planning', line: 'Planning — the allowed paths span 2 packages (apps/web, packages/core)' });
    expect(planning.log.at(-1)?.text).toBe('Recovered: planning first because the allowed paths span 2 packages (apps/web, packages/core).');
    expect(recoveryStage({ recovery: { ...planning, stage: 'stopped', line: 'Stopped after 1 attempt: x.' } })).toMatchObject({ label: 'Stopped after 1 attempt' });
  });
});
