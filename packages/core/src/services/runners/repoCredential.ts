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
 *
 * GITLAB. A clone URL on gitlab.com, or on a self-managed instance a gitlab source names, is
 * served by that source's credential for the project (`services/repo/gitlabAccess.ts`): a pasted
 * access token as stored, or a "Connect with GitLab" login refreshed and saved first, so the token
 * handed over is good for at least a few minutes more. The credential says `host: 'gitlab'` and
 * the instance's REST root (`apiUrl`), so the runner authenticates git as `oauth2:<token>` and
 * opens a merge request through the API instead of `gh` (`packages/runner/src/forge.mjs`). The
 * project path may be nested (`group/subgroup/project`).
 */

import { tokenForRepo } from '@/services/agents/tools/githubPullRead';

/**
 * A credential for one repository, as the runner receives it. `host` absent means GitHub (what
 * every runner before GitLab assumed); `apiUrl` is the GitLab instance's REST root.
 */
export type RepoCredential = { token: string; source: string; host?: 'github' | 'gitlab'; apiUrl?: string };

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
  const clone = typeof task.repo === 'string' ? task.repo.trim() : '';
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(clone);
  if (m) {
    return source(orgId, m[1]!);
  }
  return /^https:\/\//.test(clone) ? gitlabCredentialFor(orgId, clone) : null;
}

/**
 * The push credential for a GitLab clone URL: the gitlab source of this workspace whose instance
 * the URL is on and whose projects list it. Null when none does.
 * @param orgId - The workspace that queued the run.
 * @param clone - The contract's https clone URL.
 */
export async function gitlabCredentialFor(orgId: string, clone: string): Promise<RepoCredential | null> {
  const { gitlabConnections, gitlabProjectAccess } = await import('@/services/repo/gitlabAccess');
  const { hostOfBaseUrl, normalizeBaseUrl } = await import('@/libs/gitlab/client');
  const { projectOfUrl } = await import('@/libs/gitlab/urls');
  const rows = await gitlabConnections(orgId).catch(() => []);
  for (const row of rows) {
    const base = normalizeBaseUrl((row.configJson as { baseUrl?: string } | null)?.baseUrl);
    const project = projectOfUrl(clone, base);
    if (!project) {
      continue;
    }
    const got = await gitlabProjectAccess(orgId, project, { host: hostOfBaseUrl(base) }).catch(() => null);
    if (got?.access) {
      return { token: got.access.token, source: 'gitlab-connector', host: 'gitlab', apiUrl: `${got.access.baseUrl}/api/v4` };
    }
  }
  return null;
}
