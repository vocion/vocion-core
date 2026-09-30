/**
 * A pipeline change is one commit on a branch of its own and a pull request
 * from it, written through GitHub's git data API with the workspace's token
 * (backlog 049). GitHub is a fake that answers by route; every repository and
 * path is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/agents/tools/githubPullRead', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/agents/tools/githubPullRead')>()),
  tokenForRepo: vi.fn(async () => 'test-token'),
}));

const { branchFor, cleanPath, discardChange, openChangePull, PIPELINE_BRANCH_PREFIX } = await import('./githubChange');

type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let routes: Record<string, (body: any) => { status: number; body?: unknown }> = {};

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const path = `${u.pathname}${u.search}`.replace('/repos/Acme/northwind-core', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    const res = route ? route(body) : { status: 404, body: { message: 'Not Found' } };
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function aNewBranch() {
  routes['GET '] = () => ({ status: 200, body: { default_branch: 'main' } });
  routes['GET /git/ref/heads/main'] = () => ({ status: 200, body: { object: { sha: 'base000000000000' } } });
  routes['GET /git/commits/base000000000000'] = () => ({ status: 200, body: { tree: { sha: 'tree000' } } });
  routes['POST /git/trees'] = () => ({ status: 201, body: { sha: 'tree111' } });
  routes['POST /git/commits'] = () => ({ status: 201, body: { sha: 'commit111' } });
  routes['POST /git/refs'] = () => ({ status: 201, body: {} });
}

describe('a pipeline change (github.open_pull\'s work)', () => {
  it('writes the files as one commit over the base, on a vocion/pipeline- branch, and opens its pull request', async () => {
    aNewBranch();
    routes['GET /pulls?state=open&head=Acme%3Avocion%2Fpipeline-202609301200-ci-give-e2e-its-database'] = () => ({ status: 200, body: [] });
    routes['POST /pulls'] = () => ({ status: 201, body: { html_url: 'https://github.com/Acme/northwind-core/pull/88', number: 88 } });

    const out = await openChangePull('org_1', {
      repo: 'Acme/northwind-core',
      title: 'CI: give e2e its database',
      body: 'The e2e job failed: connect ECONNREFUSED 127.0.0.1:5432.',
      files: [{ path: '.github/workflows/ci.yml', content: 'name: CI\n' }, { path: 'scripts/old-setup.sh', delete: true }],
      now: new Date('2026-09-30T12:00:00Z'),
    });

    expect(out).toEqual({ repo: 'Acme/northwind-core', url: 'https://github.com/Acme/northwind-core/pull/88', number: 88, branch: 'vocion/pipeline-202609301200-ci-give-e2e-its-database', base: 'main', headSha: 'commit111', created: true, paths: ['.github/workflows/ci.yml', 'scripts/old-setup.sh'] });

    const tree = calls.find(c => c.method === 'POST' && c.path === '/git/trees')!;

    expect(tree.body).toEqual({ base_tree: 'tree000', tree: [
      { path: '.github/workflows/ci.yml', mode: '100644', type: 'blob', content: 'name: CI\n' },
      { path: 'scripts/old-setup.sh', mode: '100644', type: 'blob', sha: null },
    ] });
    expect(calls.find(c => c.path === '/git/commits' && c.method === 'POST')!.body).toMatchObject({ tree: 'tree111', parents: ['base000000000000'] });
    expect(calls.find(c => c.path === '/git/refs')!.body).toEqual({ ref: 'refs/heads/vocion/pipeline-202609301200-ci-give-e2e-its-database', sha: 'commit111' });
    expect(calls.find(c => c.path === '/pulls' && c.method === 'POST')!.body).toMatchObject({ head: 'vocion/pipeline-202609301200-ci-give-e2e-its-database', base: 'main' });
  });

  it('a second attempt adds a commit to its own branch and its open pull request', async () => {
    const branch = `${PIPELINE_BRANCH_PREFIX}202609301200-ci-give-e2e-its-database`;
    routes[`GET /git/ref/heads/${encodeURIComponent(branch)}`] = () => ({ status: 200, body: { object: { sha: 'head222' } } });
    routes['GET /git/commits/head222'] = () => ({ status: 200, body: { tree: { sha: 'tree222' } } });
    routes['POST /git/trees'] = () => ({ status: 201, body: { sha: 'tree333' } });
    routes['POST /git/commits'] = () => ({ status: 201, body: { sha: 'commit333' } });
    routes[`PATCH /git/refs/heads/${encodeURIComponent(branch)}`] = () => ({ status: 200, body: {} });
    routes[`GET /pulls?state=open&head=${encodeURIComponent(`Acme:${branch}`)}`] = () => ({ status: 200, body: [{ html_url: 'https://github.com/Acme/northwind-core/pull/88', number: 88 }] });

    const out = await openChangePull('org_1', { repo: 'Acme/northwind-core', title: 'CI: give e2e its database', body: 'Second try: the service needs a health check.', files: [{ path: '.github/workflows/ci.yml', content: 'name: CI\n# v2\n' }], base: 'main', branch });

    expect(out).toMatchObject({ created: false, headSha: 'commit333', number: 88 });
    expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ sha: 'commit333', force: false });
    expect(calls.some(c => c.method === 'POST' && c.path === '/pulls')).toBe(false);
  });

  it('writes nowhere but its own branches, and nothing outside the repository', async () => {
    await expect(openChangePull('org_1', { repo: 'Acme/northwind-core', title: 'x', body: 'y', files: [{ path: 'a.yml', content: '' }], base: 'main', branch: 'main' })).rejects.toThrow(/vocion\/pipeline-/);
    await expect(openChangePull('org_1', { repo: 'Acme/northwind-core', title: 'x', body: 'y', files: [{ path: '../escape', content: '' }] })).rejects.toThrow(/not a path inside/);
    await expect(openChangePull('org_1', { repo: 'Acme/northwind-core', title: 'x', body: 'y', files: [{ path: 'a.yml' }] })).rejects.toThrow(/whole new text/);

    expect(cleanPath('./.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml');
    expect(cleanPath('.git/config')).toBeNull();
    expect(branchFor('Deploy: re-run on a fresh runner!', new Date('2026-09-30T01:02:00Z'))).toBe('vocion/pipeline-202609300102-deploy-re-run-on-a-fresh-runner');
  });

  it('says what the token lacks when GitHub refuses the branch', async () => {
    aNewBranch();
    routes['POST /git/refs'] = () => ({ status: 403, body: { message: 'Resource not accessible by integration' } });

    await expect(openChangePull('org_1', { repo: 'Acme/northwind-core', title: 'CI: pin the runner image', body: 'The runner image moved under the job.', files: [{ path: '.github/workflows/ci.yml', content: 'x' }] })).rejects.toThrow(/Workflows: write/);
  });

  it('undo closes an open change and deletes its branch', async () => {
    const branch = `${PIPELINE_BRANCH_PREFIX}x`;
    routes['GET /pulls/88'] = () => ({ status: 200, body: { merged: false, state: 'open' } });
    routes['POST /issues/88/comments'] = () => ({ status: 201, body: {} });
    routes['PATCH /pulls/88'] = () => ({ status: 200, body: {} });
    routes[`DELETE /git/refs/heads/${encodeURIComponent(branch)}`] = () => ({ status: 204 });

    const out = await discardChange('org_1', { url: 'https://github.com/Acme/northwind-core/pull/88', repo: 'Acme/northwind-core', branch });

    expect(out).toEqual({ closed: true, branchDeleted: true, revertUrl: null, state: 'closed' });
  });
});
