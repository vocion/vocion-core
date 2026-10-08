// The handoff (Vocion 5.1): the process that builds a run, and so runs beside repository code, is
// started without any credential that can claim a run. Checked on the helpers and on the real
// entrypoint, run with a stand-in runner that reports the environment it was given.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { claimCredential, LONG_LIVED_ENV, readHandoff, scrubLongLived, writeHandoff } from './handoff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entrypoint = path.join(here, '..', 'entrypoint.sh');

test('the entrypoint unsets exactly the variables handoff.mjs names', () => {
  const line = fs.readFileSync(entrypoint, 'utf8').match(/^LONG_LIVED="([^"]+)"$/m);
  assert.ok(line, 'entrypoint.sh declares LONG_LIVED');
  assert.deepEqual(line[1].split(' '), LONG_LIVED_ENV);
});

test('a start token is the claim credential whenever a target put one in', () => {
  assert.deepEqual(claimCredential({ runToken: 'vrt_start', runnerToken: 'vcn_runner_a_b', vocionToken: 'vcn_live_c_d' }), { kind: 'start', token: 'vrt_start' });
  assert.deepEqual(claimCredential({ runToken: '', runnerToken: 'vcn_runner_a_b', vocionToken: 'vcn_live_c_d' }), { kind: 'runner', token: 'vcn_runner_a_b' });
  assert.deepEqual(claimCredential({ runToken: '', runnerToken: '', vocionToken: 'vcn_live_c_d' }), { kind: 'workspace', token: 'vcn_live_c_d' });
  assert.equal(claimCredential({ runToken: '', runnerToken: '', vocionToken: '' }), null);
});

test('the handoff file is private, never overwritten, and gone once read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-claim.'));
  const file = path.join(dir, 'claim.json');
  writeHandoff(file, { run: { id: 41 }, runToken: 'vrt_run', workerId: 'on-box-host-7' });

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => writeHandoff(file, { run: { id: 99 } }), /EEXIST/);
  assert.deepEqual(readHandoff(file), { run: { id: 41 }, runToken: 'vrt_run', workerId: 'on-box-host-7' });
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(dir), false);
  assert.throws(() => readHandoff(file), /ENOENT/);
});

test('a runner started by hand drops the claim credentials from what it spawns, and keeps its push credential', () => {
  const env = { VOCION_RUNNER_TOKEN: 'a', VOCION_RUN_TOKEN: 'b', VOCION_TOKEN: 'c', GITHUB_TOKEN: 'd', GH_TOKEN: 'd', ANTHROPIC_API_KEY: 'e' };
  scrubLongLived(env);
  assert.deepEqual(env, { GITHUB_TOKEN: 'd', GH_TOKEN: 'd', ANTHROPIC_API_KEY: 'e' });
});

/** A stand-in runner: the first stage writes a claim (or not); the second reports its environment. */
function standIn(claims) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-home-'));
  fs.mkdirSync(path.join(home, 'src'));
  fs.writeFileSync(path.join(home, 'src', 'runner.mjs'), `
import fs from 'node:fs';
const at = process.argv.indexOf('--claim-to');
if (at > 0) {
  ${claims ? `fs.writeFileSync(process.argv[at + 1], JSON.stringify({ run: { id: 41 }, runToken: 'vrt_run_only', workerId: 'w' }), { mode: 0o600 });` : ''}
  fs.appendFileSync(process.env.OUT, JSON.stringify({ stage: 'claim', env: process.env }) + '\\n');
} else {
  let proc = null;
  try { proc = fs.readFileSync('/proc/self/environ', 'utf8'); } catch {}
  fs.appendFileSync(process.env.OUT, JSON.stringify({ stage: 'build', env: process.env, proc, claim: JSON.parse(fs.readFileSync(process.env.VOCION_CLAIM_FILE, 'utf8')) }) + '\\n');
}
`);
  return home;
}

function runEntrypoint(home, extra) {
  const out = path.join(home, 'out.jsonl');
  const r = spawnSync('bash', [entrypoint], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, RUNNER_HOME: home, OUT: out, VOCION_URL: 'http://vocion.invalid', ...extra },
    timeout: 20000,
  });
  const stages = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  return { r, stages };
}

const SECRETS = { VOCION_RUNNER_TOKEN: 'vcn_runner_0a1b2c3d4e5f6a7b_scope-secret', VOCION_RUN_TOKEN: 'vrt_start-secret', VOCION_TOKEN: 'vcn_live_abc_workspace-secret', GITHUB_TOKEN: 'ghs_push-secret', ANTHROPIC_API_KEY: 'sk-ant-model-key' };

test('the entrypoint claims with the long-lived credential, then runs the build with none of them in its environment', () => {
  const home = standIn(true);
  const { r, stages } = runEntrypoint(home, SECRETS);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(stages.map(s => s.stage), ['claim', 'build']);
  // The claim stage held them...
  assert.equal(stages[0].env.VOCION_RUNNER_TOKEN, SECRETS.VOCION_RUNNER_TOKEN);
  // ...and the process that runs beside the repository holds none, not even in its start-up
  // environment (what /proc/<pid>/environ shows another process of the same user).
  const build = stages[1];
  for (const k of LONG_LIVED_ENV) {
    assert.equal(build.env[k], undefined, `${k} reached the build`);
  }
  const seen = JSON.stringify(build.env) + (build.proc ?? '');
  for (const secret of [SECRETS.VOCION_RUNNER_TOKEN, SECRETS.VOCION_RUN_TOKEN, SECRETS.VOCION_TOKEN, SECRETS.GITHUB_TOKEN]) {
    assert.ok(!seen.includes(secret), 'a long-lived secret is readable from the build process');
  }
  assert.equal(build.env.ANTHROPIC_API_KEY, SECRETS.ANTHROPIC_API_KEY);
  assert.deepEqual(build.claim, { run: { id: 41 }, runToken: 'vrt_run_only', workerId: 'w' });
  assert.match(build.env.VOCION_CLAIM_FILE, /vocion-claim\.[^/]+\/claim\.json$/);
});

test('with nothing claimed, the entrypoint exits 0 and never starts a build', () => {
  const home = standIn(false);
  const { r, stages } = runEntrypoint(home, SECRETS);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(stages.map(s => s.stage), ['claim']);
  assert.deepEqual(fs.readdirSync(home).filter(f => f.startsWith('vocion-claim.')), []);
});

test('a local task has no claim stage', () => {
  const home = standIn(true);
  const out = path.join(home, 'out.jsonl');
  fs.writeFileSync(path.join(home, 'src', 'runner.mjs'), `import fs from 'node:fs'; fs.appendFileSync(process.env.OUT, JSON.stringify({ stage: process.argv.includes('--claim-to') ? 'claim' : 'local' }) + '\\n');`);
  const r = spawnSync('bash', [entrypoint], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, RUNNER_HOME: home, OUT: out, LOCAL_TASK_JSON: '{}', VOCION_URL: 'http://vocion.invalid', VOCION_RUNNER_TOKEN: 'x' }, timeout: 20000 });

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l).stage), ['local']);
});
