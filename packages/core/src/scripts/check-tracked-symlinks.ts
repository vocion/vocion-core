/**
 * Refuse a symlink that has been committed to the repository.
 *
 * Three `node_modules` symlinks reached `main` in PR #221, each pointing at an
 * absolute path on one laptop:
 *
 *     node_modules -> /Users/<someone>/.../vocion-core/node_modules
 *
 * They got in because `.gitignore` said `node_modules/` — with the trailing
 * slash, which matches a directory and not a symlink that happens to be named
 * `node_modules`. A worktree with its dependencies symlinked in, plus one
 * `git add -A`, is all it takes. Nothing in CI noticed, and a fresh clone then
 * carries three dead links where npm expects to install.
 *
 * Dropping the trailing slash fixes that one case. This check is the part that
 * keeps it fixed, and it is deliberately broader than `node_modules`: any
 * committed symlink pointing outside the repository is a path that exists on
 * exactly one machine, so it is broken everywhere else. A relative symlink that
 * stays inside the repository is fine and stays allowed — those are real, and
 * this repo may want them.
 *
 * The check reads `git ls-files --stage`, not the filesystem: it asks what is
 * committed, which is the thing that travels to another checkout. Mode
 * `120000` is git's mode for a symlink.
 *
 * Run: npm run check:symlinks
 */

import { execFileSync } from 'node:child_process';
import { isAbsolute, posix, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fromRepoRoot } from '../libs/repo-root';

/** Git's file mode for a symlink, as it appears in `git ls-files --stage`. */
export const SYMLINK_GIT_MODE = '120000';

/** One committed symlink, as read out of the git index. */
export type TrackedSymlink = {
  /** Repository-relative path of the symlink itself. */
  path: string;
  /** What the symlink points at, verbatim as committed. */
  target: string;
};

/** One committed symlink this check refuses, with the reason to print. */
export type SymlinkProblem = {
  path: string;
  target: string;
  reason: string;
};

/**
 * Parse `git ls-files --stage -z` output into the symlinks it lists.
 *
 * Each record is `<mode> <sha> <stage>\t<path>`, separated by NUL bytes so a
 * path containing a newline cannot split one record into two. Non-symlink modes
 * are dropped here, so callers only ever see symlinks.
 * @param stagedOutput - Raw NUL-separated output of `git ls-files --stage -z`.
 */
export function parseStagedSymlinkPaths(stagedOutput: string): string[] {
  const paths: string[] = [];
  for (const record of stagedOutput.split('\0')) {
    if (record === '') {
      continue;
    }
    const tabIndex = record.indexOf('\t');
    if (tabIndex === -1) {
      continue;
    }
    const mode = record.slice(0, record.indexOf(' '));
    if (mode !== SYMLINK_GIT_MODE) {
      continue;
    }
    paths.push(record.slice(tabIndex + 1));
  }
  return paths;
}

/**
 * Whether a symlink's committed target stays inside the repository.
 *
 * An absolute target never does — it names a location on one machine. A
 * relative target is resolved against the directory holding the symlink, and
 * only counts as inside when the result is still under the repository root.
 * @param symlinkPath - Repository-relative path of the symlink itself.
 * @param target - The symlink's committed target, absolute or relative.
 */
export function pointsOutsideRepository(symlinkPath: string, target: string): boolean {
  if (isAbsolute(target)) {
    return true;
  }
  // Both paths are repository-relative and always use forward slashes, because
  // that is how git stores them on every platform — so normalise with the posix
  // helpers rather than the host's. A result that still begins with `..` has
  // walked up past the repository root.
  const linkDirectory = posix.dirname(symlinkPath);
  const resolvedTarget = posix.normalize(posix.join(linkDirectory, target));
  return resolvedTarget === '..' || resolvedTarget.startsWith('../');
}

/**
 * The committed symlinks this check refuses, in the order given.
 * @param symlinks - Every committed symlink read out of the index.
 */
export function findSymlinkProblems(symlinks: TrackedSymlink[]): SymlinkProblem[] {
  const problems: SymlinkProblem[] = [];
  for (const symlink of symlinks) {
    if (!pointsOutsideRepository(symlink.path, symlink.target)) {
      continue;
    }
    const reason = isAbsolute(symlink.target)
      ? 'absolute target — this path exists on one machine and is a dead link in every other checkout'
      : 'target escapes the repository — it resolves to a path no other checkout has';
    problems.push({ path: symlink.path, target: symlink.target, reason });
  }
  return problems;
}

/**
 * Human-readable report for the problems found, or an empty string for none.
 * @param problems - The refused symlinks to describe.
 */
export function formatProblems(problems: SymlinkProblem[]): string {
  if (problems.length === 0) {
    return '';
  }
  const lines = ['', `  ${problems.length} committed symlink(s) refused:`, ''];
  for (const problem of problems) {
    lines.push(`  ✗ ${problem.path} -> ${problem.target}`);
    lines.push(`      ${problem.reason}`);
  }
  lines.push('');
  lines.push('  Remove it from the index and let .gitignore cover it:');
  lines.push('');
  for (const problem of problems) {
    lines.push(`      git rm --cached "${problem.path}"`);
  }
  lines.push('');
  lines.push('  If the path is a dependency directory, check that .gitignore names it');
  lines.push('  without a trailing slash — `node_modules/` does not match a symlink.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Read every committed symlink and what it points at.
 *
 * The path list and the targets come from two git calls rather than one: the
 * index stores a symlink's target as the blob's content, so `git cat-file` is
 * what reads it. `git` runs with the repository root as its working directory
 * so the command works from anywhere.
 * @param repositoryRoot - Directory to run git in; defaults to this checkout.
 */
export function readTrackedSymlinks(repositoryRoot: string = fromRepoRoot('.')): TrackedSymlink[] {
  const stagedOutput = execFileSync('git', ['ls-files', '--stage', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const symlinks: TrackedSymlink[] = [];
  for (const symlinkPath of parseStagedSymlinkPaths(stagedOutput)) {
    const target = execFileSync('git', ['cat-file', '-p', `:${symlinkPath}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    symlinks.push({ path: symlinkPath, target: target.trim() });
  }
  return symlinks;
}

/**
 * CLI entrypoint: print any problems and return the process exit code.
 * @param repositoryRoot - Directory to run git in; defaults to this checkout.
 */
export function runCheck(repositoryRoot: string = fromRepoRoot('.')): number {
  const symlinks = readTrackedSymlinks(repositoryRoot);
  const problems = findSymlinkProblems(symlinks);

  if (problems.length > 0) {
    process.stderr.write(formatProblems(problems));
    return 1;
  }

  process.stdout.write(
    `check:symlinks — ${symlinks.length} committed symlink(s), none pointing outside the repository.\n`,
  );
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exit(runCheck());
}
