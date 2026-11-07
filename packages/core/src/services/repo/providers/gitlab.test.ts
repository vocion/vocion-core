/**
 * GitLab as the repo family's second provider: the REST v4 calls behind each
 * construct, on a self-managed instance, for a project nested two groups
 * deep, with the project's own credential. GitLab is stubbed at `fetch` with
 * its own response shapes; the instance, project and people are invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const requireGitlabAccess = vi.fn(async () => ({ token: 'glpat-test', baseUrl: 'https://gitlab.northwind.example', sourceId: 3, config: { deployBranch: 'main', branchPrefix: 'factory/' } }));
vi.mock('../gitlabAccess', () => ({ requireGitlabAccess: (...args: unknown[]) => requireGitlabAccess(...(args as [])) }));

const { gitlabRepoProviderOn, unifiedDiffOf } = await import('./gitlab');

const BASE = 'https://gitlab.northwind.example';
const PROJECT = 'northwind/platform/api';
const ID = 'northwind%2Fplatform%2Fapi';
const SHA = '08013a5a95819b3d43fc22e2bac9cd664d8be21b';
const MR_URL = `${BASE}/${PROJECT}/-/merge_requests/9`;
const ref = { repo: PROJECT, number: 9, url: MR_URL };

const mr = {
  iid: 9,
  title: 'Allow a dispatcher to reassign a route',
  description: 'Contract #41',
  state: 'opened',
  created_at: '2026-11-04T12:00:00Z',
  updated_at: '2026-11-04T13:00:00Z',
  author: { username: 'factory-bot' },
  reviewers: [],
  source_branch: 'factory/41-reassign',
  target_branch: 'main',
  sha: SHA,
  merge_commit_sha: null,
  squash_commit_sha: null,
  draft: false,
  web_url: MR_URL,
  labels: ['factory'],
  has_conflicts: false,
  detailed_merge_status: 'mergeable',
  diff_refs: { base_sha: 'b4se', head_sha: SHA, start_sha: 'st4rt' },
  head_pipeline: { id: 300, project_id: 55, sha: SHA, ref: 'factory/41-reassign', status: 'success', web_url: `${BASE}/${PROJECT}/-/pipelines/300` },
  changes_count: '2',
};
const diffs = [
  { old_path: 'src/routes.ts', new_path: 'src/routes.ts', new_file: false, deleted_file: false, renamed_file: false, diff: '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n' },
  { old_path: 'src/new.ts', new_path: 'src/new.ts', new_file: true, deleted_file: false, renamed_file: false, b_mode: '100644', diff: '@@ -0,0 +1 @@\n+x\n' },
];
const jobs = [{ id: 11, name: 'unit', stage: 'test', status: 'success', allow_failure: false }, { id: 12, name: 'lint', stage: 'test', status: 'success', allow_failure: false }];

type Call = { method: string; path: string; body: unknown; auth: string | undefined };
let calls: Call[] = [];
let routes: Array<{ method: string; path: RegExp; status?: number; body: unknown; text?: boolean }> = [];

beforeEach(() => {
  calls = [];
  routes = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).replace(`${BASE}/api/v4`, '');
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>)?.authorization });
    const hit = routes.find(r => r.method === method && r.path.test(path));
    if (!hit) {
      return new Response(JSON.stringify({ message: '404 Not found' }), { status: 404 });
    }
    // A 204 carries no body, as GitLab sends it.
    return new Response(hit.status === 204 ? null : hit.text ? String(hit.body) : JSON.stringify(hit.body), { status: hit.status ?? 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const on = (method: string, path: RegExp, body: unknown, status?: number, text?: boolean) => routes.push({ method, path, body, status, text });
const gl = gitlabRepoProviderOn(BASE);

describe('the GitLab provider', () => {
  it('names a merge request and a pipeline from their URLs on its instance, nested paths and all', () => {
    expect(gl.kind).toBe('gitlab');
    expect(gl.parsePullRef(`${MR_URL}/diffs`)).toEqual(ref);
    expect(gl.parseRunRef(`${BASE}/${PROJECT}/-/pipelines/300`)).toEqual({ repo: PROJECT, runId: 300, url: `${BASE}/${PROJECT}/-/pipelines/300` });
    expect(gl.pullUrl(PROJECT, 9)).toBe(MR_URL);
    expect(gl.parsePullRef(`${BASE}/${PROJECT}`)).toBeNull();
  });

  it('reads a merge request as one summary: files with their line counts, approvals and the head pipeline\'s jobs as checks', async () => {
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9$`), mr);
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9/diffs`), diffs);
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9/approvals$`), { approved_by: [{ user: { username: 'dana.northwind' } }] });
    on('GET', /^\/projects\/55\/pipelines\/300\/jobs/, jobs);
    const pull = await gl.readPull('org_1', ref);

    expect(pull).toMatchObject({
      repo: PROJECT,
      number: 9,
      url: MR_URL,
      title: mr.title,
      body: 'Contract #41',
      author: 'factory-bot',
      state: 'open',
      merged: false,
      headBranch: 'factory/41-reassign',
      headSha: SHA,
      baseBranch: 'main',
      additions: 3,
      deletions: 1,
      changedFileCount: 2,
      files: [{ path: 'src/routes.ts', status: 'modified', additions: 2, deletions: 1 }, { path: 'src/new.ts', status: 'added', additions: 1, deletions: 0 }],
      reviews: [{ reviewer: 'dana.northwind', state: 'APPROVED' }],
      checks: [{ name: 'test: unit', status: 'completed', conclusion: 'success' }, { name: 'test: lint', status: 'completed', conclusion: 'success' }],
      labels: ['factory'],
    });
    expect(calls.every(c => c.auth === 'Bearer glpat-test')).toBe(true);
    expect(requireGitlabAccess).toHaveBeenCalledWith('org_1', PROJECT, 'gitlab.northwind.example');
  });

  it('reads the diff as git wrote it, and builds it from per-file diffs on an instance without raw_diffs', async () => {
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9/raw_diffs$`), 'diff --git a/src/routes.ts b/src/routes.ts\n', undefined, true);

    await expect(gl.readPullDiff('org_1', ref)).resolves.toBe('diff --git a/src/routes.ts b/src/routes.ts\n');

    routes = [];
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9/diffs`), diffs);
    const built = await gl.readPullDiff('org_1', ref);

    expect(built).toContain('diff --git a/src/routes.ts b/src/routes.ts\n--- a/src/routes.ts\n+++ b/src/routes.ts\n@@ -1,2 +1,3 @@');
    expect(built).toContain('diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new.ts');
    expect(unifiedDiffOf([{ old_path: 'gone.ts', new_path: 'gone.ts', deleted_file: true, diff: '@@ -1 +0,0 @@\n-x\n' }])).toBe('diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x');
  });

  it('compares two refs through the repository compare, from their merge base', async () => {
    on('GET', new RegExp(`^/projects/${ID}/repository/compare\\?from=main&to=factory%2F41-reassign&straight=false$`), { diffs });

    await expect(gl.readCompareDiff('org_1', PROJECT, 'main', 'factory/41-reassign')).resolves.toContain('+++ b/src/new.ts');
  });

  it('reads a file at a ref (the default branch when none), and refuses a path that leaves the repository before any request', async () => {
    on('GET', new RegExp(`^/projects/${ID}$`), { default_branch: 'develop' });
    on('GET', new RegExp(`^/projects/${ID}/repository/files/\\.gitlab-ci\\.yml/raw\\?ref=develop$`), 'stages: [test]\n', undefined, true);

    await expect(gl.readFile('org_1', PROJECT, '.gitlab-ci.yml')).resolves.toEqual({ repo: PROJECT, path: '.gitlab-ci.yml', ref: null, size: 15, text: 'stages: [test]\n', truncated: false });

    on('GET', new RegExp(`^/projects/${ID}/repository/files/src%2Fdeep%2Fa\\.ts/raw\\?ref=factory%2F41$`), 'x', undefined, true);

    await expect(gl.readFile('org_1', PROJECT, 'src/deep/a.ts', 'factory/41')).resolves.toMatchObject({ path: 'src/deep/a.ts', text: 'x' });

    calls = [];
    for (const bad of ['../../users', 'src/../../x', 'src//x', '.', '']) {
      await expect(gl.readFile('org_1', PROJECT, bad)).rejects.toThrow(/is not a path inside the repository/);
    }

    expect(calls).toEqual([]);
  });

  it('reads the whole tree at a ref with keyset pages, folders and files only', async () => {
    on('GET', new RegExp(`^/projects/${ID}/repository/tree\\?per_page=100&recursive=true&ref=main&pagination=keyset$`), [{ path: 'src', type: 'tree' }, { path: 'src/index.ts', type: 'blob' }, { path: 'vendor/lib', type: 'commit' }]);

    await expect(gl.readTree('org_1', PROJECT, 'main')).resolves.toEqual({ repo: PROJECT, ref: 'main', truncated: false, entries: [{ path: 'src', type: 'tree' }, { path: 'src/index.ts', type: 'blob' }] });
  });

  it('comments with a note and deletes it through its merge request', async () => {
    on('POST', new RegExp(`^/projects/${ID}/merge_requests/9/notes$`), { id: 501 }, 201);

    await expect(gl.commentPull('org_1', ref, 'Run report')).resolves.toEqual({ commentId: 501, url: `${MR_URL}#note_501` });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { body: 'Run report' } });

    on('DELETE', new RegExp(`^/projects/${ID}/merge_requests/9/notes/501$`), {}, 204);
    await gl.deletePullComment('org_1', PROJECT, 501, 9);

    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/projects/${ID}/merge_requests/9/notes/501` });
    await expect(gl.deletePullComment('org_1', PROJECT, 501)).rejects.toThrow(/names none/);
  });

  it('requests changes as a note with each finding a diff discussion positioned from diff_refs; approves on the judged head; undo unapproves', async () => {
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9$`), mr);
    on('POST', new RegExp(`^/projects/${ID}/merge_requests/9/notes$`), { id: 777 }, 201);
    on('POST', new RegExp(`^/projects/${ID}/merge_requests/9/discussions$`), { id: 'd1' }, 201);
    on('POST', new RegExp(`^/projects/${ID}/merge_requests/9/approve$`), {}, 201);
    on('POST', new RegExp(`^/projects/${ID}/merge_requests/9/unapprove$`), {}, 201);
    on('DELETE', new RegExp(`^/projects/${ID}/merge_requests/9/notes/777$`), {}, 204);

    await expect(gl.submitReview('org_1', ref, { event: 'request_changes', body: 'Criterion 2 unproven', comments: [{ path: 'src/routes.ts', line: 12, body: 'against criterion 2' }, { path: 'src/routes.ts', line: 3, side: 'LEFT', body: 'removed too much' }] })).resolves.toEqual({ reviewId: 777, url: `${MR_URL}#note_777` });

    const discussions = calls.filter(c => c.path.endsWith('/discussions')).map(c => c.body);

    expect(discussions).toEqual([
      { body: 'against criterion 2', position: { position_type: 'text', base_sha: 'b4se', start_sha: 'st4rt', head_sha: SHA, old_path: 'src/routes.ts', new_path: 'src/routes.ts', new_line: 12 } },
      { body: 'removed too much', position: { position_type: 'text', base_sha: 'b4se', start_sha: 'st4rt', head_sha: SHA, old_path: 'src/routes.ts', new_path: 'src/routes.ts', old_line: 3 } },
    ]);
    expect(calls.some(c => c.path.endsWith('/approve'))).toBe(false);

    calls = [];
    await gl.submitReview('org_1', ref, { event: 'approve', body: '' });

    expect(calls.map(c => `${c.method} ${c.path.replace(`/projects/${ID}`, '')}`)).toEqual(['GET /merge_requests/9', 'POST /merge_requests/9/approve']);
    expect(calls.at(-1)!.body).toEqual({ sha: SHA });

    calls = [];
    await gl.dismissReview('org_1', ref, 777, 'Undone');

    expect(calls.map(c => `${c.method} ${c.path.replace(`/projects/${ID}`, '')}`)).toEqual(['POST /merge_requests/9/unapprove', 'DELETE /merge_requests/9/notes/777']);
  });

  it('merges onto the judged head only with every job green, squashing, and raises pr.merged keyed as GitLab\'s', async () => {
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9$`), mr);
    on('GET', /^\/projects\/55\/pipelines\/300\/jobs/, jobs);
    on('PUT', new RegExp(`^/projects/${ID}/merge_requests/9/merge$`), { ...mr, state: 'merged', merged_at: '2026-11-05T10:00:00Z', squash_commit_sha: 'sq7a5h' });

    await expect(gl.mergePull('org_1', ref, 'deadbeef')).rejects.toThrow(/branch moved after QA's verdict/);

    const out = await gl.mergePull('org_1', ref, SHA.slice(0, 12));

    expect(out).toMatchObject({ sha: 'sq7a5h', already: false, event: { type: 'pr.merged', dedupeKey: `gitlab:${PROJECT}#9:pr.merged:${SHA}`, payload: { mergeSha: 'sq7a5h', url: MR_URL } } });
    expect(calls.find(c => c.method === 'PUT')!.body).toEqual({ sha: SHA, squash: true, should_remove_source_branch: false });

    routes = [];
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9$`), mr);
    on('GET', /^\/projects\/55\/pipelines\/300\/jobs/, [{ id: 11, name: 'unit', stage: 'test', status: 'failed', allow_failure: false }]);

    await expect(gl.mergePull('org_1', ref, null)).rejects.toThrow(/not merged: 1 check failed \(test: unit\)/);
  });

  it('reads the head and the state the reconcile needs, conflicts included', async () => {
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9$`), { ...mr, has_conflicts: true, detailed_merge_status: 'conflict' });
    on('GET', /^\/projects\/55\/pipelines\/300\/jobs/, jobs);

    await expect(gl.readPullHead('org_1', ref)).resolves.toEqual({ sha: SHA, state: 'open', merged: false });
    await expect(gl.readPullState('org_1', ref)).resolves.toMatchObject({ repo: PROJECT, pr: { number: 9, state: 'open', mergeable: false, mergeable_state: 'dirty' }, checkRuns: [{ id: 11 }, { id: 12 }] });
  });

  it('closes a replaced attempt with one note, and leaves a merged one alone', async () => {
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9$`), mr);
    on('POST', new RegExp(`^/projects/${ID}/merge_requests/9/notes$`), { id: 1 }, 201);
    on('PUT', new RegExp(`^/projects/${ID}/merge_requests/9$`), { ...mr, state: 'closed' });

    await expect(gl.closePull('org_1', ref, 'Replaced by !12')).resolves.toEqual({ closed: true, state: 'closed' });
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { state_event: 'close' } });

    routes = [];
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9$`), { ...mr, state: 'merged' });

    await expect(gl.closePull('org_1', ref, 'x')).resolves.toEqual({ closed: false, state: 'merged' });
  });

  it('reverts a merge onto a branch of its own and opens the revert as a merge request', async () => {
    on('GET', new RegExp(`^/projects/${ID}/merge_requests/9$`), { ...mr, state: 'merged', squash_commit_sha: 'sq7a5h' });
    on('POST', new RegExp(`^/projects/${ID}/repository/branches\\?branch=vocion%2Frevert-`), {}, 201);
    on('POST', new RegExp(`^/projects/${ID}/repository/commits/sq7a5h/revert$`), { id: 'r3v' }, 201);
    on('POST', new RegExp(`^/projects/${ID}/merge_requests$`), { iid: 12, web_url: `${BASE}/${PROJECT}/-/merge_requests/12` }, 201);

    await expect(gl.revertPull('org_1', ref)).resolves.toEqual({ revertUrl: `${BASE}/${PROJECT}/-/merge_requests/12` });
    expect(calls.at(-1)!.body).toMatchObject({ target_branch: 'main', title: `Revert "${mr.title}"` });
  });

  it('opens a pipeline change as one commit (create or update per file) and its merge request', async () => {
    on('GET', new RegExp(`^/projects/${ID}$`), { default_branch: 'main' });
    on('HEAD', new RegExp(`^/projects/${ID}/repository/files/\\.gitlab-ci\\.yml\\?ref=main$`), {});
    on('POST', new RegExp(`^/projects/${ID}/repository/commits$`), { id: 'c0ffee' }, 201);
    on('GET', new RegExp(`^/projects/${ID}/merge_requests\\?state=opened&source_branch=`), []);
    on('POST', new RegExp(`^/projects/${ID}/merge_requests$`), { iid: 13, web_url: `${BASE}/${PROJECT}/-/merge_requests/13`, target_branch: 'main' }, 201);
    const out = await gl.openChange('org_1', { repo: PROJECT, title: 'CI: give e2e its database', body: 'The e2e job had no Postgres service.', files: [{ path: '.gitlab-ci.yml', content: 'stages: [test]\n' }, { path: 'ci/db.yml', content: 'x' }, { path: 'old.yml', delete: true }] });

    expect(out).toMatchObject({ repo: PROJECT, url: `${BASE}/${PROJECT}/-/merge_requests/13`, number: 13, base: 'main', headSha: 'c0ffee', created: true, paths: ['.gitlab-ci.yml', 'ci/db.yml', 'old.yml'] });
    expect(out.branch).toMatch(/^vocion\/pipeline-\d{12}-ci-give-e2e-its-database$/);
    expect(calls.find(c => c.path.endsWith('/repository/commits'))!.body).toEqual({
      branch: out.branch,
      start_branch: 'main',
      commit_message: 'CI: give e2e its database',
      actions: [
        { action: 'update', file_path: '.gitlab-ci.yml', content: 'stages: [test]\n' },
        { action: 'create', file_path: 'ci/db.yml', content: 'x' },
        { action: 'delete', file_path: 'old.yml' },
      ],
    });
  });

  it('cancels a pipeline that is still running, says so when it had finished, and retries one', async () => {
    const run = { repo: PROJECT, runId: 300, url: `${BASE}/${PROJECT}/-/pipelines/300` };
    on('GET', new RegExp(`^/projects/${ID}/pipelines/300$`), { id: 300, status: 'running' });
    on('POST', new RegExp(`^/projects/${ID}/pipelines/300/cancel$`), { id: 300, status: 'canceled' });
    on('POST', new RegExp(`^/projects/${ID}/pipelines/300/retry$`), { id: 300, status: 'pending' });

    await expect(gl.cancelPipelineRun('org_1', run)).resolves.toEqual({ cancelled: true });

    await gl.rerunPipelineRun('org_1', run);

    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/projects/${ID}/pipelines/300/retry` });

    routes = [];
    on('GET', new RegExp(`^/projects/${ID}/pipelines/300$`), { id: 300, status: 'success' });

    await expect(gl.cancelPipelineRun('org_1', run)).resolves.toEqual({ cancelled: false });
  });

  it('a refused write carries GitLab\'s reason and what the token needs', async () => {
    on('POST', new RegExp(`^/projects/${ID}/merge_requests/9/notes$`), { message: '403 Forbidden' }, 403);

    await expect(gl.commentPull('org_1', ref, 'x')).rejects.toThrow(/GitLab refused the comment .*403 Forbidden.*api scope/);
  });
});
