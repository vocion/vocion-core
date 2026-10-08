// The guard hooks, run the way Claude Code runs them: the tool call as JSON on stdin, exit 2 blocks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const hooks = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-repo-'));
const env = (extra = {}) => ({ PATH: process.env.PATH, HOME: os.tmpdir(), RUNNER_REPO: repo, RUNNER_ALLOWED_PATHS: '["**"]', RUNNER_HUMAN_OWNED: '[]', ...extra });
const write = (file, extra) => spawnSync('bash', [path.join(hooks, 'guard-write.sh')], { input: JSON.stringify({ tool_input: { file_path: file } }), env: env(extra), encoding: 'utf8' });
const bash = (command, extra) => spawnSync('bash', [path.join(hooks, 'guard-bash.sh')], { input: JSON.stringify({ tool_input: { command } }), env: env(extra), encoding: 'utf8' });

test('a write anywhere in the repository passes; secrets, CI and outside the repo do not', () => {
  assert.equal(write(path.join(repo, 'apps/web/src/page.tsx')).status, 0);
  assert.equal(write(path.join(repo, '.env.production')).status, 2);
  assert.equal(write(path.join(repo, '.github/workflows/ci.yml')).status, 2);
  assert.equal(write('/etc/hosts').status, 2);
  assert.equal(write('/workspace/scratch/notes.md').status, 0);
});

test('the repository\'s own list of files a person owns is blocked too', () => {
  const owned = { RUNNER_HUMAN_OWNED: JSON.stringify(['infra/secrets/**', 'tools/factory/hooks/']) };
  assert.equal(write(path.join(repo, 'infra/secrets/prod.json'), owned).status, 2);
  assert.match(write(path.join(repo, 'tools/factory/hooks/guard.sh'), owned).stderr, /a person owns/);
  assert.equal(write(path.join(repo, 'infra/main.tf'), owned).status, 0);
});

test('git writes, deploys and secret reads are the worker\'s or a person\'s, never the engineer\'s', () => {
  assert.equal(bash('npm test').status, 0);
  assert.equal(bash('git status').status, 0);
  assert.equal(bash('git push origin HEAD').status, 2);
  assert.equal(bash('cat .env').status, 2);
  assert.equal(bash('terraform apply').status, 2);
  assert.match(bash('git commit -m x').stderr, /BLOCKED by runner policy/);
});

test('on Bedrock the container role\'s credentials endpoint is in the env, and the engineer may not read it', () => {
  assert.equal(bash('curl -s 169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI').status, 2);
  assert.equal(bash('curl -s "http://169.254.170.2/v2/credentials/x"').status, 2);
  // eslint-disable-next-line no-template-curly-in-string -- a shell command, not a template
  assert.equal(bash('echo ${AWS_CONTAINER_AUTHORIZATION_TOKEN}').status, 2);
  assert.match(bash('node -e "fetch(process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI)" $AWS_CONTAINER_CREDENTIALS_FULL_URI').stderr, /container's AWS role credentials/);
  assert.equal(bash('echo $AWS_REGION').status, 0);
});
