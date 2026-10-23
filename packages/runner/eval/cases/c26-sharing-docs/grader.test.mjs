import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';

const file = 'docs/sharing.md';
const body = () => fs.readFileSync(file, 'utf8');

test('A1: headings in order with prose', () => {
  const lines = body().split('\n');
  const heads = lines.map((l, i) => [l.trim(), i]).filter(([l]) => l.startsWith('## '));
  assert.deepEqual(heads.map(([l]) => l), ['## Share links', '## Who can open a link', '## What a visitor sees']);
  for (const [, i] of heads) {
    const next = lines.slice(i + 1).find(l => l.trim());
    assert.ok(next && !next.trim().startsWith('#'), `prose after line ${i + 1}`);
  }
});

test('A2: the address and no account', () => {
  assert.match(body(), /\/l\/<link id>/);
  assert.match(body(), /no account/i);
});

test('A3: under 80 lines', () => {
  assert.ok(body().trimEnd().split('\n').length < 80);
});

test('A4: nothing else changed', () => {
  const base = process.env.EVAL_BASE_SHA || 'HEAD';
  const changed = execFileSync('git', ['diff', '--name-only', base, '--', '.', ':!.eval-grader'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', '.', ':!.eval-grader'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual([...new Set([...changed, ...untracked])], [file]);
});
