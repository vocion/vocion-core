import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNumstat } from './diffstat.mjs';

test('numstat sums lines across files, and a binary file counts with no lines', () => {
  const out = '12\t3\tsrc/app.ts\n-\t-\tpublic/logo.png\n0\t7\tsrc/old.ts\n';
  assert.deepEqual(parseNumstat(out), { files: 3, insertions: 12, deletions: 10 });
});

test('no output is an empty change', () => {
  assert.deepEqual(parseNumstat(''), { files: 0, insertions: 0, deletions: 0 });
  assert.deepEqual(parseNumstat(undefined), { files: 0, insertions: 0, deletions: 0 });
});
