import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Compute a stable SHA for a context directory.
 *
 * Prefers the current git commit hash when the path is inside a git repo
 * and has no uncommitted changes. Otherwise falls back to a content hash
 * of every file (sorted by path), prefixed with `dirty-` so it's distinguishable
 * from a git SHA.
 * @param contextPath
 * @param fileList
 */
export function computeContextSha(contextPath: string, fileList: string[]): string {
  const abs = resolve(contextPath);

  if (existsSync(resolve(abs, '.git')) || isInsideGitRepo(abs)) {
    try {
      const status = execSync(`git status --porcelain -- ${JSON.stringify(abs)}`, {
        encoding: 'utf8',
        cwd: abs,
      }).trim();

      const head = execSync('git rev-parse --short=12 HEAD', {
        encoding: 'utf8',
        cwd: abs,
      }).trim();

      if (!status) {
        return head;
      }

      return `${head}-dirty-${contentHash(fileList)}`;
    } catch {
      // fall through to content hash
    }
  }

  return `local-${contentHash(fileList)}`;
}

function isInsideGitRepo(path: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf8', cwd: path, stdio: ['pipe', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function contentHash(fileList: string[]): string {
  const hash = createHash('sha256');
  for (const path of [...fileList].sort()) {
    hash.update(path);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}
