import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findSymlinkProblems,
  formatProblems,
  parseStagedSymlinkPaths,
  pointsOutsideRepository,
  readTrackedSymlinks,
  runCheck,
  SYMLINK_GIT_MODE,
} from './check-tracked-symlinks';

/**
 * One `git ls-files --stage -z` record, built the way git writes it.
 * @param mode - Git file mode, e.g. `100644` or `120000`.
 * @param path - Repository-relative path the record names.
 */
function stagedRecord(mode: string, path: string): string {
  return `${mode} 0000000000000000000000000000000000000000 0\t${path}\0`;
}

describe('parseStagedSymlinkPaths', () => {
  it('returns nothing for an empty index', () => {
    expect(parseStagedSymlinkPaths('')).toEqual([]);
  });

  it('keeps symlinks and drops regular files', () => {
    const staged
      = stagedRecord('100644', 'package.json')
        + stagedRecord(SYMLINK_GIT_MODE, 'node_modules')
        + stagedRecord('100755', 'infra/aws/apply-migrations.sh');

    expect(parseStagedSymlinkPaths(staged)).toEqual(['node_modules']);
  });

  it('drops a gitlink, which is a submodule and not a symlink', () => {
    expect(parseStagedSymlinkPaths(stagedRecord('160000', 'vocion-core'))).toEqual([]);
  });

  it('keeps a path containing a newline intact', () => {
    // The whole reason for -z: a newline in a path would otherwise split one
    // record into two and hide the mode of the second half.
    const paths = parseStagedSymlinkPaths(stagedRecord(SYMLINK_GIT_MODE, 'odd\nname'));

    expect(paths).toEqual(['odd\nname']);
  });

  it('ignores a record with no tab separator', () => {
    expect(parseStagedSymlinkPaths('120000 deadbeef 0\0')).toEqual([]);
  });
});

describe('pointsOutsideRepository', () => {
  it('refuses an absolute target', () => {
    expect(pointsOutsideRepository('node_modules', '/Users/someone/vocion-core/node_modules')).toBe(true);
  });

  it('allows a sibling inside the repository', () => {
    expect(pointsOutsideRepository('packages/core/shared', '../shared')).toBe(false);
  });

  it('allows a target in the same directory', () => {
    expect(pointsOutsideRepository('docs/current.md', 'v2.md')).toBe(false);
  });

  it('allows a target that dips below the root and comes back', () => {
    expect(pointsOutsideRepository('packages/core/link', '../../scripts/build.mjs')).toBe(false);
  });

  it('refuses a target that walks past the root', () => {
    expect(pointsOutsideRepository('packages/core/link', '../../../outside')).toBe(true);
  });

  it('refuses a target that lands exactly on the parent of the root', () => {
    expect(pointsOutsideRepository('link', '..')).toBe(true);
  });
});

describe('findSymlinkProblems', () => {
  it('finds nothing in an index with no symlinks', () => {
    expect(findSymlinkProblems([])).toEqual([]);
  });

  it('reports the three node_modules links that reached main', () => {
    const problems = findSymlinkProblems([
      { path: 'node_modules', target: '/Users/someone/vocion-core/node_modules' },
      { path: 'packages/core/node_modules', target: '/Users/someone/vocion-core/packages/core/node_modules' },
      { path: 'packages/agent-runtime/node_modules', target: '/Users/someone/vocion-core/packages/agent-runtime/node_modules' },
    ]);

    expect(problems.map(problem => problem.path)).toEqual([
      'node_modules',
      'packages/core/node_modules',
      'packages/agent-runtime/node_modules',
    ]);
    expect(problems[0]?.reason).toContain('absolute target');
  });

  it('leaves a relative symlink inside the repository alone', () => {
    expect(findSymlinkProblems([{ path: 'docs/latest.md', target: 'v2.md' }])).toEqual([]);
  });

  it('gives an escaping relative target its own reason', () => {
    const problems = findSymlinkProblems([{ path: 'link', target: '../../elsewhere' }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('escapes the repository');
  });
});

describe('formatProblems', () => {
  it('returns an empty string when there is nothing to report', () => {
    expect(formatProblems([])).toBe('');
  });

  it('names the path, the target, and the command that removes it', () => {
    const report = formatProblems([
      { path: 'node_modules', target: '/Users/someone/node_modules', reason: 'absolute target' },
    ]);

    expect(report).toContain('node_modules -> /Users/someone/node_modules');
    expect(report).toContain('git rm --cached "node_modules"');
    expect(report).toContain('without a trailing slash');
  });

  it('counts the problems it found', () => {
    const report = formatProblems([
      { path: 'a', target: '/x', reason: 'absolute target' },
      { path: 'b', target: '/y', reason: 'absolute target' },
    ]);

    expect(report).toContain('2 committed symlink(s) refused');
  });
});

/**
 * A throwaway git repository holding one committed symlink, so the git-reading
 * half of this module is exercised for real rather than mocked. Returns its
 * path; the caller removes it.
 * @param target - What the committed symlink should point at.
 */
function buildRepositoryWithCommittedSymlink(target: string): string {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'vocion-symlink-check-'));
  const runGit = (...args: string[]) => execFileSync('git', args, { cwd: repositoryRoot });

  runGit('init', '--quiet');
  runGit('config', 'user.email', 'test@example.com');
  runGit('config', 'user.name', 'Test');
  writeFileSync(join(repositoryRoot, 'package.json'), '{}\n');
  symlinkSync(target, join(repositoryRoot, 'node_modules'));
  runGit('add', '--all');
  runGit('commit', '--quiet', '--message', 'committed symlink');

  return repositoryRoot;
}

describe('readTrackedSymlinks', () => {
  it('reads a committed symlink and the target it points at', () => {
    const repositoryRoot = buildRepositoryWithCommittedSymlink('/somewhere/else/node_modules');
    try {
      expect(readTrackedSymlinks(repositoryRoot)).toEqual([
        { path: 'node_modules', target: '/somewhere/else/node_modules' },
      ]);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});

describe('runCheck', () => {
  it('passes against this repository', () => {
    // Characterisation as much as assertion: it proves the git plumbing works
    // and that no committed symlink points outside the checkout right now.
    expect(runCheck()).toBe(0);
  });

  it('exits non-zero on a repository carrying an absolute symlink', () => {
    const repositoryRoot = buildRepositoryWithCommittedSymlink('/somewhere/else/node_modules');
    try {
      expect(runCheck(repositoryRoot)).toBe(1);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('passes on a repository whose symlink stays inside it', () => {
    const repositoryRoot = buildRepositoryWithCommittedSymlink('./package.json');
    try {
      expect(runCheck(repositoryRoot)).toBe(0);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});
