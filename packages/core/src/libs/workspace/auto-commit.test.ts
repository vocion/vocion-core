import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoCommit } from './auto-commit';

/** Initialise a scratch repo with a committed context dir so we can stage edits. */
function scratchRepo(): { root: string; contextDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'cc-autocommit-'));
  execSync('git init -q -b main', { cwd: root });
  execSync('git config user.email test@example.com', { cwd: root });
  execSync('git config user.name test', { cwd: root });
  const contextDir = join(root, 'workspace');
  execSync(`mkdir -p ${contextDir}`);
  writeFileSync(join(contextDir, 'README.md'), '# context\n');
  execSync('git add -A', { cwd: root });
  execSync('git commit -q -m initial', { cwd: root });
  return { root, contextDir };
}

describe('autoCommit', () => {
  it('commits pending changes and returns the new sha', () => {
    const { root, contextDir } = scratchRepo();
    try {
      writeFileSync(join(contextDir, 'new.md'), 'hi\n');

      const result = autoCommit({ contextPath: contextDir, summary: 'add new.md' });

      expect(result.committed).toBe(true);
      expect(result.sha).toMatch(/^[a-f0-9]{12}$/);
      expect(result.filesChanged).toContain('workspace/new.md');

      const log = execSync('git log --oneline', { cwd: root, encoding: 'utf8' });

      expect(log).toContain('chore(context): add new.md');
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it('no-ops when there are no pending changes', () => {
    const { root, contextDir } = scratchRepo();
    try {
      const result = autoCommit({ contextPath: contextDir, summary: 'nothing to do' });

      expect(result.committed).toBe(false);
      expect(result.reason).toBe('no changes');
      expect(result.filesChanged).toHaveLength(0);
      expect(result.sha).toMatch(/^[a-f0-9]{12}$/);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it('skips explicitly when skip=true', () => {
    const { root, contextDir } = scratchRepo();
    try {
      writeFileSync(join(contextDir, 'stash.md'), 'unstaged\n');

      const result = autoCommit({ contextPath: contextDir, summary: 'should-be-skipped', skip: true });

      expect(result.committed).toBe(false);
      expect(result.reason).toBe('skipped');

      const status = execSync('git status --porcelain workspace/', { cwd: root, encoding: 'utf8' });

      expect(status).toContain('stash.md');
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it('does not stage anything outside the context path', () => {
    const { root, contextDir } = scratchRepo();
    try {
      writeFileSync(join(contextDir, 'a.md'), 'in-scope\n');
      writeFileSync(join(root, 'outside.txt'), 'out-of-scope\n');

      autoCommit({ contextPath: contextDir, summary: 'scoped commit' });

      const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' });

      expect(status).toContain('outside.txt');
      expect(status).not.toContain('workspace/a.md');
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it('reports not-a-git-repo gracefully', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-nogit-'));
    try {
      writeFileSync(join(dir, 'file.md'), 'x');
      const result = autoCommit({ contextPath: dir, summary: 'nope' });

      expect(result.committed).toBe(false);
      expect(result.reason).toBe('not a git repo');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
