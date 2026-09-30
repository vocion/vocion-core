import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordableFlows, repoName, repoSlug, TASK_STATUS, taskClaimed, taskCompleted, taskExternalKey, taskFailed, taskTitle } from './record.mjs';

// The type is the one the run names (run.input.record.type): the plugin says what a task is.
const TYPE = 'work_item';

const contract = {
  task_id: 'northwind-0007-admin',
  product: 'northwind-portal',
  repo: 'https://github.com/example/northwind-portal.git',
  base_sha: 'origin/main',
  objective: 'Add the admin panel. Two panes.\nMore detail here.',
  request_id: '12',
  acceptance_contract: ['admin.northwind.example answers'],
  allowed_paths: ['apps/admin/**'],
  risk_class: 'ui',
  required_checks: ['typecheck', 'no-em-dashes'],
  model_policy: { model: 'sonnet' },
  token_budget_usd: 6,
  wall_clock_minutes: 30,
};

test('one external key per task id', () => {
  assert.deepEqual(taskExternalKey('northwind-0007-admin'), { system: 'factory', id: 'task:northwind-0007-admin' });
});

test('the title is the first sentence of the objective, capped at 100 characters', () => {
  assert.equal(taskTitle(contract), 'Add the admin panel');
  assert.equal(taskTitle(contract.objective), 'Add the admin panel');
  assert.equal(taskTitle('x'.repeat(140)).length, 100);
  assert.ok(taskTitle('x'.repeat(140)).endsWith('...'));
  assert.equal(taskTitle(''), 'Engineering task');
  assert.equal(taskTitle(undefined), 'Engineering task');
});

test('a task with a title of its own keeps it whole, with no ellipsis', () => {
  const titled = { ...contract, title: 'Add the admin panel with two panes' };
  assert.equal(taskTitle(titled), 'Add the admin panel with two panes');
  assert.ok(!taskTitle(titled).includes('...'));
  assert.equal(taskTitle({ title: '  Add the admin panel  ', objective: 'Something else entirely.' }), 'Add the admin panel');
  assert.equal(taskTitle({ title: '   ', objective: 'Add the admin panel.' }), 'Add the admin panel');
  assert.equal(taskClaimed(titled, { type: TYPE, runId: 1, attempt: 1, workerId: 'w' }).title, 'Add the admin panel with two panes');
});

test('a record title reads as the change, not as the objective it was cut from', () => {
  const observability = {
    ...contract,
    task_id: 'northwind-0010-observability',
    objective: 'Instrument the portal for observability with two tools, each doing what it is best at, and nothing counted twice. One takes the product analytics and one takes the errors.',
    title: 'Report the portal\'s behaviour and its errors, with nothing counted twice',
  };
  assert.equal(taskTitle(observability), 'Report the portal\'s behaviour and its errors, with nothing counted twice');
  // Without the title the record carried the objective, cut mid-thought and marked with an ellipsis.
  const untitled = { ...observability, title: undefined };
  assert.ok(taskTitle(untitled).endsWith('...'));
  assert.ok(taskTitle(untitled).length <= 100);
});

test('repo name and slug come off the clone url', () => {
  assert.equal(repoName('https://github.com/example/northwind-portal.git'), 'example/northwind-portal');
  assert.equal(repoName('https://github.com/example/northwind-portal'), 'example/northwind-portal');
  assert.equal(repoSlug('https://github.com/example/northwind-portal.git'), 'northwind-portal');
});

test('claim, completion and failure all write to the same key, under the type the run names', () => {
  const claimed = taskClaimed(contract, { type: TYPE, runId: 351, attempt: 1, workerId: 'w1' });
  assert.equal(claimed.status, TASK_STATUS.running);
  const done = taskCompleted(contract, { branch: 'factory/x', commit_sha: 'abc', pr_url: 'https://github.com/o/r/pull/9', files_changed: ['a.ts'], checks: [{ name: 'typecheck', status: 'passed', exit_code: 0, tail: 'ok' }, { name: 'test', status: 'skipped' }], attempt: 1 }, { type: TYPE, runId: 351, summary: 'did it', costUsd: 1.234 });
  assert.equal(done.status, TASK_STATUS.awaiting_review);
  assert.equal(done.metadata.prUrl, 'https://github.com/o/r/pull/9');
  assert.equal(done.metadata.actualCents, 123);
  assert.deepEqual(done.metadata.checks[0], { name: 'typecheck', passed: true, exitCode: 0 });
  assert.equal(done.metadata.verification[1].summary, 'skipped');
  const failed = taskFailed(contract, { type: TYPE, runId: 352, error: 'verification failed: test', failures: [{ scope: 'check:test', message: '3 failing' }], kept: { branch: 'factory/x-wip-352', prUrl: 'https://github.com/o/r/pull/10', files: ['a.ts'], continue: 'Continue from this branch' }, costUsd: 11.86, attempt: 1 });
  assert.equal(failed.status, TASK_STATUS.rejected);
  assert.equal(failed.metadata.keptBranch, 'factory/x-wip-352');
  assert.equal(failed.metadata.prUrl, 'https://github.com/o/r/pull/10');
  assert.equal(failed.metadata.actualCents, 1186);
  assert.equal(failed.metadata.knownFailures[0], 'check:test: 3 failing');
  for (const r of [claimed, done, failed]) {
    assert.deepEqual(r.externalKey, taskExternalKey(contract.task_id));
    assert.equal(r.type, TYPE);
  }
});

test('the QA flows travel onto the completed task, as written, so the live check can replay them', () => {
  const qa = { surface: 'app', flows: [
    { name: 'document page', path: '/documents/[id]', viewports: ['desktop', 'phone'], sign_in: true, before: 'production', steps: [{ wait_for: 'main' }] },
    { name: 'Pin a note', criterion: 'A sender can pin a note', path: '/', sign_in: true, steps: [{ click: 'Pin' }, { shoot: 'pinned' }] },
  ] };
  const flows = recordableFlows(qa);
  assert.deepEqual(flows[0], { name: 'document page', path: '/documents/[id]', surface: 'app', viewports: ['desktop', 'phone'], sign_in: true, steps: [{ wait_for: 'main' }] });
  assert.deepEqual(flows[1].viewports, ['desktop']);
  assert.equal(flows[1].criterion, 'A sender can pin a note');
  // A copy: resolving a placeholder in the capture pass does not rewrite what the record keeps.
  qa.flows[0].steps[0].wait_for = 'changed';
  assert.equal(flows[0].steps[0].wait_for, 'main');
  assert.deepEqual(recordableFlows(null), []);
  const done = taskCompleted(contract, { qa_flows: flows, checks: [] }, { type: TYPE, runId: 1, summary: '', costUsd: 0 });
  assert.deepEqual(done.metadata.qaFlows, flows);
  assert.deepEqual(taskCompleted(contract, { checks: [] }, { type: TYPE, runId: 1 }).metadata.qaFlows, []);
});
