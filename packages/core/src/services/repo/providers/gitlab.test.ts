/**
 * GitLab as the repo family's second host: merge request and pipeline URLs
 * parse on the instance a source names, a merge request reads back as the
 * family's pull request, its diff carries the `diff --git` headers the path
 * checks read, a file path cannot climb out of the project, and the writes
 * map to notes, approvals and pipeline calls. Recorded answers; invented
 * projects.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
const SOURCE: FamilySource = { id: 5, slug: 'gitlab', kind: 'gitlab', config: { baseUrl: 'https://gitlab.example', repos: ['acme/api', 'acme/platform/web'] }, apiTokenId: null };
vi.mock('@/libs/connectors/families', async importActual => ({
  ...(await importActual<typeof import('@/libs/connectors/families')>()),
  familySourcesForOrg: vi.fn(async () => [SOURCE]),
}));
vi.mock('@/services/connectors/sourceCredentials', () => ({ credentialsForSource: vi.fn(async () => ({ token: 'glpat-northwind' })) }));

const { gitlabProviderForHost, gitlabProviderForRepo, gitlabRepoProvider, unifiedDiff } = await import('./gitlab');

type Call = { url: string; method: string; body: unknown };

function vendor(route: (url: string, method: string) => [unknown, number?]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const [body, status] = route(url, method);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: status ?? 200 });
  }));
  return calls;
}

const provider = gitlabRepoProvider('https://gitlab.example/');
const ref = { repo: 'acme/api', number: 12, url: 'https://gitlab.example/acme/api/-/merge_requests/12' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('choosing GitLab', () => {
  it('answers for the instance and the projects an enabled gitlab source names, and nothing else', async () => {
    await expect(gitlabProviderForHost('org_1', 'gitlab.example')).resolves.toMatchObject({ kind: 'gitlab' });
    await expect(gitlabProviderForHost('org_1', 'gitlab.com')).resolves.toBeNull();
    await expect(gitlabProviderForRepo('org_1', 'acme/platform/web')).resolves.toMatchObject({ kind: 'gitlab' });
    await expect(gitlabProviderForRepo('org_1', 'acme/other')).resolves.toBeNull();
  });

  it('parses merge request and pipeline URLs on its instance, nested groups included', () => {
    expect(provider.parsePullRef('https://gitlab.example/acme/platform/web/-/merge_requests/3/diffs')).toEqual({ repo: 'acme/platform/web', number: 3, url: 'https://gitlab.example/acme/platform/web/-/merge_requests/3' });
    expect(provider.parseRunRef('https://gitlab.example/acme/api/-/pipelines/4410')).toEqual({ repo: 'acme/api', runId: 4410, url: 'https://gitlab.example/acme/api/-/pipelines/4410' });
    expect(provider.parsePullRef('https://github.com/acme/api/pull/3')).toBeNull();
  });
});

describe('reads', () => {
  it('reads a merge request as the family\'s pull request: files with line counts, approvals, the head pipeline\'s jobs', async () => {
    vendor((url) => {
      if (url.endsWith('/diffs?per_page=100')) {
        return [[{ old_path: 'src/a.ts', new_path: 'src/a.ts', diff: '@@ -1 +1,2 @@\n-old\n+new\n+more\n' }, { old_path: 'b.md', new_path: 'b.md', new_file: true, diff: '@@ -0,0 +1 @@\n+hi\n' }]];
      }
      if (url.endsWith('/approvals')) {
        return [{ approved_by: [{ user: { username: 'dana' } }] }];
      }
      if (url.includes('/pipelines/77/jobs')) {
        return [[{ id: 1, name: 'test', status: 'failed' }, { id: 2, name: 'lint', status: 'running' }]];
      }
      return [{ id: 9001, iid: 12, title: 'Retry webhooks', description: 'Adds backoff.', state: 'opened', web_url: ref.url, source_branch: 'feat/retry', target_branch: 'main', sha: 'abc123', author: { username: 'jamie' }, labels: ['backend'], created_at: 'x', updated_at: 'y', head_pipeline: { id: 77 } }];
    });

    const pull = await provider.readPull('org_1', ref);

    expect(pull).toMatchObject({ state: 'open', merged: false, headSha: 'abc123', baseBranch: 'main', additions: 3, deletions: 1, changedFileCount: 2, labels: ['backend'] });
    expect(pull.files).toEqual([{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }, { path: 'b.md', status: 'added', additions: 1, deletions: 0 }]);
    expect(pull.reviews).toEqual([{ reviewer: 'dana', state: 'APPROVED', submittedAt: null }]);
    expect(pull.checks).toEqual([{ name: 'test', status: 'completed', conclusion: 'failure' }, { name: 'lint', status: 'in_progress', conclusion: null }]);
  });

  it('writes a unified diff with the headers the family\'s path checks read', () => {
    expect(unifiedDiff([{ old_path: 'gone.txt', new_path: 'gone.txt', deleted_file: true, diff: '@@ -1 +0,0 @@\n-bye' }])).toBe('diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n');
  });

  it('reads a file at the default branch, refuses a path that climbs out, and refuses a project no source lists', async () => {
    const calls = vendor(url => (url.includes('/repository/files/') ? ['# API'] : [{ default_branch: 'main' }]));

    await expect(provider.readFile('org_1', 'acme/api', './docs/README.md')).resolves.toMatchObject({ path: 'docs/README.md', text: '# API', truncated: false });
    expect(calls.at(-1)!.url).toBe('https://gitlab.example/api/v4/projects/acme%2Fapi/repository/files/docs%2FREADME.md/raw?ref=main');
    await expect(provider.readFile('org_1', 'acme/api', '../../users')).rejects.toThrow(/not a path inside the repository/);
    await expect(provider.readFile('org_1', 'acme/secret', 'a.ts', 'main')).rejects.toThrow(/not a project this workspace connected/);
  });

  it('lists pipelines newest first with the newest jobs', async () => {
    vendor(url => (url.includes('/jobs') ? [[{ id: 1, name: 'deploy', stage: 'deploy', status: 'failed' }]] : [[{ id: 4410, status: 'failed', ref: 'main', sha: 'abc', source: 'push', web_url: 'https://gitlab.example/acme/api/-/pipelines/4410' }]]));

    await expect(provider.listPipelineRuns!('org_1', 'acme/api', { branch: 'main', limit: 5 })).resolves.toEqual([{ id: 4410, url: 'https://gitlab.example/acme/api/-/pipelines/4410', ref: 'main', sha: 'abc', status: 'failed', source: 'push', createdAt: null, jobs: [{ name: 'deploy', stage: 'deploy', status: 'failed' }] }]);
  });
});

describe('writes', () => {
  it('comments as a note, deletes it under its merge request, and refuses a delete with no merge request named', async () => {
    const calls = vendor((_url, method) => (method === 'POST' ? [{ id: 555 }] : [{}]));

    await expect(provider.commentPull('org_1', ref, 'CI is red on lint.')).resolves.toEqual({ commentId: 555, url: 'https://gitlab.example/acme/api/-/merge_requests/12#note_555' });

    await provider.deletePullComment('org_1', 'acme/api', 555, 12);

    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: 'https://gitlab.example/api/v4/projects/acme%2Fapi/merge_requests/12/notes/555' });
    await expect(provider.deletePullComment('org_1', 'acme/api', 555)).rejects.toThrow(/did not record which one/);
  });

  it('approves with a note, and dismissing unapproves and deletes the note', async () => {
    const calls = vendor((_url, method) => (method === 'POST' ? [{ id: 600 }] : [{}]));

    await expect(provider.submitReview('org_1', ref, { event: 'approve', body: 'Looks right.' })).resolves.toEqual({ reviewId: 600, url: 'https://gitlab.example/acme/api/-/merge_requests/12#note_600' });
    expect(calls.map(c => `${c.method} ${c.url.split('/merge_requests/12')[1]}`)).toEqual(['POST /notes', 'POST /approve']);

    calls.length = 0;
    await provider.dismissReview('org_1', ref, 600, 'Undone');

    expect(calls.map(c => `${c.method} ${c.url.split('/merge_requests/12')[1]}`)).toEqual(['POST /unapprove', 'DELETE /notes/600']);
  });

  it('cancels a running pipeline, and leaves a finished one as it is', async () => {
    let status = 'running';
    const calls = vendor(() => [{ id: 4410, status, web_url: 'u' }]);
    const run = { repo: 'acme/api', runId: 4410, url: 'https://gitlab.example/acme/api/-/pipelines/4410' };

    await expect(provider.cancelPipelineRun('org_1', run)).resolves.toEqual({ cancelled: true });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: expect.stringContaining('/pipelines/4410/cancel') });

    status = 'success';

    await expect(provider.cancelPipelineRun('org_1', run)).resolves.toEqual({ cancelled: false });
  });
});
