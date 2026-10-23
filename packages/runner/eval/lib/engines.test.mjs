import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engine, ENGINE_IDS, parseRunnerLog, withEngine } from './engines.mjs';

const line = o => JSON.stringify({ ts: '2026-10-01T12:00:00Z', ...o });

test('a finished runner log: commit, pull request, checks and the cost of every pass', () => {
  const pr = 'https://github.com/example/northwind-library/pull/7';
  const log = [
    'Cloning into /workspace...',
    line({ phase: 'task', task_id: 'eval-c01-page-count-r1', model_policy: { model: 'claude-opus-5-5' } }),
    line({ phase: 'heartbeat', cost_usd: 0.8 }),
    line({ phase: 'verify.failed', checks: ['test=failed'] }),
    line({ phase: 'verified', checks: ['test=passed', 'no-em-dashes=passed'] }),
    line({ phase: 'pushed', branch: 'factory/eval-c01-page-count-r1', commit_sha: 'abc123' }),
    line({ phase: 'pr.opened', pr_url: pr }),
    line({ phase: 'complete.local', result: { commit_sha: 'abc123', pr_url: pr, elapsed_s: 812, token_usage: { model: 'claude-opus-5-5', cost_usd: 1.2 }, checks: [{ name: 'test', status: 'passed' }], agent_report: 'Added the page count.' } }),
    line({ phase: 'done', pr_url: pr, cost_usd: 1.73, elapsed_s: 812 }),
  ].join('\n');
  const r = parseRunnerLog(log);
  assert.equal(r.status, 'pr');
  assert.equal(r.sha, 'abc123');
  assert.equal(r.branch, 'factory/eval-c01-page-count-r1');
  assert.equal(r.prUrl, pr);
  assert.equal(r.costUsd, 1.73, 'the running total, repair passes included');
  assert.equal(r.costComplete, true);
  assert.equal(r.elapsedS, 812);
  assert.deepEqual(r.checks, [{ name: 'test', status: 'passed' }]);
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.agentReport, 'Added the page count.');
});

test('a failed run that kept its work, and a pass killed before its price', () => {
  const r = parseRunnerLog([
    line({ phase: 'heartbeat', cost_usd: 2.5 }),
    line({ phase: 'claude.usage_from_stream', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 200 }),
    line({ phase: 'kept.pushed', branch: 'factory/eval-c11-passcode-links-r1', commit_sha: 'def456' }),
    line({ phase: 'fail.local', error: 'checks failed: test', result: { kept_branch: 'factory/eval-c11-passcode-links-r1', commit_sha: 'def456', cost_usd: 3.1 } }),
    line({ phase: 'failed', run_status: 'failed' }),
  ].join('\n'));
  assert.equal(r.status, 'failed');
  assert.equal(r.branch, 'factory/eval-c11-passcode-links-r1');
  assert.equal(r.sha, 'def456');
  assert.equal(r.costUsd, 3.1);
  assert.equal(r.costComplete, false);
  assert.match(r.error, /checks failed/);
  assert.equal(r.elapsedS, null, 'the harness times a failed attempt itself');
});

test('a run cut off mid-way keeps the last cost it reported; a refused contract is infrastructure', () => {
  const r = parseRunnerLog(line({ phase: 'heartbeat', cost_usd: 0.4 }));
  assert.equal(r.status, 'infra');
  assert.equal(r.costUsd, 0.4);
  assert.equal(parseRunnerLog(line({ phase: 'contract.refused', problems: ['repo must be https'] })).status, 'infra');
});

test('a log without an outcome is an infrastructure failure', () => {
  assert.equal(parseRunnerLog('docker: Cannot connect to the Docker daemon').status, 'infra');
  assert.equal(parseRunnerLog('').status, 'infra');
});

test('the engine registry: built engines resolve, planned ones say when', () => {
  assert.deepEqual(ENGINE_IDS, ['claude-cli', 'openhands', 'oracle', 'noop', 'codex', 'claude-sdk']);
  assert.equal(engine('oracle').id, 'oracle');
  assert.equal(engine('openhands').id, 'openhands');
  assert.throws(() => engine('codex'), /not built yet \(Phase 4/);
  assert.throws(() => engine('gpt'), /unknown engine/);
});

test('claude-cli preflight names every missing prerequisite', () => {
  const pre = engine('claude-cli').preflight({ image: '', fixtureRepo: 'git@github.com:example/x.git', env: {} });
  assert.equal(pre.ok, false);
  const needs = pre.missing.map(m => m.need).join(' | ');
  for (const need of ['EVAL_RUNNER_IMAGE', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'EVAL_FIXTURE_REPO']) {
    assert.ok(needs.includes(need), needs);
  }
});

test('openhands sends the same contract with its engine block, which the runner accepts', () => {
  const contract = { task_id: 't', attempt: 1 };
  assert.deepEqual(withEngine(contract, 'openhands'), { task_id: 't', attempt: 1, engine: { id: 'openhands' } });
  assert.equal(withEngine(contract, 'claude-cli'), contract);
});
