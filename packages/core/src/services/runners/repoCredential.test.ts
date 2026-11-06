/**
 * The push credential a run is handed: a github.com clone URL is served by the
 * GitHub source as before; a GitLab clone URL, on gitlab.com or a self-managed
 * instance a gitlab source names, by that source's credential for the project
 * (nested paths and all), marked `host: 'gitlab'` with the instance's API root
 * so the runner pushes as `oauth2` and opens a merge request. Sources are
 * injected; names are invented.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/agents/tools/githubPullRead', () => ({ tokenForRepo: vi.fn(async (_org: string, repo: string) => (repo === 'Acme/northwind-core' ? 'ghs_token' : null)) }));
const gitlabProjectAccess = vi.fn(async (_org: string, project: string, opts: { host?: string | null }) => (project === 'northwind/platform/api' && opts.host === 'gitlab.northwind.example'
  ? { access: { token: 'gl_at_fresh', baseUrl: 'https://gitlab.northwind.example', sourceId: 3, config: { deployBranch: 'main', branchPrefix: null } }, refusal: null }
  : { access: null, refusal: null }));
vi.mock('@/services/repo/gitlabAccess', () => ({
  gitlabConnections: vi.fn(async () => [{ id: 3, slug: 'gitlab', kind: 'gitlab', configJson: { projects: ['northwind/platform/api'], baseUrl: 'https://gitlab.northwind.example' }, apiTokenId: 'tok_1' }]),
  gitlabProjectAccess: (...args: unknown[]) => gitlabProjectAccess(...(args as [string, string, { host?: string | null }])),
}));

const { repoCredentialFor } = await import('./repoCredential');

const run = (repo: string) => ({ task: { repo } });

describe('repoCredentialFor', () => {
  it('a github.com clone URL keeps the GitHub source\'s token, as it always had', async () => {
    await expect(repoCredentialFor('org_1', run('https://github.com/Acme/northwind-core.git'))).resolves.toEqual({ token: 'ghs_token', source: 'github-connector' });
  });

  it('a GitLab clone URL with a nested path on a self-managed instance gets that source\'s credential, marked GitLab with its API root', async () => {
    await expect(repoCredentialFor('org_1', run('https://gitlab.northwind.example/northwind/platform/api.git'))).resolves.toEqual({ token: 'gl_at_fresh', source: 'gitlab-connector', host: 'gitlab', apiUrl: 'https://gitlab.northwind.example/api/v4' });
    expect(gitlabProjectAccess).toHaveBeenCalledWith('org_1', 'northwind/platform/api', { host: 'gitlab.northwind.example' });
  });

  it('a project no gitlab source lists, another instance, or no repository at all, gets nothing', async () => {
    await expect(repoCredentialFor('org_1', run('https://gitlab.northwind.example/northwind/other.git'))).resolves.toBeNull();
    await expect(repoCredentialFor('org_1', run('https://gitlab.com/northwind/platform/api.git'))).resolves.toBeNull();
    await expect(repoCredentialFor('org_1', {})).resolves.toBeNull();
  });
});
