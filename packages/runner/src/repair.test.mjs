import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { taskCompleted, taskFailed } from './record.mjs';
import { isRepairable, MAX_REPAIR_PASSES, repairBrief, repairDecision, repairRecord, repairsLine } from './repair.mjs';
import { usageDelta } from './usage.mjs';

const failedTest = { name: 'test', status: 'failed', exit_code: 1, command: 'npm test', tail: '1 failing' };
const passedLint = { name: 'lint', status: 'passed', exit_code: 0, command: 'npm run lint' };
const red = { ok: false, files: ['a.ts'], checks: [passedLint, failedTest] };
const roomy = { passesDone: 0, budgetLeftUsd: 8, secondsLeft: 1800 };

describe('repairDecision', () => {
  it('repairs a failing check while the run has passes, budget and clock left', () => {
    const d = repairDecision({ verification: red, ...roomy });
    assert.equal(d.repair, true);
    assert.deepEqual(d.failures.map(c => c.name), ['test']);
  });

  it('stops after MAX_REPAIR_PASSES (2), so a check still red fails the run as before', () => {
    assert.equal(MAX_REPAIR_PASSES, 2);
    assert.equal(repairDecision({ verification: red, ...roomy, passesDone: 1 }).repair, true);
    assert.deepEqual(repairDecision({ verification: red, ...roomy, passesDone: 2 }), { repair: false, reason: 'passes-exhausted', failures: [failedTest] });
  });

  it('never repairs a check that cannot run (configuration, check_not_runnable)', () => {
    const notFound = { name: 'build', status: 'failed', exit_code: 127, command: 'turbo build', tail: 'sh: turbo: not found' };
    assert.equal(isRepairable(notFound), false);
    assert.equal(isRepairable({ ...failedTest, not_runnable: true }), false);
    assert.equal(repairDecision({ verification: { ...red, checks: [failedTest, notFound] }, ...roomy }).reason, 'not-runnable');
    assert.equal(repairDecision({ verification: { ...red, checks: [{ ...notFound, exit_code: 126 }] }, ...roomy }).repair, false);
  });

  it('respects the budget, the wall clock, and a stop (a person\'s cancel is final)', () => {
    assert.equal(repairDecision({ verification: red, ...roomy, budgetLeftUsd: 0.1 }).reason, 'budget');
    assert.equal(repairDecision({ verification: red, ...roomy, budgetLeftUsd: Number.NaN }).reason, 'budget');
    assert.equal(repairDecision({ verification: red, ...roomy, secondsLeft: 60 }).reason, 'wall-clock');
    assert.equal(repairDecision({ verification: red, ...roomy, stopped: true }).reason, 'stopped');
    assert.equal(repairDecision({ verification: red, ...roomy, lostLease: true }).reason, 'stopped');
  });

  it('has nothing to repair when the checks passed, nothing changed, or no check failed', () => {
    assert.equal(repairDecision({ verification: { ok: true, checks: [passedLint] }, ...roomy }).reason, 'passed');
    assert.equal(repairDecision({ verification: { ok: false, noChanges: true, checks: [failedTest] }, ...roomy }).reason, 'no-changes');
    assert.equal(repairDecision({ verification: { ok: false, checks: [], error: 'changes to files a person owns' }, ...roomy }).reason, 'not-a-check');
  });
});

describe('repairBrief', () => {
  it('names each failing check, its command and the tail of its output', () => {
    const out = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const b = repairBrief({ failures: [failedTest, { name: 'no-em-dashes', status: 'failed', exit_code: 1, tail: 'em dash (U+2014) found at a.md:3' }], outputs: { test: out }, pass: 1 });
    assert.match(b, /Repair pass 1 of 2/);
    assert.match(b, /### test\n\nCommand: `npm test` \(exit 1\)/);
    assert.match(b, /line 99/);
    assert.doesNotMatch(b, /line 10\n/);
    assert.match(b, /### no-em-dashes[\s\S]*a\.md:3/);
    assert.match(b, /Do not weaken, skip or delete a test/);
    assert.doesNotMatch(b, /Engineering task/);
  });

  it('carries the task brief for a fresh pass that is not a resumed session', () => {
    const b = repairBrief({ failures: [failedTest], pass: 2, taskBrief: '# Engineering task T-1' });
    assert.match(b, /^# Engineering task T-1/);
    assert.match(b, /earlier pass on this task left its changes/);
  });
});

describe('repairRecord', () => {
  it('records which checks a pass fixed and which still fail', () => {
    const fixed = repairRecord({ pass: 1, failures: [failedTest], after: { ok: true, checks: [passedLint, { ...failedTest, status: 'passed' }] }, resumed: true, costUsd: 0.4321, durationS: 95.4 });
    assert.deepEqual(fixed, { pass: 1, failed: ['test'], fixed: ['test'], still_failing: [], outcome: 'fixed', resumed_session: true, cost_usd: 0.43, duration_s: 95 });
    const still = repairRecord({ pass: 2, failures: [failedTest], after: { ok: false, checks: [{ ...passedLint, status: 'failed' }, failedTest] }, resumed: false });
    assert.equal(still.outcome, 'still-failing');
    assert.deepEqual(still.newly_failing, ['lint']);
    assert.equal(repairRecord({ pass: 1, failures: [failedTest], after: null, outcome: 'stopped' }).outcome, 'stopped');
    assert.equal(repairsLine([fixed]), 'pass 1: test failed; all fixed');
    assert.equal(repairsLine([still]), 'pass 2: test failed; still failing lint, test');
  });

  it('rides the task record on completion and on failure', () => {
    const contract = { task_id: 'T-1', objective: 'x' };
    const rec = repairRecord({ pass: 1, failures: [failedTest], after: { ok: true, checks: [] } });
    assert.deepEqual(taskCompleted(contract, { checks: [], repairs: [rec] }, { type: 'work_item', runId: 1 }).metadata.repairs, [rec]);
    assert.deepEqual(taskFailed(contract, { type: 'work_item', runId: 1, repairs: [rec] }).metadata.repairs, [rec]);
    assert.equal(taskFailed(contract, { type: 'work_item', runId: 1 }).metadata.repairs, undefined);
  });
});

describe('usageDelta', () => {
  it('takes a resumed session\'s running totals down to this pass', () => {
    assert.deepEqual(usageDelta({ m: { costUSD: 0.5, inputTokens: 300, contextWindow: 200000 } }, { m: { costUSD: 0.2, inputTokens: 100, contextWindow: 200000 } }), { m: { costUSD: 0.3, inputTokens: 200, contextWindow: 0 } });
  });
});

// ---------- the runner itself, end to end, with a scripted engineer ----------

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'runner.mjs');

// A stand-in for Claude Code: logs its argv, then does what FAKE_PLAN says for this call number
// (`bad` writes a file the check rejects, `good` one it accepts, `none` changes nothing).
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const log = process.env.FAKE_LOG;
const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean).length : 0;
let stdin = ''; process.stdin.on('data', d => stdin += d); process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  fs.appendFileSync(log, JSON.stringify({ args, prompt: stdin }) + '\\n');
  const plan = (process.env.FAKE_PLAN || 'bad').split(',');
  const step = plan[Math.min(calls, plan.length - 1)];
  if (step !== 'none') fs.writeFileSync('docs/feature.md', step + '\\n');
  const at = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const session = at('--resume') || at('--session-id') || 'none';
  const cost = Number(process.env.FAKE_COST || 0.1) * (calls + 1); // a resumed session reports its running total
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'wrote ' + step, num_turns: 1, session_id: session, total_cost_usd: cost, usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { 'claude-sonnet-test': { costUSD: cost, inputTokens: 10 * (calls + 1) } } }));
});
`;

function fixtureRepo(root) {
  const repo = path.join(root, 'origin');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'readme.md'), 'docs\n');
  fs.writeFileSync(path.join(repo, 'node_modules', '.keep'), '');
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A', '-f');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  return repo;
}

function runLocal({ plan, check = 'grep -q good docs/feature.md', env = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-repair-'));
  const repo = fixtureRepo(root);
  const fake = path.join(root, 'claude');
  fs.writeFileSync(fake, FAKE, { mode: 0o755 });
  const fakeLog = path.join(root, 'calls.jsonl');
  // The contract takes an https repo; git maps it onto the local fixture.
  const url = 'https://git.example.test/northwind/portal.git';
  const task = { task_id: 'T-REPAIR', product: 'northwind-portal', repo: url, base_sha: 'main', objective: 'Write the feature doc.', acceptance_contract: ['the doc says good'], allowed_paths: ['docs/**'], risk_class: 'docs', required_checks: ['test'], checks: [{ name: 'test', command: check }] };
  const r = spawnSync(process.execPath, [runner], {
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: process.env.PATH, HOME: root, WORKSPACE: path.join(root, 'ws'), RUNNER_HOME: root, CLAUDE_BIN: fake, FAKE_LOG: fakeLog, FAKE_PLAN: plan, QA_CAPTURE: '0', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', LOCAL_TASK_JSON: JSON.stringify(task), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${repo}.insteadOf`, GIT_CONFIG_VALUE_0: url, ...env },
  });
  const lines = r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const calls = fs.existsSync(fakeLog) ? fs.readFileSync(fakeLog, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  fs.rmSync(root, { recursive: true, force: true });
  return { r, lines, calls, phase: p => lines.filter(l => l.phase === p) };
}

describe('the runner repairs failed checks inside the run', () => {
  it('a failing check repaired on pass 1: same session resumed, checks re-run, verified without a new attempt', () => {
    const { lines, calls, phase } = runLocal({ plan: 'bad,good' });
    assert.equal(calls.length, 2, JSON.stringify(lines.slice(-5)));
    const session = calls[0].args[calls[0].args.indexOf('--session-id') + 1];
    assert.ok(session);
    assert.equal(calls[1].args[calls[1].args.indexOf('--resume') + 1], session);
    assert.match(calls[1].prompt, /Repair pass 1 of 2[\s\S]*### test[\s\S]*grep -q good docs\/feature\.md/);
    assert.match(calls[0].prompt, /- test: `grep -q good docs\/feature\.md`[\s\S]*Run each of these commands yourself/);
    const fixed = phase('repair.fixed')[0];
    assert.deepEqual({ pass: fixed.pass, failed: fixed.failed, fixed: fixed.fixed, outcome: fixed.outcome, resumed: fixed.resumed_session }, { pass: 1, failed: ['test'], fixed: ['test'], outcome: 'fixed', resumed: true });
    assert.equal(fixed.cost_usd, 0.1, 'a resumed pass costs its share, not the session total');
    assert.equal(phase('verified').length, 1);
    assert.ok(!phase('verify.failed').length);
  });

  it('still failing after 2 repair passes fails the run as before, naming the passes, and keeps the work', () => {
    const { calls, phase } = runLocal({ plan: 'bad' });
    assert.equal(calls.length, 3);
    assert.deepEqual(phase('repair.unfixed').map(l => l.pass), [1, 2]);
    assert.equal(phase('repair.skipped')[0].reason, 'passes-exhausted');
    const failed = phase('fail.local')[0];
    assert.match(failed.error, /verification failed: required checks failed: test \(after 2 repair passes in this run: pass 1: test failed; still failing test\. pass 2/);
    assert.equal(failed.partial.repairs.length, 2);
    assert.equal(failed.result?.repairs?.length ?? failed.partial.repairs.length, 2);
    assert.equal(phase('keep').length, 1);
  });

  it('a check that cannot run is never sent to the engineer', () => {
    const { calls, phase } = runLocal({ plan: 'bad', check: 'sh -c "exit 127"' });
    assert.equal(calls.length, 1);
    assert.equal(phase('repair.skipped')[0].reason, 'not-runnable');
    assert.ok(phase('fail.local')[0]);
  });

  it('no repair when the budget or the wall clock is spent', () => {
    const budget = runLocal({ plan: 'bad,good', env: { MAX_BUDGET_USD: '0.3', FAKE_COST: '0.2' } });
    assert.equal(budget.calls.length, 1);
    assert.equal(budget.phase('repair.skipped')[0].reason, 'budget');
    const clock = runLocal({ plan: 'bad,good', env: { WALL_CLOCK_MINUTES: '6' } });
    assert.equal(clock.calls.length, 1);
    assert.equal(clock.phase('repair.skipped')[0].reason, 'wall-clock');
  });
});
