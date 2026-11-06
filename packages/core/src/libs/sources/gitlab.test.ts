/**
 * The `gitlab` source: one poll of a nested project on a self-managed
 * instance raises the same events the GitHub source would, keyed `gitlab:`,
 * and files one searchable document per merge request; Test connection names
 * each project the token can or cannot read, and which scopes it holds.
 * GitLab is stubbed at `fetch` with its REST v4 shapes; names are invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { createGitlabClient } = await import('@/libs/gitlab/client');
const { gitlabConfigSchema, gitlabConnector, inspectGitlabToken, mergeRequestDoc, pollProject } = await import('./gitlab');

const BASE = 'https://gitlab.northwind.example';
const PROJECT = 'northwind/platform/api';
const ID = 'northwind%2Fplatform%2Fapi';
const SHA = '08013a5a95819b3d43fc22e2bac9cd664d8be21b';

const listed = { iid: 9, title: 'Reassign a route', state: 'opened', created_at: '2026-11-04T12:00:00Z', updated_at: '2026-11-04T13:00:00Z', source_branch: 'factory/41-reassign', target_branch: 'main', sha: SHA, web_url: `${BASE}/${PROJECT}/-/merge_requests/9`, author: { username: 'factory-bot' }, reviewers: [], draft: false };
const other = { ...listed, iid: 8, source_branch: 'feature/by-hand', web_url: `${BASE}/${PROJECT}/-/merge_requests/8` };
const whole = { ...listed, has_conflicts: false, detailed_merge_status: 'mergeable', head_pipeline: { id: 300, project_id: 55, sha: SHA, ref: 'factory/41-reassign', status: 'failed', web_url: `${BASE}/${PROJECT}/-/pipelines/300` } };

type Route = [RegExp, unknown, number?];

function stub(routes: Route[]): string[] {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(String(url));
    const path = String(url).replace(`${BASE}/api/v4`, '');
    const hit = routes.find(([re]) => re.test(path));
    return hit ? new Response(JSON.stringify(hit[1]), { status: hit[2] ?? 200 }) : new Response(JSON.stringify({ message: '404 Not found' }), { status: 404 });
  }));
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the gitlab source', () => {
  it('validates its settings: projects required, gitlab.com and main by default', () => {
    expect(gitlabConfigSchema.parse({ projects: [PROJECT] })).toEqual({ projects: [PROJECT], deployBranch: 'main', lookbackDays: 7, baseUrl: 'https://gitlab.com' });
    expect(gitlabConfigSchema.safeParse({ projects: [] }).success).toBe(false);
  });

  it('polls a nested project on a self-managed instance: lifecycle, checks, approvals and the deploy branch, all keyed gitlab:', async () => {
    const urls = stub([
      [new RegExp(`^/projects/${ID}/merge_requests\\?`), [listed, other]],
      [new RegExp(`^/projects/${ID}/merge_requests/9$`), whole],
      [/^\/projects\/55\/pipelines\/300\/jobs/, [
        { id: 11, name: 'unit', stage: 'test', status: 'success', allow_failure: false },
        { id: 12, name: 'e2e', stage: 'test', status: 'failed', allow_failure: false },
      ]],
      [new RegExp(`^/projects/${ID}/merge_requests/9/notes`), [{ id: 501, body: 'approved this merge request', system: true, author: { username: 'dana.northwind' }, created_at: '2026-11-04T12:30:00Z' }]],
      [new RegExp(`^/projects/${ID}/pipelines\\?`), [{ id: 400, iid: 12, sha: 'cf8b62ce', ref: 'main', status: 'failed', source: 'push', updated_at: '2026-11-04T12:45:00Z', web_url: `${BASE}/${PROJECT}/-/pipelines/400` }]],
    ]);
    const skipped: string[] = [];
    const cfg = gitlabConfigSchema.parse({ projects: [PROJECT], branchPrefix: 'factory/', baseUrl: BASE });
    const poll = await pollProject(createGitlabClient({ token: 'glpat-test', baseUrl: BASE }), PROJECT, cfg, new Date('2026-11-04T00:00:00Z'), uri => skipped.push(uri));

    expect(poll.events.map(e => [e.type, e.dedupeKey])).toEqual([
      ['pr.opened', `gitlab:${PROJECT}#9:pr.opened:${SHA}`],
      ['pr.checks_completed', `gitlab:${PROJECT}#9:pr.checks_completed:${SHA}:failed-12`],
      ['pr.review_submitted', `gitlab:${PROJECT}#9:pr.review_submitted:${SHA}:501`],
      ['run.failed', `gitlab:${PROJECT}:run.failed:400:1:2026-11-04T12:45:00Z`],
    ]);
    expect(poll.events[1]!.payload).toMatchObject({ repo: PROJECT, number: 9, url: listed.web_url, conclusion: 'failure', failedChecks: 'test: e2e', checkCount: 2 });
    expect(skipped).toEqual([other.web_url]);
    expect(poll.docs).toHaveLength(1);
    expect(poll.docs[0]).toMatchObject({ externalId: `mr:${PROJECT}!9`, uri: listed.web_url, metadata: { kind: 'pull_request', host: 'gitlab', repo: PROJECT, number: 9, state: 'open', headSha: SHA } });
    // The project is one encoded segment on the instance's own API root.
    expect(urls[0]).toMatch(new RegExp(`^${BASE}/api/v4/projects/${ID}/merge_requests\\?per_page=100&state=all&order_by=updated_at&sort=desc&updated_after=2026-11-04T00%3A00%3A00.000Z$`));
  });

  it('a merge request whose head pipeline ran on an older commit has no checks yet', async () => {
    stub([
      [new RegExp(`^/projects/${ID}/merge_requests\\?`), [listed]],
      [new RegExp(`^/projects/${ID}/merge_requests/9$`), { ...whole, head_pipeline: { ...whole.head_pipeline, sha: 'older' } }],
      [new RegExp(`^/projects/${ID}/merge_requests/9/notes`), []],
      [new RegExp(`^/projects/${ID}/pipelines\\?`), []],
    ]);
    const poll = await pollProject(createGitlabClient({ token: 't', baseUrl: BASE }), PROJECT, gitlabConfigSchema.parse({ projects: [PROJECT], baseUrl: BASE }), new Date('2026-11-04T00:00:00Z'));

    expect(poll.events.map(e => e.type)).toEqual(['pr.opened']);
  });

  it('a project GitLab refuses throws with its name, and a malformed path is refused before any request', async () => {
    stub([]);

    await expect(pollProject(createGitlabClient({ token: 't', baseUrl: BASE }), PROJECT, gitlabConfigSchema.parse({ projects: [PROJECT] }), new Date())).rejects.toThrow(/northwind\/platform\/api: merge requests could not be listed .*404/);
    await expect(pollProject(createGitlabClient({ token: 't', baseUrl: BASE }), 'northwind', gitlabConfigSchema.parse({ projects: ['northwind'] }), new Date())).rejects.toThrow(/not a project/);
  });

  it('Test connection says the token\'s scopes and names each project it can or cannot read', async () => {
    stub([
      [/^\/personal_access_tokens\/self$/, { name: 'vocion', scopes: ['read_api'], expires_at: '2027-01-01' }],
      [new RegExp(`^/projects/${ID}$`), { default_branch: 'main', visibility: 'private' }],
      [new RegExp(`^/projects/${ID}/merge_requests\\?`), []],
      [new RegExp(`^/projects/${ID}/pipelines\\?`), []],
    ]);
    const out = await inspectGitlabToken({ token: 'glpat-test', projects: [PROJECT, 'northwind/gone', 'northwind'], baseUrl: BASE });

    expect(out.checks.map(c => [c.key, c.ok])).toEqual([
      ['auth', true],
      ['scope:read', true],
      ['scope:write', false],
      [`project:${PROJECT}`, true],
      [`mrs:${PROJECT}`, true],
      [`pipelines:${PROJECT}`, true],
      ['project:northwind/gone', false],
      ['project:northwind', false],
    ]);
    expect(out.checks.find(c => c.key === 'scope:write')!.detail).toMatch(/needs the api scope/);
    expect(out.checks.find(c => c.key === 'project:northwind/gone')!.detail).toMatch(/404/);
  });

  it('Test connection on a rejected token stops at the token', async () => {
    stub([[/^\/personal_access_tokens\/self$/, { message: '401 Unauthorized' }, 401], [/^\/user$/, { message: '401 Unauthorized' }, 401]]);
    const out = await inspectGitlabToken({ token: 'bad', projects: [PROJECT], baseUrl: BASE });

    expect(out).toMatchObject({ reachable: true, authorized: false, error: expect.stringMatching(/rejected the token/) });
  });

  it('asks for a login or a token, and names the connector and its brand', async () => {
    await expect(gitlabConnector.inspect!({ config: { projects: [PROJECT] }, credentials: {} } as never)).rejects.toThrow(/Connect with GitLab, or paste/);
    expect(gitlabConnector).toMatchObject({ slug: 'gitlab', brand: 'gitlab', category: 'engineering' });
    expect(mergeRequestDoc(PROJECT, { ...listed, state: 'merged', merge_commit_sha: 'm' } as never).metadata).toMatchObject({ state: 'merged', mergeSha: 'm' });
  });
});
