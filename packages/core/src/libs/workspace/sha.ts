import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/**
 * Compute a stable SHA for a workspace directory.
 *
 * Prefers the current git commit hash when the path is inside a git repo
 * and has no uncommitted changes. Otherwise falls back to a content hash
 * of every file (sorted by path), prefixed with `dirty-` so it's distinguishable
 * from a git SHA.
 *
 * The content hash covers each file's path INSIDE the folder and its bytes.
 * It used to cover the absolute paths alone, which made it two wrong things
 * at once: an edit that kept every file name kept the sha (so a run was
 * stamped with a sha that named a different prompt), and the same files in
 * another folder — an import staged in a temporary folder, a working copy —
 * got a different sha every time, so the sha a person reviewed could never
 * match the one an apply then wrote.
 * @param contextPath - The workspace folder.
 * @param fileList - The files the loader read from it, absolute.
 */
export function computeWorkspaceSha(contextPath: string, fileList: string[]): string {
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

      return `${head}-dirty-${contentHash(abs, fileList)}`;
    } catch {
      // fall through to content hash
    }
  }

  return `local-${contentHash(abs, fileList)}`;
}

function isInsideGitRepo(path: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf8', cwd: path, stdio: ['pipe', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * A hash of every file's path inside `root` and its bytes, in path order.
 * @param root - The workspace folder, absolute.
 * @param fileList - The files the loader read, absolute.
 */
function contentHash(root: string, fileList: string[]): string {
  const hash = createHash('sha256');
  // The loader does not list the manifest it read first; its settings are
  // part of what an apply writes, so they are part of the hash.
  const manifests = ['workspace.yaml', 'workspace.yml'].map(name => resolve(root, name)).filter(f => existsSync(f));
  const entries = [...new Set([...manifests, ...fileList])]
    .map(abs => ({ abs, rel: relative(root, abs).split(sep).join('/') }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const { abs, rel } of entries) {
    hash.update(rel);
    hash.update('\0');
    try {
      hash.update(readFileSync(abs));
    } catch {
      // Read a moment ago by the loader; gone now is a different folder.
      hash.update('\u0000missing');
    }
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}
