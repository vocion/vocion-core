import assert from 'node:assert/strict';
// node --test packages/runner/src/stage.test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { stageablePaths } from './keep.mjs';

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// The h10 eval run: the engineer removed a file with `git rm`, and the land step's
// `git add -A -- <every changed path>` failed on it, so the work was never committed.
describe('stageablePaths (land and keep after a git rm)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-stage-'));
  git(dir, ['init', '-q']);
  fs.mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'lib', 'legacyDate.mjs'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'a\n');
  fs.writeFileSync(path.join(dir, 'src', 'gone.mjs'), 'g\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  // Removed with git rm (staged), edited, removed from disk only, and a new file.
  git(dir, ['rm', '-q', 'src/lib/legacyDate.mjs']);
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'b\n');
  fs.rmSync(path.join(dir, 'src', 'gone.mjs'));
  fs.writeFileSync(path.join(dir, 'src', 'new.mjs'), 'n\n');
  const changed = ['src/a.mjs', 'src/gone.mjs', 'src/lib/legacyDate.mjs', 'src/new.mjs'];
  const index = new Set(git(dir, ['ls-files', '-z']).out.split('\0').filter(Boolean));
  const onDisk = f => fs.existsSync(path.join(dir, f));

  it('the old call fails on the path git rm already staged', () => {
    const r = git(dir, ['add', '-A', '--', ...changed]);
    assert.equal(r.code, 128);
    assert.match(r.err, /pathspec 'src\/lib\/legacyDate.mjs' did not match any files/);
  });

  it('leaves out only the path in neither the tree nor the index', () => {
    assert.deepEqual(stageablePaths(changed, onDisk, f => index.has(f)), ['src/a.mjs', 'src/gone.mjs', 'src/new.mjs']);
  });

  it('stages and commits every change, the git rm included', () => {
    const r = git(dir, ['add', '-A', '--', ...stageablePaths(changed, onDisk, f => index.has(f))]);
    assert.equal(r.code, 0, r.err);
    assert.equal(git(dir, ['commit', '-q', '-m', 'work']).code, 0);
    const shown = git(dir, ['show', '--name-status', '--format=', 'HEAD']).out.trim().split('\n').sort();
    assert.deepEqual(shown, ['A\tsrc/new.mjs', 'D\tsrc/gone.mjs', 'D\tsrc/lib/legacyDate.mjs', 'M\tsrc/a.mjs']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
