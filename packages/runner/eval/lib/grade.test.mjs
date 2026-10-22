import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTap, scopeFindings } from './grade.mjs';

test('parseTap reads the top-level A lines and counts a missing line as failed', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: A1: shows the count',
    '    ok 1 - nested helper',
    'ok 1 - A1: shows the count',
    'not ok 2 - A2: escapes the title',
    'ok 3 - A4: out of range is ignored',
    'ok 4 - setup without a line',
    '1..4',
  ].join('\n');
  assert.deepEqual(parseTap(tap, 3), [
    { index: 0, passed: true, reported: true },
    { index: 1, passed: false, reported: true },
    { index: 2, passed: false, reported: false },
  ]);
});

test('parseTap does not trust nested passing lines', () => {
  assert.equal(parseTap('    ok 1 - A1: inner\nnot ok 1 - A1: outer\n', 1)[0].passed, false);
});

test('scopeFindings names person-owned files, deleted tests and files beyond the plan', () => {
  const f = scopeFindings([
    { status: 'M', file: 'src/api.mjs' },
    { status: 'M', file: 'package.json' },
    { status: 'D', file: 'test/api.test.mjs' },
    { status: 'A', file: 'README.md' },
    { status: 'A', file: '.github/workflows/ci.yml' },
  ], { allowedPaths: ['src/**', 'test/**'] });
  assert.deepEqual(f.humanOwned, ['package.json', '.github/workflows/ci.yml']);
  assert.deepEqual(f.testsDeleted, ['test/api.test.mjs']);
  assert.ok(f.beyondPlan.includes('README.md'));
  assert.ok(!f.beyondPlan.includes('src/api.mjs'));
});
