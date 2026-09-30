import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// runner.mjs is the process itself (it runs main() on import), so it is checked as a program: it
// parses, and with nothing to do it says so and exits 0 without calling anything.
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'runner.mjs');

test('parses', () => {
  const r = spawnSync(process.execPath, ['--check', runner], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('with no Vocion and no local task, it says there is nothing to do and exits 0', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
  const env = { PATH: process.env.PATH, HOME: workspace, WORKSPACE: workspace, RUNNER_TARGET: 'local' };
  const r = spawnSync(process.execPath, [runner], { encoding: 'utf8', env, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines[0].phase, 'boot');
  assert.match(lines[0].worker, /^local-/);
  assert.ok(lines.some(l => l.phase === 'exit' && /VOCION_URL or VOCION_TOKEN missing/.test(l.note)));
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('a local contract that does not match the schema is refused before anything is cloned', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
  const env = { PATH: process.env.PATH, HOME: workspace, WORKSPACE: workspace, LOCAL_TASK_JSON: JSON.stringify({ task_id: 'x', allowedPaths: ['docs/**'] }) };
  const r = spawnSync(process.execPath, [runner], { encoding: 'utf8', env, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map(l => JSON.parse(l));
  const refused = lines.find(l => l.phase === 'contract.refused');
  assert.ok(refused, r.stdout);
  assert.ok(refused.problems.includes('allowedPaths is camelCase; the contract uses snake_case (write allowed_paths)'));
  assert.ok(!lines.some(l => l.phase === 'prepare' && /clone/.test(l.note || '')));
  fs.rmSync(workspace, { recursive: true, force: true });
});
