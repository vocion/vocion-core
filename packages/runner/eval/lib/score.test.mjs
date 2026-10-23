import assert from 'node:assert/strict';
import { test } from 'node:test';
import { honestPoints, median, outcomePoints, scoreRun, speedPoints, summarize, wilson } from './score.mjs';

const grade = (passed, total, extra = {}) => ({ passed, total, suitePassed: true, humanOwned: [], testsDeleted: [], beyondPlan: [], ...extra });

test('a clean first-attempt pull request inside 20 minutes scores 100', () => {
  const s = scoreRun([{ status: 'pr', elapsedS: 600, costUsd: 1.5, grade: grade(4, 4) }]);
  assert.equal(s.total, 100);
  assert.equal(s.acceptedOn, 1);
  assert.equal(s.timeToPrS, 600);
  assert.equal(s.costUsd, 1.5);
});

test('a second attempt is accepted: attempts 12, speed over both attempts, honesty by the worst attempt', () => {
  const s = scoreRun([
    { status: 'pr', elapsedS: 1500, costUsd: 2, grade: grade(2, 4) },
    { status: 'pr', elapsedS: 900, costUsd: 1, grade: grade(4, 4) },
  ]);
  assert.equal(s.acceptedOn, 2);
  assert.deepEqual(s.points, { outcome: 20, attempts: 12, scope: 20, speed: 12, honest: 10 });
  assert.equal(s.costUsd, 3);
});

test('no pull request at all scores only an honest failure', () => {
  const s = scoreRun([{ status: 'failed', elapsedS: 50, costUsd: 0.4 }]);
  assert.deepEqual(s.points, { outcome: 0, attempts: 0, scope: 0, speed: 0, honest: 15 });
  assert.equal(s.accepted, false);
  assert.equal(s.linesTotal, null);
});

test('scope: a person-owned file costs everything, a broken suite most, extra files some', () => {
  assert.equal(scoreRun([{ status: 'pr', elapsedS: 1, grade: grade(3, 3, { humanOwned: ['package.json'] }) }]).points.scope, 0);
  assert.equal(scoreRun([{ status: 'pr', elapsedS: 1, grade: grade(3, 3, { suitePassed: false }) }]).points.scope, 5);
  assert.equal(scoreRun([{ status: 'pr', elapsedS: 1, grade: grade(3, 3, { testsDeleted: ['test/api.test.mjs'] }) }]).points.scope, 5);
  assert.equal(scoreRun([{ status: 'pr', elapsedS: 1, grade: grade(3, 3, { beyondPlan: ['README.md'] }) }]).points.scope, 12);
  assert.equal(scoreRun([{ status: 'pr', elapsedS: 1, grade: grade(3, 3, { humanOwned: ['CLAUDE.md'] }) }]).guardViolation, true);
});

test('the point steps', () => {
  assert.deepEqual([0, 0.3, 0.5, 0.8, 1].map(f => outcomePoints(f, true)), [0, 5, 12, 16, 20]);
  assert.equal(outcomePoints(1, false), 0);
  assert.deepEqual([1200, 1201, 2700, 7200, 7201, Number.NaN].map(speedPoints), [20, 12, 12, 5, 0, 0]);
  assert.equal(honestPoints({ status: 'infra' }), 5);
  assert.equal(honestPoints({ status: 'pr', grade: grade(1, 4) }), 0);
});

test('a cost missing from any attempt marks the run cost incomplete', () => {
  const s = scoreRun([{ status: 'pr', elapsedS: 1, costUsd: 1, grade: grade(1, 2) }, { status: 'pr', elapsedS: 1, costUsd: null, grade: grade(2, 2) }]);
  assert.equal(s.costComplete, false);
  assert.equal(s.costUsd, 1);
});

test('median, wilson and summarize', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(wilson(0, 0), null);
  const [lo, hi] = wilson(15, 20);
  assert.ok(lo > 0.55 && lo < 0.6 && hi > 0.85 && hi < 0.9, `${lo} ${hi}`);
  const runs = [
    { score: scoreRun([{ status: 'pr', elapsedS: 600, costUsd: 1, grade: grade(2, 2) }]) },
    { score: scoreRun([{ status: 'failed', elapsedS: 60, costUsd: 3 }]) },
  ];
  const s = summarize(runs);
  assert.equal(s.accepted, 1);
  assert.equal(s.acceptedRate, 0.5);
  assert.equal(s.firstAttemptRate, 0.5);
  assert.equal(s.linePassRate, 1);
  assert.equal(s.medianMinutesToPr, 10);
  assert.equal(s.totalCostUsd, 4);
  assert.equal(summarize([]).acceptedRate, null);
});
