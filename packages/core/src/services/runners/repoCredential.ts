/**
 * THE TOKEN A RUN PUSHES WITH (backlog 052). One installation runner fleet builds any workspace's
 * repositories without holding their tokens: at claim, core resolves a credential for the run's
 * repository and hands it to the runner with the run. The runner uses it for its own git and `gh`
 * only; the engineer's process never sees it.
 *
 * Where the credential comes from is one seam, {@link repoCredentialSource}. Today it is the
 * workspace's GitHub connector token for a repository the connector lists
 * (`githubPullRead.tokenForRepo`). The GitHub App (backlog 053) replaces the source with a
 * short-lived installation token per repository, and nothing else changes.
 */

import { tokenForRepo } from '@/services/agents/tools/githubPullRead';

/** A credential for one repository, as the runner receives it. */
export type RepoCredential = { token: string; source: string };

/** Resolves a push credential for `owner/name` in a workspace, or null when there is none. */
export type RepoCredentialSource = (orgId: string, fullName: string) => Promise<RepoCredential | null>;

let source: RepoCredentialSource = async (orgId, fullName) => {
  const token = await tokenForRepo(orgId, fullName).catch(() => null);
  return token ? { token, source: 'github-connector' } : null;
};

/**
 * Replace where credentials come from (the GitHub App's installation tokens, a test double).
 * @param next - The new source.
 */
export function setRepoCredentialSource(next: RepoCredentialSource): void {
  source = next;
}

/**
 * The credential for a run's repository, read off its contract's clone URL. Null for a run with no
 * GitHub repository, or none this workspace can push to; the runner then uses its own environment.
 * @param orgId - The workspace that queued the run.
 * @param input - The run's input (`input.task.repo`).
 */
export async function repoCredentialFor(orgId: string, input: Record<string, unknown> | null | undefined): Promise<RepoCredential | null> {
  const task = (input?.task && typeof input.task === 'object' ? input.task : {}) as Record<string, unknown>;
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(typeof task.repo === 'string' ? task.repo : '');
  if (!m) {
    return null;
  }
  return source(orgId, m[1]!);
}
