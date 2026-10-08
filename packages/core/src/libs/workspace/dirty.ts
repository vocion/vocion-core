import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fromRepoRoot } from '@/libs/repo-root';

/**
 * Report whether the configured workspace directory has uncommitted local
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

/**
 * The dirty state of the project's own workspace folder.
 * @param contextPath - The project's own folder (`workspacePathForProject`), or null when it has none on this host. Never the process-wide mount: on a shared host that is another company's checkout, and its changed file names are its business.
 */
export function getWorkspaceDirtyState(contextPath: string | null): ContextDirtyState {
  if (!contextPath) {
    return { isGitRepo: false, dirty: false, changedFiles: [], error: 'this project has no workspace folder on this host' };
  }
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
