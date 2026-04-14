import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

/**
 * Stage and commit any pending changes under `contextPath`.
 *
 * Design:
 *  - No-op when nothing changed (returns the current HEAD SHA).
 *  - Commits only files under `contextPath` — never stages or commits
 *    anything outside the context dir.
 *  - Commit message convention: first line = short summary from the
 *    `summary` arg; body = file list.
 *  - Skips hooks via plain `git commit` (but we DO NOT pass --no-verify).
 *    If a hook fails, the error surfaces and the caller can decide.
 *  - Silently skips when the path is not inside a git repo (non-git
 *    deployments — the context_version row still records a content SHA).
 */
export type AutoCommitInput = {
  contextPath: string;
  summary: string;
  author?: string; // "Name <email>" — optional override
  skip?: boolean; // explicit opt-out; default is to commit
};

export type AutoCommitResult = {
  sha: string | null;
  committed: boolean;
  filesChanged: string[];
  reason?: string;
};

export function autoCommit(input: AutoCommitInput): AutoCommitResult {
  if (input.skip) {
    return { sha: currentHeadSha(input.contextPath), committed: false, filesChanged: [], reason: 'skipped' };
  }

  const absResolved = resolve(input.contextPath);
  if (!existsSync(absResolved)) {
    return { sha: null, committed: false, filesChanged: [], reason: 'path does not exist' };
  }

  // Canonicalise both sides so relative() works when macOS hands us /var -> /private/var.
  const abs = realpathSync(absResolved);

  if (!isInsideGitRepo(abs)) {
    return { sha: null, committed: false, filesChanged: [], reason: 'not a git repo' };
  }

  const repoRoot = realpathSync(getRepoRoot(abs));
  const pathInRepo = relative(repoRoot, abs) || '.';

  const filesChanged = git(`status --porcelain -- ${quote(pathInRepo)}`, repoRoot)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[MADRCU?! ]{1,2}\s+/, ''));

  if (filesChanged.length === 0) {
    return { sha: currentHeadSha(abs), committed: false, filesChanged: [], reason: 'no changes' };
  }

  git(`add -- ${quote(pathInRepo)}`, repoRoot);

  const message = buildMessage(input.summary, filesChanged);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (input.author) {
    const openIdx = input.author.indexOf('<');
    const closeIdx = input.author.lastIndexOf('>');
    if (openIdx > 0 && closeIdx > openIdx) {
      const name = input.author.slice(0, openIdx).trim();
      const email = input.author.slice(openIdx + 1, closeIdx).trim();
      if (name && email) {
        env.GIT_AUTHOR_NAME = name;
        env.GIT_AUTHOR_EMAIL = email;
        env.GIT_COMMITTER_NAME = name;
        env.GIT_COMMITTER_EMAIL = email;
      }
    }
  }

  // Pass message via stdin to avoid shell-quoting pitfalls with user-supplied strings.
  execSync(`git commit -F -`, { cwd: repoRoot, env, input: message });

  return {
    sha: currentHeadSha(abs),
    committed: true,
    filesChanged,
  };
}

export function currentHeadSha(path: string): string | null {
  if (!isInsideGitRepo(path)) {
    return null;
  }
  try {
    return git('rev-parse --short=12 HEAD', path);
  } catch {
    return null;
  }
}

function buildMessage(summary: string, files: string[]): string {
  // Conform to conventional commits (commitlint): `chore(context): <summary>`.
  const header = `chore(context): ${summary}`.slice(0, 100);
  const body = files.map(f => `  - ${f}`).join('\n');
  return `${header}\n\n${body}\n`;
}

function isInsideGitRepo(path: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: path,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function getRepoRoot(path: string): string {
  return git('rev-parse --show-toplevel', path);
}

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim();
}

function quote(s: string): string {
  return `'${s.replace(/'/g, '\'\\\'\'')}'`;
}
