import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { contractFor, contractProblems, FIXTURE_BRANCH, loadCases, selectCases, sendBackNotes } from './cases.mjs';
import { DATAROOM_BRANCH, V2_BRANCH } from './fixture.mjs';

const cases = loadCases();
const sha = 'a'.repeat(40);

test('the core tier: thirty cases, twenty to tune on and ten held out, every complexity in both', () => {
  const core = cases.filter(c => c.tier === 'core');
  assert.equal(core.length, 30);
  assert.equal(core.filter(c => c.split === 'tuning').length, 20);
  assert.equal(core.filter(c => c.split === 'held-out').length, 10);
  for (const split of ['tuning', 'held-out']) {
    for (const cx of [1, 2, 3, 4]) {
      assert.ok(core.some(c => c.split === split && c.complexity === cx), `${split} has a Cx ${cx} case`);
    }
  }
});

test('the hard tier: eighteen Cx 4-5 cases on the dataroom fixture, a third held out', () => {
  const hard = cases.filter(c => c.tier === 'hard');
  assert.equal(hard.length, 18);
  assert.equal(hard.filter(c => c.split === 'held-out').length, 6);
  assert.ok(hard.every(c => c.fixture_ref === 'dataroom' && c.complexity >= 4));
  for (const split of ['tuning', 'held-out']) {
    for (const cx of [4, 5]) {
      assert.ok(hard.some(c => c.split === split && c.complexity === cx), `${split} has a Cx ${cx} case`);
    }
  }
  for (const c of hard.filter(c => c.report_lines)) {
    const report = fs.readFileSync(path.join(c.dir, 'reference.report.md'), 'utf8');
    for (const r of c.report_lines) {
      assert.match(report, new RegExp(r.pattern, r.flags ?? 'i'), `${c.id}: the reference report meets line ${r.line}`);
      assert.doesNotMatch('Done: built everything that was asked.', new RegExp(r.pattern, r.flags ?? 'i'), `${c.id}: a bare report fails line ${r.line}`);
    }
  }
});

test('every case makes a contract the runner accepts, first attempt and send-back alike', () => {
  for (const c of cases) {
    assert.deepEqual(contractProblems(contractFor(c, { repo: 'https://github.com/example/northwind-library.git', baseSha: sha })), [], c.id);
    const again = contractFor(c, { repo: 'https://github.com/example/northwind-library.git', baseSha: `factory/eval-${c.id}-r1`, attempt: 2, notes: sendBackNotes(c, [{ index: 0, passed: false }]) });
    assert.deepEqual(contractProblems(again), [], `${c.id} attempt 2`);
    assert.equal(again.attempt, 2);
  }
});

test('the contract carries the ask, never the hidden tests', () => {
  for (const c of cases) {
    const text = JSON.stringify(contractFor(c, { repo: 'https://github.com/example/northwind-library.git', baseSha: sha }));
    assert.ok(!text.includes('grader'), c.id);
    for (const a of c.acceptance) {
      assert.ok(text.includes(JSON.stringify(a).slice(1, -1)), `${c.id} carries "${a}"`);
    }
  }
});

test('the send-back names the lines that failed', () => {
  const c = cases[0];
  const notes = sendBackNotes(c, c.acceptance.map((_, index) => ({ index, passed: index !== 0 })));
  assert.ok(notes.includes(c.acceptance[0]));
  assert.ok(!notes.includes(c.acceptance[1]));
});

test('selectCases by split and by id prefix', () => {
  assert.equal(selectCases(cases, { split: 'held-out' }).length, 16);
  assert.equal(selectCases(cases, { split: 'held-out', tier: 'core' }).length, 10);
  assert.equal(selectCases(cases, { tier: 'hard' }).length, 18);
  assert.deepEqual(selectCases(cases, { ids: ['c07', 'c13-archive'] }).map(c => c.id), ['c07-last-opened', 'c13-archive']);
  assert.throws(() => selectCases(cases, { ids: ['c99'] }), /c99/);
});

test('a case lands on its own fixture\'s branch, so a retry is not rebased on another fixture', () => {
  assert.deepEqual(FIXTURE_BRANCH, { v1: 'main', v2: V2_BRANCH, dataroom: DATAROOM_BRANCH });
  const byRef = Object.fromEntries(loadCases().map(c => [c.fixture_ref, c]));
  const repo = 'https://github.com/example/northwind-library.git';
  assert.equal(contractFor(byRef.v1, { repo, baseSha: 'x' }).base_branch, undefined);
  assert.equal(contractFor(byRef.v2, { repo, baseSha: 'x' }).base_branch, V2_BRANCH);
  assert.equal(contractFor(byRef.dataroom, { repo, baseSha: 'factory/eval-h12-r1-wip-1', attempt: 2 }).base_branch, DATAROOM_BRANCH);
});
