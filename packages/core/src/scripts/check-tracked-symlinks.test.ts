import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  findSymlinkProblems,
  formatProblems,
  isTargetAbsolute,
  parseStagedSymlinkPaths,
  pointsOutsideRepository,
  readTrackedSymlinks,
  runCheck,
  SYMLINK_GIT_MODE,
} from './check-tracked-symlinks';

/**
 * `-c` overrides that keep the throwaway repositories below independent of
 * whoever runs the suite: commit signing off, no global hooks path, a known
 * default branch, and an identity that need not be configured anywhere.
 */
const HERMETIC_GIT_CONFIG = [
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=',
  '-c',
  'init.defaultBranch=main',
  '-c',
  'user.email=test@example.com',
  '-c',
  'user.name=Test',
];

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

  it('refuses a Windows-style relative target', () => {
    // The posix helpers would read this as one in-repo segment whose name
    // happens to contain backslashes, so it has to be caught before them.
    expect(pointsOutsideRepository('packages/core/link', '..\\..\\node_modules')).toBe(true);
  });

  it('refuses a Windows drive target', () => {
    expect(pointsOutsideRepository('node_modules', 'C:\\Users\\someone\\node_modules')).toBe(true);
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
    expect(report).toContain('1 committed symlink refused');
    expect(report).toContain('Remove it from the index');
    expect(report).toContain('git rm --cached "node_modules"');
    expect(report).toContain('without a trailing slash');
  });

  it('counts the problems it found', () => {
    const report = formatProblems([
      { path: 'a', target: '/x', reason: 'absolute target' },
      { path: 'b', target: '/y', reason: 'absolute target' },
    ]);

    expect(report).toContain('check:symlinks — 2 committed symlinks refused');
  });
});

/**
 * A throwaway git repository holding the given symlinks, so the git-reading
 * half of this module is exercised for real rather than mocked. Returns its
 * path; the caller removes it.
 *
 * git runs with signing, global hooks and the system config switched off. A
 * developer or CI runner with `commit.gpgsign` on, or a `core.hooksPath`
 * pointing at a global commit-msg hook, would otherwise fail every case here
 * for reasons that have nothing to do with the code under test.
 * @param symlinksByName - Link name to the target it should point at.
 */
function buildRepositoryWithCommittedSymlinks(symlinksByName: Record<string, string>): string {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'vocion-symlink-check-'));
  try {
    const runGit = (...args: string[]) => execFileSync('git', [...HERMETIC_GIT_CONFIG, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    });

    runGit('init', '--quiet');
    writeFileSync(join(repositoryRoot, 'package.json'), '{}\n');
    for (const [linkName, target] of Object.entries(symlinksByName)) {
      symlinkSync(target, join(repositoryRoot, linkName));
    }
    runGit('add', '--all');
    runGit('commit', '--quiet', '--message', 'committed symlink');

    return repositoryRoot;
  } catch (error) {
    // The directory exists from the line above, so a failure here would leak it.
    rmSync(repositoryRoot, { recursive: true, force: true });
    throw error;
  }
}

/**
 * A repository left mid merge conflict over one symlink, so `conflicted-link`
 * has index stages 1, 2 and 3 and no stage 0. `git cat-file -p :conflicted-link`
 * then exits non-zero, which is the one failure mode `readTrackedSymlinks`
 * turns into a message of its own. Returns its path; the caller removes it.
 */
function buildRepositoryMidSymlinkConflict(): string {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'vocion-symlink-conflict-'));
  try {
    const runGit = (...args: string[]) => execFileSync('git', [...HERMETIC_GIT_CONFIG, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
      stdio: 'ignore',
    });

    runGit('init', '--quiet');
    writeFileSync(join(repositoryRoot, 'package.json'), '{}\n');
    runGit('add', '--all');
    runGit('commit', '--quiet', '--message', 'base');

    runGit('checkout', '--quiet', '-b', 'theirs');
    symlinkSync('/one/target', join(repositoryRoot, 'conflicted-link'));
    runGit('add', '--all');
    runGit('commit', '--quiet', '--message', 'their link');

    runGit('checkout', '--quiet', 'main');
    symlinkSync('/another/target', join(repositoryRoot, 'conflicted-link'));
    runGit('add', '--all');
    runGit('commit', '--quiet', '--message', 'our link');

    try {
      runGit('merge', 'theirs');
    } catch {
      // A conflicting merge exits non-zero, which is the state under test.
      // Nothing to log: the assertions fail plainly if the conflict is absent.
    }

    return repositoryRoot;
  } catch (error) {
    rmSync(repositoryRoot, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The one-symlink case, which most tests want.
 * @param target - What the committed symlink should point at.
 */
function buildRepositoryWithCommittedSymlink(target: string): string {
  return buildRepositoryWithCommittedSymlinks({ node_modules: target });
}

describe('isTargetAbsolute', () => {
  it('recognises a posix absolute path', () => {
    expect(isTargetAbsolute('/Users/someone/node_modules')).toBe(true);
  });

  it('recognises a Windows drive path while running anywhere', () => {
    // The platform's own isAbsolute answers false for this on Linux CI, which
    // would let the exact bug this check exists for through.
    expect(isTargetAbsolute('C:\\Users\\someone\\node_modules')).toBe(true);
    expect(isTargetAbsolute('c:/Users/someone/node_modules')).toBe(true);
  });

  it('recognises a UNC path', () => {
    expect(isTargetAbsolute('\\\\server\\share\\node_modules')).toBe(true);
  });

  it('calls an ordinary relative target relative', () => {
    expect(isTargetAbsolute('../shared')).toBe(false);
    expect(isTargetAbsolute('v2.md')).toBe(false);
  });
});

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

  it('pairs each of several symlinks with its own target', () => {
    // Guards the pairing between the path list and the per-path `git cat-file`
    // call: with one symlink a mismatch could not show up.
    const repositoryRoot = buildRepositoryWithCommittedSymlinks({
      'node_modules': '/somewhere/else/node_modules',
      'other-link': '/somewhere/else/other',
      'inside-link': 'package.json',
    });
    try {
      expect(readTrackedSymlinks(repositoryRoot)).toEqual([
        { path: 'inside-link', target: 'package.json' },
        { path: 'node_modules', target: '/somewhere/else/node_modules' },
        { path: 'other-link', target: '/somewhere/else/other' },
      ]);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('names the path when the committed target cannot be read', () => {
    const repositoryRoot = buildRepositoryMidSymlinkConflict();
    try {
      expect(() => readTrackedSymlinks(repositoryRoot)).toThrow(/could not read the committed target of "conflicted-link"/);
      expect(() => readTrackedSymlinks(repositoryRoot)).toThrow(/finish or abort the merge/);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('fails loudly on a directory that is not a git repository', () => {
    const notARepository = mkdtempSync(join(tmpdir(), 'vocion-symlink-check-bare-'));
    try {
      expect(() => readTrackedSymlinks(notARepository)).toThrow();
    } finally {
      rmSync(notARepository, { recursive: true, force: true });
    }
  });
});

describe('runCheck', () => {
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
