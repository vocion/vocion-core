import { describe, expect, it } from 'vitest';
import { classifyFailure, closestSibling, contractDelta, environmentDelta, intakeDecision, markHandled, mergeCardLine, noteAttempt, personActed, planGate, readRecovery, RECOVERY_LIMIT, recoveryDecision, recoveryStage, replanBrief, settledForMergeCard, staleFailure, stalePlanRoots } from './recovery';

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

  it('continues an attempt that ran out of time on its kept branch, within the limit (walk 27, FE-478)', () => {
    const f = classifyFailure({ status: 'failed', error: 'claude exited 143 without a JSON result (wall clock: claude exceeded 2400s)', failures: [{ scope: 'claude', message: 'claude exited 143 without a JSON result (wall clock: claude exceeded 2400s)' }] });

    expect(f.class).toBe('timed_out');

    const d = recoveryDecision({ failure: f, attempts: 1 });

    expect(d).toMatchObject({ do: 'dispatch', why: expect.stringMatching(/kept branch/) });
    expect(d.do === 'dispatch' && d.note).toMatch(/ran out of its time budget/);
    expect(recoveryDecision({ failure: f, attempts: RECOVERY_LIMIT }).do).toBe('escalate');
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
    expect(intakeDecision({ meta: bug, origin: { conversationId: 12, byPerson: true } })).toMatchObject({ do: 'start', why: expect.stringContaining('CHAT-12') });
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

    expect(recoveryStage({ recovery: planning })).toEqual({ stage: 'planning', label: 'Planning', line: 'Planning — the allowed paths span 2 packages (apps/web, packages/core)', tone: 'info' });
    expect(planning.log.at(-1)?.text).toBe('Recovered: planning first because the allowed paths span 2 packages (apps/web, packages/core).');
    expect(recoveryStage({ recovery: { ...planning, stage: 'stopped', line: 'Stopped after 1 attempt: x.' } })).toMatchObject({ label: 'Stopped after 1 attempt' });
  });

  it('counts a build retry against the build budget, not the planning attempts before it (#246)', () => {
    let s = readRecovery({});
    s = noteAttempt(s, { at: AT, kind: 'plan', trigger: 'recovery', runId: null, taskId: null, line: 'the plan was refused' });
    s = noteAttempt(s, { at: AT, kind: 'plan', trigger: 'recovery', runId: null, taskId: null, line: 'the plan was refused again' });
    s = noteAttempt(s, { at: AT, kind: 'build', trigger: 'request', runId: 7, taskId: 70, line: 'the plan was approved' });
    s = noteAttempt(s, { at: AT, kind: 'build', trigger: 'retry', runId: 8, taskId: 71, line: 'QA sent attempt #70 back' });

    expect(s.line).toBe('Recovering (attempt 2 of 3): QA sent attempt #70 back');
    expect(recoveryStage({ recovery: s })).toMatchObject({ label: 'Recovering (attempt 2 of 3)' });
  });
});

describe('the worker\'s own environment failing (#124, 2026-09-28)', () => {
  const env = classifyFailure({ status: 'failed', error: 'services failed: prisma:sync failed: ', failures: [{ scope: 'services', message: 'prisma:sync failed: ' }] });

  it('is its own class, not a flake', () => {
    expect(env).toMatchObject({ class: 'environment', sentence: 'services failed: prisma:sync failed' });
    expect(classifyFailure({ status: 'failed', error: 'prepare failed: npm ci failed: ERESOLVE' }).class).toBe('environment');
  });

  it('stops at once, spending no attempt, unless the worker or the environment changed', () => {
    expect(recoveryDecision({ failure: env, attempts: 0 })).toMatchObject({
      do: 'escalate',
      why: 'Stopped: the worker\'s environment is failing before any work starts: services failed: prisma:sync failed; it needs a person or a worker rebuild',
    });
    expect(recoveryDecision({ failure: env, attempts: 0, environmentDelta: ['worker 6bab52e → 9c1d2e3'] })).toMatchObject({ do: 'dispatch', why: expect.stringContaining('worker 6bab52e → 9c1d2e3') });
  });

  it('calls a change only what is known to have changed', () => {
    expect(environmentDelta({ workerVersion: 'img-1', environment: { services: ['postgres'] } }, { workerVersion: 'img-2', environment: { services: ['postgres'] } })).toEqual(['worker img-1 → img-2']);
    expect(environmentDelta({ workerVersion: null, environment: null }, { workerVersion: null, environment: null })).toEqual([]);
    expect(environmentDelta({ workerVersion: 'img-1', environment: {} }, { workerVersion: 'img-1', environment: { services: ['redis'] } })).toEqual(['the repository\'s environment on the contract']);
  });
});

describe('a planning step that ended without a plan', () => {
  it('plans again within the limit, and stops at it', () => {
    const failure = { class: 'no_plan' as const, sentence: 'the planning run (automation run #8) ended without filing a plan', tail: null, failedChecks: [] };

    expect(recoveryDecision({ failure, attempts: 1, planWhy: 'the change spans 2 packages' })).toEqual({ do: 'plan', why: 'the change spans 2 packages' });
    expect(recoveryDecision({ failure, attempts: 3 }).do).toBe('escalate');
  });
});

describe('a stale plan (the worker\'s typed failure, or the records)', () => {
  // A repo whose apps were renamed relay-* → courier-* after the plan was written.
  const repo = {
    riskDefaults: { 'apps/courier-api/**': 'logic', 'apps/courier-web/**': 'ui', 'packages/core/prisma/**': 'schema', 'docs/**': 'docs' },
    productPaths: { relay: ['apps/courier-api/**', 'apps/courier-web/**', 'apps/courier-site/**'] },
  };
  const components = [
    'packages/core/src/routes/parcel.ts — GET returns openedAt per address',
    'apps/relay-api/prisma/schema/core.prisma — Parcel.remindedAt',
    'apps/relay-web/src/routes/ParcelPage.tsx — the Remind dialog',
  ];

  it('reads the worker\'s paths_missing off result.failure, with the paths that exist', () => {
    const f = classifyFailure({
      status: 'failed',
      error: 'paths missing: the allowed paths name apps/relay-api (did you mean apps/courier-api?), which is not in the repository. Nothing was changed and no model was called.',
      failures: [{ scope: 'paths_missing', message: 'the allowed paths name apps/relay-api (did you mean apps/courier-api?), which is not in the repository' }],
      result: { failure: { kind: 'paths_missing', missing: ['apps/relay-api/prisma/schema/core.prisma'], suggest: ['apps/courier-api/prisma/schema/core.prisma'], reason: 'the allowed paths name apps/relay-api (did you mean apps/courier-api?), which is not in the repository' } },
    });

    expect(f.class).toBe('stale_plan');
    expect(f.sentence).toBe('the plan no longer fits the repository: the allowed paths name apps/relay-api (did you mean apps/courier-api?), which is not in the repository');
    expect(f.stale).toMatchObject({ kind: 'paths_missing', suggest: ['apps/courier-api/prisma/schema/core.prisma'] });
  });

  it('reads out_of_bounds — the engineer\'s own words — instead of "no changes"', () => {
    const f = classifyFailure({
      status: 'failed',
      error: 'out of bounds: Claude stopped because the work cannot be built inside the allowed paths. Nothing was changed. Claude said: I stopped without changing anything, because the plan can\'t be built inside the allowed paths.',
      failures: [{ scope: 'out_of_bounds', message: 'I stopped without changing anything, because the plan can\'t be built inside the allowed paths.' }],
      result: { failure: { kind: 'out_of_bounds', reason: 'I stopped without changing anything, because the plan can\'t be built inside the allowed paths.', detail: 'I stopped without changing anything…\n\n- Reminders need a schema change.' } },
    });

    expect(f.class).toBe('stale_plan');
    expect(f.sentence).toMatch(/^the plan no longer fits the repository: the engineer stopped because the work cannot be built inside its paths/);
  });

  it('reads the kind off the failure entry\'s scope when result carries none', () => {
    expect(classifyFailure({ status: 'failed', error: 'x', failures: [{ scope: 'out_of_bounds', message: 'The schema is outside the allowed paths.' }] }).class).toBe('stale_plan');
  });

  it('plans again, never sends it again and never asks for paths', () => {
    const failure = classifyFailure({ status: 'failed', error: 'x', failures: [], result: { failure: { kind: 'paths_missing', missing: ['apps/relay-api/**'], suggest: ['apps/courier-api/**'], reason: 'the allowed paths name apps/relay-api, which is not in the repository' } } });
    const d = recoveryDecision({ failure, attempts: 1 });

    expect(d.do).toBe('replan');
    expect(d.do === 'replan' && d.brief).toContain('Name these instead: apps/courier-api/**');
    expect(d.do === 'replan' && d.brief).toContain('Paths the repository does not have: apps/relay-api/**');
    expect(d.do === 'replan' && d.brief.length).toBeLessThanOrEqual(1000);

    // At the limit, one ask, which says what a new plan must name.
    const stopped = recoveryDecision({ failure, attempts: RECOVERY_LIMIT });

    expect(stopped).toMatchObject({ do: 'escalate', unblock: expect.stringContaining('apps/courier-api/**') });
  });

  it('derives staleness from the repo record: roots the plan names that the record no longer lists', () => {
    const stale = stalePlanRoots(components, repo);

    expect(stale).toMatchObject({ kind: 'derived', missing: ['apps/relay-api', 'apps/relay-web'], suggest: ['apps/courier-api', 'apps/courier-web'] });
    expect(stale!.reason).toBe('it names apps/relay-api (now apps/courier-api), apps/relay-web (now apps/courier-web), which the repository no longer has');
  });

  it('a plan that fits, or a repo record that lists no apps, is never stale', () => {
    expect(stalePlanRoots(['apps/courier-api — x', 'packages/core/src/a.ts — y', 'docs/guide.md — z'], repo)).toBeNull();
    expect(stalePlanRoots(components, { riskDefaults: { 'docs/**': 'docs' } })).toBeNull();
    expect(stalePlanRoots(components, null)).toBeNull();
  });

  it('a "no changes" from an older worker against a stale plan is the stale plan', () => {
    const failure = classifyFailure({ status: 'failed', error: 'verification failed: Claude produced no changes in the working tree (checks on the base: test=passed)', failures: [] });

    expect(failure.class).toBe('no_changes');

    const d = recoveryDecision({ failure, attempts: 0, stalePlan: stalePlanRoots(components, repo) });

    expect(d).toMatchObject({ do: 'replan', why: 'the plan no longer fits the repository: it names apps/relay-api (now apps/courier-api), apps/relay-web (now apps/courier-web), which the repository no longer has' });
    expect(recoveryDecision({ failure, attempts: 0 }).do).toBe('escalate');
  });

  it('the brief carries the engineer\'s words and caps at 1000 characters', () => {
    const brief = replanBrief(staleFailure({ kind: 'out_of_bounds', missing: [], suggest: [], reason: 'It cannot be built inside the allowed paths.', detail: `Reminders need a schema change. ${'x'.repeat(2000)}` }));

    expect(brief).toContain('The engineer said: Reminders need a schema change');
    expect(brief.length).toBeLessThanOrEqual(1000);
  });

  it('the closest sibling is by suffix, and a tie is not guessed', () => {
    expect(closestSibling('relay-api', ['courier-api', 'courier-web'])).toBe('courier-api');
    expect(closestSibling('relay-api', ['courier-api', 'ledger-api'])).toBeNull();
    expect(closestSibling('billing', ['courier-api'])).toBeNull();
  });

  it('the planner reads the carried refusal even when the rule also requires a plan', () => {
    const contract = { risk_class: 'schema', allowed_paths: ['apps/courier-api/**', 'packages/core/**'] };

    expect(planGate({ contract, planApproved: false, planFirst: 'the approved plan no longer fits the repository' })).toMatchObject({ go: false, why: 'the approved plan no longer fits the repository' });
  });
});

describe('an incompatible contract is the system\'s to fix, not a person\'s (#294)', () => {
  it('a refusal of the contract\'s shape is its own class; a refusal for want of a plan is not', async () => {
    const { classifyFailure: classify } = await import('./recovery');
    const refused = (message: string) => classify({ status: 'failed', error: `contract refused: 1 problem: ${message}`, failures: [{ scope: 'contract', message }] });

    expect(refused('checks is not a contract field (write required_checks)')).toMatchObject({ class: 'contract_shape', sentence: 'the worker refused the contract Vocion wrote: checks is not a contract field (write required_checks)' });
    expect(refused('qa is required when risk_class is ui: add qa.flows with at least one { name, path }').class).toBe('contract_shape');
    expect(refused('qa.flows[0].name must be at most 60 characters').class).toBe('contract_shape');
    expect(refused('plan is required: allowed_paths spans 2 packages (apps/web, packages/core). Write the plan').class).toBe('plan_required');
    expect(refused('plan: this task needs an approved plan').class).toBe('refused_other');
  });

  it('is held, never asked, until the worker changes; then it is sent again', async () => {
    const { classifyFailure: classify, recoveryDecision: decide, INFRASTRUCTURE_FAILURES: infra } = await import('./recovery');
    const failure = classify({ status: 'failed', error: 'contract refused', failures: [{ scope: 'contract', message: 'checks is not a contract field (write required_checks)' }] });

    expect(decide({ failure, attempts: 3 })).toMatchObject({ do: 'hold', why: expect.stringMatching(/^Held: the worker refused the contract Vocion wrote: checks is not a contract field/) });
    expect(decide({ failure, attempts: 1, environmentDelta: ['worker img-old → img-new'] })).toMatchObject({ do: 'dispatch' });
    expect(infra.has('contract_shape')).toBe(true);
  });

  it('a held stop names who it waits on, and is not a person\'s decision', async () => {
    const { recoveryStage: stage } = await import('./recovery');
    const line = 'Held: the worker refused the contract Vocion wrote. Release engineer has it.';

    expect(stage({ recovery: { stage: 'stopped', line, attempts: [{ n: 1 }], waitingOn: { who: 'Release engineer', line, actionRunId: null } } })).toMatchObject({ stage: 'stopped', label: 'Waiting on Release engineer', tone: 'warn' });
    expect(stage({ recovery: { stage: 'stopped', line, attempts: [{ n: 1 }] } })).toMatchObject({ label: 'Stopped after 1 attempt', tone: 'bad' });
  });
});

describe('the recovery log is kept in time order (#294)', () => {
  it('a line stamped before the lines already written goes where its time puts it', async () => {
    const { logLine: log, readRecovery: read } = await import('./recovery');
    let s = read({});
    s = log(s, 'Build pressed.', '2026-10-01T09:05:06.113Z');
    s = log(s, 'Plan #295 approved; the build started on its own.', '2026-10-01T09:06:58.254Z');
    s = log(s, 'Plan #295 written and approved.', '2026-10-01T09:06:59.170Z');
    // Intake stamps the filing, then awaits the dispatch, which planned and logged first.
    s = log(s, 'Filed and started: you asked for it.', '2026-10-01T09:05:05.163Z');
    s = log(s, 'Same moment, written later.', '2026-10-01T09:06:59.170Z');

    expect(s.log.map(l => l.text)).toEqual(['Filed and started: you asked for it.', 'Build pressed.', 'Plan #295 approved; the build started on its own.', 'Plan #295 written and approved.', 'Same moment, written later.']);
  });

  it('a log written out of order before this reads in order; equal times keep their order', async () => {
    const { readRecovery: read } = await import('./recovery');
    const stored = [
      { at: '2026-10-01T09:06:59.170Z', text: 'b', runId: null },
      { at: '2026-10-01T09:05:05.163Z', text: 'a', runId: null },
      { at: '2026-10-01T10:05:02.149Z', text: 'd', runId: 439 },
      { at: '2026-10-01T10:05:00.521Z', text: 'c', runId: 438 },
      { at: '2026-10-01T10:05:02.149Z', text: 'e', runId: null },
    ];

    expect(read({ recovery: { log: stored } }).log.map(l => l.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('a check that cannot run is configuration, not code', () => {
  // The worker's typed shape (runner preflight.mjs checkNotRunnableFailure), with invented commands.
  const run = {
    status: 'failed',
    error: 'check not runnable: the repo record\'s command for test, no-em-dashes cannot run as written; nothing was built.',
    failures: [{ scope: 'check_not_runnable', message: 'test: `npm test (suites need postgres)`: it is not a shell command: it does not parse' }],
    result: { failure: { kind: 'check_not_runnable', checks: [
      { name: 'test', command: 'npm test (suites need postgres)', reason: 'it is not a shell command: it does not parse', stderr: 'sh: 1: Syntax error: "(" unexpected' },
      { name: 'no-em-dashes', command: 'the worker greps for U+2014', reason: 'its first word, the, is not a command the runner can find', stderr: 'sh: the: not found' },
    ] } },
  };

  it('reads the worker\'s typed kind, with each command and what the shell said', () => {
    const f = classifyFailure(run);

    expect(f.class).toBe('check_not_runnable');
    expect(f.failedChecks).toEqual(['test', 'no-em-dashes']);
    expect(f.sentence).toContain('the repo record\'s command for test, no-em-dashes cannot run as written');
    expect(f.tail).toContain('Syntax error');
    expect(f.notRunnable?.[1]?.command).toBe('the worker greps for U+2014');
  });

  it('is never retried, whether attempts are left or not, and says who fixes what', () => {
    const f = classifyFailure(run);
    for (const attempts of [0, RECOVERY_LIMIT]) {
      const d = recoveryDecision({ failure: f, attempts });

      expect(d.do).toBe('configure');
      expect(d.do === 'configure' && d.why).toContain('the repo record\'s configuration, not the code');
      expect(d.do === 'configure' && d.unblock).toContain('on the repo record');
    }
  });

  it('a check that ran and failed is still the code\'s, and is sent again with its output', () => {
    const f = classifyFailure({ status: 'failed', error: 'verification failed: required checks failed: test', failures: [{ scope: 'check:test', message: 'expected 2 rows, got 1' }] });

    expect(f.class).toBe('checks_failed');
    expect(recoveryDecision({ failure: f, attempts: 0 }).do).toBe('dispatch');
  });
});

describe('an attempt that passed QA settles the stage on its merge card (Walk 7, 2026-10-02, #130)', () => {
  const recovering = noteAttempt(readRecovery({}), { at: '2026-10-02T03:54:55Z', kind: 'build', trigger: 'recovery', runId: 470, taskId: 360, line: 'sending it again because the required checks failed (no-runtime-ddl)' });

  it('says whose move the card is, in one line', () => {
    expect(mergeCardLine({ proven: 8, total: 8, riskClass: 'infra', status: 'pending' })).toBe('QA approved 8 of 8; the merge waits on a person (infra class).');
    expect(mergeCardLine({ proven: 5, total: 5, riskClass: 'logic', status: 'done' })).toBe('QA approved 5 of 5; merged on its trust rule (logic class).');
    expect(mergeCardLine({ proven: 5, total: 5, riskClass: null, status: 'awaiting_execution' })).toBe('QA approved 5 of 5; the merge is running on its trust rule.');
    expect(mergeCardLine({ proven: 5, total: 5, riskClass: 'logic', status: 'failed' })).toBeNull();
  });

  it('clears "Recovering" with the line in the log, and keeps an attempt that started after the card', () => {
    expect(recoveryStage({ recovery: recovering })?.stage).toBe('recovering');

    const settled = settledForMergeCard(recovering, 'QA approved 8 of 8; the merge waits on a person (infra class).', '2026-10-02T04:21:38Z', '2026-10-02T04:21:39Z');

    expect(settled?.stage).toBeNull();
    expect(settled?.line).toBeNull();
    expect(recoveryStage({ recovery: settled })).toBeNull();
    expect(settled?.log.at(-1)?.text).toBe('QA approved 8 of 8; the merge waits on a person (infra class).');
    expect(settled?.attempts).toHaveLength(1);
    expect(settledForMergeCard(recovering, 'x', '2026-10-02T03:00:00Z', '2026-10-02T04:21:39Z')).toBeNull();
    expect(settledForMergeCard(readRecovery({}), 'x', '2026-10-02T04:21:38Z', '2026-10-02T04:21:39Z')).toBeNull();
  });
});
