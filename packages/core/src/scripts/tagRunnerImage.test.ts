/**
 * `scripts/tag-runner-image.sh` — the Release workflow's step that gives a
 * release its runner image tag (`vocion-runner:vX.Y.Z`) — run for real
 * against a throwaway git history, with fake `gh` and `docker` binaries
 * standing in for the Actions API and the registry. The fakes log every call,
 * so the tests assert what the script would have done to the registry.
 *
 * The history, oldest first:
 *
 *   c1  packages/runner = "one"     built, published
 *   c2  docs only                   ← v1.0.0
 *   c3  packages/runner = "two"     built (or not, per test)
 *   c4  docs only                   ← v1.1.0
 *   c5  packages/runner = "one"     a revert of c3, never built  ← v1.2.0
 */
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('../../../../scripts/tag-runner-image.sh', import.meta.url));
const hasTools = ['bash', 'git', 'jq'].every(tool => spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0);

const IMAGE = 'ghcr.io/northwind/vocion-runner';
const HERMETIC_GIT = ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=', '-c', 'init.defaultBranch=main', '-c', 'user.email=test@example.com', '-c', 'user.name=Test'];

const FAKE_GH = `#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_LOG"
case "$1 $2" in
  "run list")
    expr=""
    while [ $# -gt 0 ]; do
      if [ "$1" = "--jq" ]; then expr="$2"; shift; fi
      shift
    done
    jq -r "$expr" "$FAKE_RUNS"
    ;;
  "run watch")
    # The build finishes while it is watched.
    if [ -f "$FAKE_RUNS_AFTER_WATCH" ]; then cp "$FAKE_RUNS_AFTER_WATCH" "$FAKE_RUNS"; fi
    ;;
  "workflow run") exit "\${FAKE_DISPATCH_EXIT:-0}" ;;
  *) echo "fake gh: unexpected $*" >&2; exit 2 ;;
esac
`;

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$1 $2 $3" in
  "buildx imagetools inspect") grep -qxF "$4" "$FAKE_REGISTRY" ;;
  "buildx imagetools create") exit 0 ;;
  *) echo "fake docker: unexpected $*" >&2; exit 2 ;;
esac
`;

type Run = { databaseId: number; status: string; conclusion: string | null; event: string; headSha: string };

let dir: string;
let repo: string;
let bin: string;
const sha: Record<'c1' | 'c2' | 'c3' | 'c4' | 'c5', string> = { c1: '', c2: '', c3: '', c4: '', c5: '' };

function git(...args: string[]): string {
  return execFileSync('git', [...HERMETIC_GIT, ...args], { cwd: repo }).toString().trim();
}

function commit(name: keyof typeof sha, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', name);
  sha[name] = git('rev-parse', 'HEAD');
}

beforeAll(() => {
  if (!hasTools) {
    return;
  }
  dir = mkdtempSync(join(tmpdir(), 'tag-runner-image-'));
  repo = join(dir, 'repo');
  bin = join(dir, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER);
  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'docker'), 0o755);
  git('init', '-q');
  commit('c1', { 'packages/runner/Dockerfile': 'one\n' });
  commit('c2', { 'docs/a.md': 'a\n' });
  git('tag', 'v1.0.0');
  commit('c3', { 'packages/runner/Dockerfile': 'two\n' });
  commit('c4', { 'docs/a.md': 'b\n' });
  git('tag', 'v1.1.0');
  commit('c5', { 'packages/runner/Dockerfile': 'one\n' });
  git('tag', 'v1.2.0');
});

let id = 0;
function build(at: string, status = 'completed', conclusion: string | null = 'success', event = 'push'): Run {
  id += 1;
  return { databaseId: id, status, conclusion, event, headSha: at };
}

beforeEach(() => {
  if (!hasTools) {
    return;
  }
  for (const f of ['runs.json', 'runs-after-watch.json', 'registry', 'calls.log', 'summary.md']) {
    rmSync(join(dir, f), { force: true });
  }
  writeFileSync(join(dir, 'calls.log'), '');
  writeFileSync(join(dir, 'summary.md'), '');
});

afterAll(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * What gh lists and the registry holds for one test.
 * @param runs - The Runner image runs, newest first.
 * @param registry - The commits whose `sha-` image is in the registry.
 * @param afterWatch - The runs once a watched build has finished.
 */
function given(runs: Run[], registry: string[], afterWatch?: Run[]): void {
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
  writeFileSync(join(dir, 'registry'), `${registry.map(s => `${IMAGE}:sha-${s}`).join('\n')}\n`);
  if (afterWatch) {
    writeFileSync(join(dir, 'runs-after-watch.json'), JSON.stringify(afterWatch));
  }
}

async function tag(release: string, env: Record<string, string> = {}): Promise<{ code: number; out: string; calls: string[]; summary: string }> {
  const merged: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: process.env.HOME ?? '',
    FAKE_LOG: join(dir, 'calls.log'),
    FAKE_RUNS: join(dir, 'runs.json'),
    FAKE_RUNS_AFTER_WATCH: join(dir, 'runs-after-watch.json'),
    FAKE_REGISTRY: join(dir, 'registry'),
    GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
    TAG: release,
    IMAGE,
    REPO: 'northwind/vocion-core',
    ...env,
  };
  let code = 0;
  let out = '';
  try {
    const { stdout, stderr } = await run('bash', [SCRIPT], { cwd: repo, env: merged, timeout: 20_000 });
    out = stdout + stderr;
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    code = typeof e.code === 'number' ? e.code : -1;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const log = join(dir, 'calls.log');
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { code, out, calls, summary: readFileSync(join(dir, 'summary.md'), 'utf8') };
}

const created = (calls: string[]) => calls.filter(c => c.startsWith('docker buildx imagetools create'));
const dispatched = (calls: string[]) => calls.filter(c => c.startsWith('gh workflow run'));

describe.skipIf(!hasTools)('tag-runner-image.sh', () => {
  it('points the release at the newest published image of its runner source', async () => {
    given([build(sha.c3), build(sha.c1)], [sha.c1, sha.c3]);

    const { code, calls, summary } = await tag('v1.1.0');

    expect(code).toBe(0);
    expect(created(calls)).toEqual([`docker buildx imagetools create --tag ${IMAGE}:v1.1.0 ${IMAGE}:sha-${sha.c3}`]);
    expect(dispatched(calls)).toEqual([]);
    expect(summary).toContain(`\`${IMAGE}:v1.1.0\` now points at \`${IMAGE}:sha-${sha.c3}\``);
  });

  it('never takes an image built after the release', async () => {
    given([build(sha.c3), build(sha.c1)], [sha.c1, sha.c3]);

    const { code, calls } = await tag('v1.0.0');

    expect(code).toBe(0);
    expect(created(calls)).toEqual([`docker buildx imagetools create --tag ${IMAGE}:v1.0.0 ${IMAGE}:sha-${sha.c1}`]);
  });

  it('takes an older image whose runner source is identical, as after a revert', async () => {
    // c5 reverted c3's runner change and was never built: c3's image is newer but is not v1.2.0's runner.
    given([build(sha.c3), build(sha.c1)], [sha.c1, sha.c3]);

    const { code, calls } = await tag('v1.2.0');

    expect(code).toBe(0);
    expect(created(calls)).toEqual([`docker buildx imagetools create --tag ${IMAGE}:v1.2.0 ${IMAGE}:sha-${sha.c1}`]);
  });

  it('waits for the release\'s own runner build to finish, then names it', async () => {
    given([build(sha.c3, 'in_progress', null), build(sha.c1)], [sha.c1, sha.c3], [build(sha.c3), build(sha.c1)]);

    const { code, out, calls } = await tag('v1.1.0');

    expect(code).toBe(0);
    expect(out).toContain(`waiting for the Runner image build of ${sha.c3.slice(0, 12)}`);
    expect(calls.some(c => c.startsWith('gh run watch '))).toBe(true);
    expect(created(calls)).toEqual([`docker buildx imagetools create --tag ${IMAGE}:v1.1.0 ${IMAGE}:sha-${sha.c3}`]);
  });

  it('does not wait on a build of a commit after the release', async () => {
    given([build(sha.c5, 'in_progress', null), build(sha.c1)], [sha.c1]);

    const { code, calls } = await tag('v1.0.0');

    expect(code).toBe(0);
    expect(calls.some(c => c.startsWith('gh run watch '))).toBe(false);
  });

  it('builds the release from its tag when its runner source was never published, rather than naming an older runner', async () => {
    // c3's build failed: c1's image exists but is not v1.1.0's runner.
    given([build(sha.c3, 'completed', 'failure'), build(sha.c1)], [sha.c1]);

    const { code, out, calls, summary } = await tag('v1.1.0');

    expect(code).toBe(0);
    expect(created(calls)).toEqual([]);
    expect(dispatched(calls)).toEqual(['gh workflow run runner-image.yml --repo northwind/vocion-core --ref v1.1.0']);
    expect(out).toContain('::warning::tag-runner-image: no published runner image has v1.1.0\'s packages/runner');
    expect(summary).toContain('dispatched `runner-image.yml` on `v1.1.0`');
  });

  it('counts only builds that pushed: a pull request\'s build of the same commit is not published', async () => {
    given([build(sha.c3, 'completed', 'success', 'pull_request'), build(sha.c1)], [sha.c1]);

    const { calls } = await tag('v1.1.0');

    expect(created(calls)).toEqual([]);
    expect(dispatched(calls)).toHaveLength(1);
  });

  it('looks past a successful build whose image is no longer in the registry', async () => {
    given([build(sha.c3), build(sha.c1)], [sha.c1]);

    const { out, calls } = await tag('v1.1.0');

    expect(out).toContain(`${IMAGE}:sha-${sha.c3} is not in the registry`);
    expect(created(calls)).toEqual([]);
    expect(dispatched(calls)).toHaveLength(1);
  });

  it('fails, saying how to fix it, when told not to build', async () => {
    given([build(sha.c1)], [sha.c1]);

    const { code, out, calls } = await tag('v1.1.0', { DISPATCH: '0' });

    expect(code).toBe(1);
    expect(out).toContain('Dispatch runner-image.yml on v1.1.0 to build it.');
    expect(dispatched(calls)).toEqual([]);
  });

  it('fails when the build cannot be dispatched either', async () => {
    given([build(sha.c1)], [sha.c1]);

    const { code, out } = await tag('v1.1.0', { FAKE_DISPATCH_EXIT: '1' });

    expect(code).toBe(1);
    expect(out).toContain('and dispatching runner-image.yml on v1.1.0 failed');
  });

  it('refuses anything that is not a release tag before touching gh or the registry', async () => {
    given([build(sha.c1)], [sha.c1]);

    for (const bad of ['latest', 'v1.1.0;id', '1.1.0', '']) {
      const { code, out, calls } = await tag(bad);

      expect(code).toBe(1);
      expect(out).toContain('is not a release tag');
      expect(calls).toEqual([]);
    }
  });

  it('refuses a release tag the checkout does not have', async () => {
    given([build(sha.c1)], [sha.c1]);

    const { code, out } = await tag('v9.9.9');

    expect(code).toBe(1);
    expect(out).toContain('v9.9.9 is not a tag in this checkout');
  });
});
