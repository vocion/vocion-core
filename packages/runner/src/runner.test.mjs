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

// A Vocion double: records every call, answers the installation claim with `claim` and everything
// else with `reply`.
async function fakeVocion(claim, reply = () => ({ run: { status: 'failed' } })) {
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
      res.end(JSON.stringify(reply(req.url, calls.length)));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(r => server.close(r)) };
}

function runRunner(env, args = []) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, ...args], { env: { PATH: process.env.PATH, HOME: workspace, WORKSPACE: workspace, POLL_EVERY_SECONDS: '1', ...env } });
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

const CLAIMED = { run: { id: 41, attempt: 1, kind: 'worker', input: { task: { task_id: 'x', allowedPaths: ['docs/**'] }, record: { type: 'work_item', id: 7 } } }, runToken: 'vrt_run-token-for-test', git: { token: 'repo-token-for-test', source: 'test' } };

test('the claim stage claims, writes the handoff, and makes no other call', async () => {
  const vocion = await fakeVocion(() => ({ status: 200, body: { ...CLAIMED, leaseExpiresAt: '2026-10-07T12:05:00.000Z' } }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-claim.'));
  const file = path.join(dir, 'claim.json');
  const r = await runRunner({ VOCION_URL: vocion.url, VOCION_RUNNER_TOKEN: 'vcn_runner_0a1b2c3d4e5f6a7b_scope', RUNNER_TARGET: 'on-box', GITHUB_TOKEN: 'fallback-push-token' }, ['--claim-to', file]);
  await vocion.close();
  assert.equal(r.code, 0);
  assert.deepEqual(vocion.calls.map(c => [c.path, c.auth]), [['/api/v1/runner/claim', 'Bearer vcn_runner_0a1b2c3d4e5f6a7b_scope']]);
  const handoff = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(handoff.run.id, 41);
  assert.equal(handoff.runToken, 'vrt_run-token-for-test');
  assert.equal(handoff.githubToken, 'repo-token-for-test');
  assert.equal(handoff.workerId, vocion.calls[0].body.workerId);
  assert.ok(r.lines.some(l => l.phase === 'handoff'));
  assert.ok(handoff.events.some(e => e.phase === 'claimed'));
});

test('the build stage picks up the handoff, deletes it, and makes every call with the run token as the claiming runner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-claim.'));
  const file = path.join(dir, 'claim.json');
  fs.writeFileSync(file, JSON.stringify({ ...CLAIMED, workerId: 'on-box-host-7-123', leaseExpiresAt: null, gitSource: 'test', githubToken: 'repo-token-for-test' }), { mode: 0o600 });
  const vocion = await fakeVocion(() => ({ status: 500 }));
  // No long-lived credential at all: what the entrypoint's exec leaves.
  const r = await runRunner({ VOCION_URL: vocion.url, VOCION_CLAIM_FILE: file, RUNNER_TARGET: 'on-box' });
  await vocion.close();
  assert.equal(r.code, 0);
  assert.equal(fs.existsSync(file), false);
  assert.ok(!vocion.calls.some(c => c.path === '/api/v1/runner/claim'));
  assert.ok(vocion.calls.some(c => c.path === '/api/v1/worker-runs/41/fail'), JSON.stringify(vocion.calls.map(c => c.path)));
  assert.ok(vocion.calls.every(c => c.auth === 'Bearer vrt_run-token-for-test'));
  assert.ok(vocion.calls.filter(c => c.path.startsWith('/api/v1/worker-runs/41/')).every(c => c.body.workerId === 'on-box-host-7-123'));
  assert.ok(r.lines.some(l => l.phase === 'claimed' && l.from === 'handoff'));
});

test('a heartbeat that hands back a fresh run token is the credential from the next call on', async () => {
  const vocion = await fakeVocion(() => ({ status: 200, body: CLAIMED }), url => (url.endsWith('/heartbeat') ? { runToken: 'vrt_renewed-token' } : { run: { status: 'failed' } }));
  const r = await runRunner({ VOCION_URL: vocion.url, VOCION_RUNNER_TOKEN: 'fleet-secret', RUNNER_TARGET: 'on-box' });
  await vocion.close();
  assert.equal(r.code, 0);
  const seen = JSON.stringify(vocion.calls.map(c => [c.path, c.auth]));
  // Beats already in flight carry the token they started with; the run's terminal call, made
  // after a beat came back, and everything after it carry the renewed one.
  const terminal = vocion.calls.findIndex(c => c.path === '/api/v1/worker-runs/41/fail');
  assert.ok(terminal > 0, seen);
  assert.equal(vocion.calls.find(c => c.path.endsWith('/heartbeat')).auth, 'Bearer vrt_run-token-for-test', seen);
  assert.ok(vocion.calls.slice(terminal).every(c => c.auth === 'Bearer vrt_renewed-token'), seen);
});

test('a container started for one run claims with its start token even when a runner token is also there', async () => {
  const vocion = await fakeVocion(() => ({ status: 204 }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-claim.'));
  const r = await runRunner({ VOCION_URL: vocion.url, VOCION_RUN_TOKEN: 'vrt_start-token-for-test', VOCION_RUNNER_TOKEN: 'fleet-secret', RUNNER_TARGET: 'aws-fargate', RUNNER_CLAIM_AFTER: '0', WORKER_RUN_ID: '41' }, ['--claim-to', path.join(dir, 'claim.json')]);
  await vocion.close();
  assert.equal(r.code, 0);
  assert.deepEqual(vocion.calls.map(c => [c.path, c.auth, c.body.runId]), [['/api/v1/runner/claim', 'Bearer vrt_start-token-for-test', 41]]);
  assert.equal(fs.existsSync(path.join(dir, 'claim.json')), false);
});

test('a refused claim is said once and the runner stops, rather than asking again for fifteen minutes', async () => {
  const vocion = await fakeVocion(() => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'This installation serves several accounts (VOCION_MULTI_TENANT=1), so the installation runner token claims nothing here.' } } }));
  const r = await runRunner({ VOCION_URL: vocion.url, VOCION_RUNNER_TOKEN: 'fleet-secret', RUNNER_TARGET: 'on-box', POLL_MAX_SECONDS: '60' });
  await vocion.close();
  assert.equal(r.code, 0);
  assert.equal(vocion.calls.length, 1);
  assert.ok(r.lines.some(l => l.phase === 'claim.refused' && l.status === 403 && /several accounts/.test(l.error.message)));
  assert.ok(r.lines.some(l => l.phase === 'exit' && /the claim was refused/.test(l.note)));
  assert.ok(!r.lines.some(l => l.phase === 'exit' && /no run for/.test(l.note)));
});

test('a refused claim idles RUNNER_IDLE_SECONDS before exiting, so a restarting service does not hammer the claim', async () => {
  const vocion = await fakeVocion(() => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'This runner token is not valid: it is unknown, revoked or expired.' } } }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-claim.'));
  const started = Date.now();
  const r = await runRunner({ VOCION_URL: vocion.url, VOCION_RUNNER_TOKEN: 'vcn_runner_0a1b2c3d4e5f6a7b_revoked', RUNNER_TARGET: 'on-box', RUNNER_IDLE_SECONDS: '2' }, ['--claim-to', path.join(dir, 'claim.json')]);
  await vocion.close();
  assert.equal(r.code, 0);
  assert.equal(vocion.calls.length, 1);
  assert.ok(Date.now() - started >= 2000);
  assert.equal(fs.existsSync(path.join(dir, 'claim.json')), false);
});

test('the claim stage\'s step-log lines reach Vocion from the build stage, ahead of its own', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-claim.'));
  const file = path.join(dir, 'claim.json');
  const events = [{ seq: 1, ts: '2026-10-07T12:00:00.000Z', phase: 'poll', message: 'claim as on-box' }, { seq: 2, ts: '2026-10-07T12:00:01.000Z', phase: 'claimed', fields: { target: 'on-box' } }];
  fs.writeFileSync(file, JSON.stringify({ ...CLAIMED, workerId: 'on-box-host-7-123', events }), { mode: 0o600 });
  const vocion = await fakeVocion(() => ({ status: 500 }));
  await runRunner({ VOCION_URL: vocion.url, VOCION_CLAIM_FILE: file, RUNNER_TARGET: 'on-box' });
  await vocion.close();
  const sent = vocion.calls.flatMap(c => c.body?.events || []);
  assert.deepEqual(sent.slice(0, 2).map(e => e.phase), ['poll', 'claimed']);
  assert.equal(sent[0].ts, '2026-10-07T12:00:00.000Z');
});
