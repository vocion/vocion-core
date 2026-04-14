import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fromRepoRoot } from '@/libs/repo-root';
import { getContextPath } from './reader';

/**
 * Report whether the configured context directory has uncommitted local
 * changes. Informational only — the app never commits on your behalf
 * (git workflow is an external responsibility). Used to render a small
 * "dirty" badge in the UI when you've edited context files but not yet
 * committed them.
 */

export type ContextDirtyState = {
  isGitRepo: boolean;
  dirty: boolean;
  changedFiles: string[];
  error: string | null;
};

export function getContextDirtyState(): ContextDirtyState {
  const contextPath = getContextPath();
  const base = fromRepoRoot(contextPath);

  if (!existsSync(base)) {
    return { isGitRepo: false, dirty: false, changedFiles: [], error: `context path not found: ${contextPath}` };
  }

  try {
    // Confirm the context dir is inside a git repo
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: base, stdio: 'pipe' });
  } catch {
    return { isGitRepo: false, dirty: false, changedFiles: [], error: null };
  }

  try {
    // --porcelain gives a stable machine-parsable list of changes scoped to base
    const out = execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: base, stdio: 'pipe' }).toString();
    const changedFiles = out.split('\n').filter(Boolean).map(line => line.slice(3).trim());
    return { isGitRepo: true, dirty: changedFiles.length > 0, changedFiles, error: null };
  } catch (err) {
    return { isGitRepo: true, dirty: false, changedFiles: [], error: err instanceof Error ? err.message : String(err) };
  }
}
