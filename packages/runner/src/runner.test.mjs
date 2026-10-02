import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
  assert.ok(lines.some(l => l.phase === 'exit' && /VOCION_URL, or VOCION_RUNNER_TOKEN \/ VOCION_TOKEN, missing/.test(l.note)));
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

// A Vocion double: records every call, answers the installation claim with `claim`.
async function fakeVocion(claim) {
  const http = await import('node:http');
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      if (req.url === '/api/v1/runner/claim') {
        const r = claim(calls.length);
        res.writeHead(r.status, { 'content-type': 'application/json' });
        res.end(r.body ? JSON.stringify(r.body) : '');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ run: { status: 'failed' } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(r => server.close(r)) };
}

function runRunner(env) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner], { env: { PATH: process.env.PATH, HOME: workspace, WORKSPACE: workspace, POLL_EVERY_SECONDS: '1', ...env } });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('close', code => resolve({ code, lines: out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) }));
  });
}

test('installation mode: claims as its target, waits RUNNER_CLAIM_AFTER, and says when the run it was started for is gone', async () => {
  const vocion = await fakeVocion(() => ({ status: 204 }));
  const r = await runRunner({ VOCION_URL: vocion.url, VOCION_RUNNER_TOKEN: 'fleet-secret', RUNNER_TARGET: 'aws-fargate', RUNNER_CLAIM_AFTER: '0', WORKER_RUN_ID: '41' });
  await vocion.close();
  assert.equal(r.code, 0);
  assert.deepEqual(vocion.calls.map(c => c.path), ['/api/v1/runner/claim']);
  assert.equal(vocion.calls[0].auth, 'Bearer fleet-secret');
  const { target, claimAfterSeconds, runId, workerId } = vocion.calls[0].body;
  assert.deepEqual({ target, claimAfterSeconds, runId }, { target: 'aws-fargate', claimAfterSeconds: 0, runId: 41 });
  assert.match(workerId, /^aws-fargate-/);
  assert.ok(r.lines.some(l => l.phase === 'exit' && /run 41 is not this runner's to take/.test(l.note)));
});

test('installation mode: every call about the claimed run carries the run token, never the installation token', async () => {
  const vocion = await fakeVocion(() => ({ status: 200, body: { run: { id: 41, attempt: 1, kind: 'worker', input: { task: { task_id: 'x', allowedPaths: ['docs/**'] }, record: { type: 'work_item', id: 7 } } }, runToken: 'vrt_run-token-for-test', git: { token: 'repo-token-for-test', source: 'test' } } }));
  const r = await runRunner({ VOCION_URL: vocion.url, VOCION_RUNNER_TOKEN: 'fleet-secret', RUNNER_TARGET: 'on-box' });
  await vocion.close();
  assert.equal(r.code, 0);
  const after = vocion.calls.slice(1);
  assert.ok(after.some(c => c.path === '/api/v1/worker-runs/41/fail'), JSON.stringify(vocion.calls.map(c => c.path)));
  assert.ok(after.every(c => c.auth === 'Bearer vrt_run-token-for-test'));
  assert.ok(r.lines.some(l => l.phase === 'claimed' && l.target === 'on-box' && l.git === 'test'));
  assert.ok(r.lines.some(l => l.phase === 'contract.refused'));
});
