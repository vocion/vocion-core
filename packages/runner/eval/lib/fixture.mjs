// The fixture repository: eval/fixture/library-app is v1; v1 plus fixture/v2.patch is v2 (the
// features later walks built on had shipped). Built as a git repository with fixed authors and
// dates, so both commits have the same sha on every machine and a base_sha means one thing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EVAL_DIR } from './cases.mjs';

export const FIXTURE_SRC = path.join(EVAL_DIR, 'fixture', 'library-app');
export const V2_PATCH = path.join(EVAL_DIR, 'fixture', 'v2.patch');
export const V2_BRANCH = 'eval-fixture-v2';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Vocion Eval',
  GIT_AUTHOR_EMAIL: 'eval@vocion.invalid',
  GIT_COMMITTER_NAME: 'Vocion Eval',
  GIT_COMMITTER_EMAIL: 'eval@vocion.invalid',
  GIT_AUTHOR_DATE: '2026-10-01T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z',
};

/** Git config that answers an https credential prompt from GITHUB_TOKEN, the runner's way; never on disk. */
export function tokenAuth(env = process.env) {
  return env.GITHUB_TOKEN ? ['-c', 'credential.helper=', '-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'] : [];
}

export function git(cwd, args, opts = {}) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY, ...(opts.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: (opts.timeoutSeconds || 120) * 1000,
  }).trim();
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) {
      continue;
    }
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(a, b);
    } else {
      fs.copyFileSync(a, b);
      fs.chmodSync(b, 0o644);
    }
  }
}

/** Builds the fixture repository in `dir` (which must not exist). Returns its dir and the two shas. */
export function materializeFixture(dir) {
  if (fs.existsSync(dir)) {
    throw new Error(`${dir} already exists`);
  }
  copyTree(FIXTURE_SRC, dir);
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture v1']);
  const v1 = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', V2_BRANCH]);
  git(dir, ['apply', '--whitespace=nowarn', V2_PATCH]);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture v2: passcodes, downloads switch, archive and stars shipped']);
  const v2 = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']);
  return { dir, refs: { v1, v2 } };
}

/**
 * Pushes the fixture to a sandbox repository the runner can clone and open pull requests on: v1
 * as main, v2 as eval-fixture-v2. Never forces: a main that already holds something else is an
 * error naming what to do, because rewriting someone's main is not this tool's call.
 */
export function publishFixture(fixture, remoteUrl, env = process.env) {
  try {
    git(fixture.dir, [...tokenAuth(env), 'push', '-q', remoteUrl, `${fixture.refs.v1}:refs/heads/main`, `${fixture.refs.v2}:refs/heads/${V2_BRANCH}`], { timeoutSeconds: 300, env: { GIT_TERMINAL_PROMPT: '0', GITHUB_TOKEN: env.GITHUB_TOKEN || '' } });
  } catch (e) {
    throw new Error(`could not publish the fixture to ${remoteUrl}: ${String(e.stderr || e.message).trim().slice(-400)}. Use an empty sandbox repository, or one this tool published before.`);
  }
}
