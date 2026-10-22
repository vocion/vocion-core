import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contractFor, contractProblems, loadCases, selectCases, sendBackNotes } from './cases.mjs';

const cases = loadCases();
const sha = 'a'.repeat(40);

test('thirty cases, twenty to tune on and ten held out, every complexity in both', () => {
  assert.equal(cases.length, 30);
  assert.equal(cases.filter(c => c.split === 'tuning').length, 20);
  assert.equal(cases.filter(c => c.split === 'held-out').length, 10);
  for (const split of ['tuning', 'held-out']) {
    for (const cx of [1, 2, 3, 4]) {
      assert.ok(cases.some(c => c.split === split && c.complexity === cx), `${split} has a Cx ${cx} case`);
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
  assert.equal(selectCases(cases, { split: 'held-out' }).length, 10);
  assert.deepEqual(selectCases(cases, { ids: ['c07', 'c13-archive'] }).map(c => c.id), ['c07-last-opened', 'c13-archive']);
  assert.throws(() => selectCases(cases, { ids: ['c99'] }), /c99/);
});
