/**
 * GitLab's pure half: URLs read and written (nested project paths, a
 * self-managed instance, one served under a path prefix), the REST client's
 * request shapes (one URL-encoded project segment, Bearer auth, errors as
 * data, `Link` pagination), and the mapping of merge requests, jobs,
 * approvals and pipelines onto the one event vocabulary with `gitlab:` keys.
 * Shapes are GitLab's own (REST v4, as gitlab.com answered on 2026-11-06);
 * the projects and people are invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitlabClient, hostOfBaseUrl, isProjectPath, nextPageUrl, normalizeBaseUrl, projectId } from './client';
import {
  checkRunsFromJobs,
  conclusionOfJob,
  eventForMergeRequestAction,
  eventsFromGitlabWebhook,
  mergedMergeRequestEvent,
  mergeRequestChecksEvent,
  mergeRequestLifecycleEvents,
  mergeRequestReviewEvents,
  pipelineRunEvent,
  pullFromMergeRequest,
  verifyGitlabToken,
} from './events';
import { mergeRequestUrl, parseMergeRequestUrl, parsePipelineUrl, projectOfUrl } from './urls';

const PROJECT = 'northwind/platform/api';

/**
 * A merge request as `GET /projects/:id/merge_requests/:iid` answers.
 * @param over - Fields that differ from the default merge request.
 */
function mr(over: Record<string, unknown> = {}) {
  return {
    id: 561418873,
    iid: 9,
    project_id: 24075172,
    title: 'Allow a dispatcher to reassign a route',
    description: 'Contract #41',
    state: 'opened',
    created_at: '2026-11-03T23:08:19.073Z',
    updated_at: '2026-11-04T13:08:00.494Z',
    merged_at: null,
    closed_at: null,
    author: { id: 1, username: 'factory-bot', name: 'Factory' },
    merged_by: null,
    merge_user: null,
    reviewers: [{ id: 2, username: 'dana.northwind' }],
    source_branch: 'factory/41-reassign',
    target_branch: 'main',
    sha: '08013a5a95819b3d43fc22e2bac9cd664d8be21b',
    merge_commit_sha: null,
    squash_commit_sha: null,
    draft: false,
    web_url: `https://gitlab.com/${PROJECT}/-/merge_requests/9`,
    labels: ['factory'],
    has_conflicts: false,
    detailed_merge_status: 'mergeable',
    diff_refs: { base_sha: 'cf8b62ce', head_sha: '08013a5a', start_sha: 'cf8b62ce' },
    head_pipeline: { id: 3026842068, iid: 290, project_id: 24075172, sha: '08013a5a95819b3d43fc22e2bac9cd664d8be21b', ref: 'factory/41-reassign', status: 'success', source: 'push', web_url: `https://gitlab.com/${PROJECT}/-/pipelines/3026842068` },
    changes_count: '3',
    ...over,
  };
}

const job = (id: number, name: string, status: string, over: Record<string, unknown> = {}) => ({ id, name, stage: 'test', status, allow_failure: false, web_url: `https://gitlab.com/${PROJECT}/-/jobs/${id}`, finished_at: '2026-11-04T12:06:43.578Z', ...over });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitLab URLs', () => {
  it('reads a merge request on gitlab.com with a nested path, dropping a tab, a query and a fragment', () => {
    expect(parseMergeRequestUrl(`https://gitlab.com/${PROJECT}/-/merge_requests/9/diffs?view=inline#note_4`)).toEqual({ baseUrl: 'https://gitlab.com', host: 'gitlab.com', project: PROJECT, iid: 9, url: `https://gitlab.com/${PROJECT}/-/merge_requests/9` });
    expect(parseMergeRequestUrl('https://gitlab.com/northwind/-/merge_requests/9')).toBeNull();
    expect(parseMergeRequestUrl('https://github.com/Acme/api/pull/9')).toBeNull();
  });

  it('reads a self-managed instance, and strips the path prefix an instance is served under', () => {
    expect(parseMergeRequestUrl('https://gitlab.northwind.example/northwind/api/-/merge_requests/3')?.project).toBe('northwind/api');
    expect(parseMergeRequestUrl('https://code.northwind.example/gitlab/northwind/platform/api/-/merge_requests/3', ['https://code.northwind.example/gitlab'])).toMatchObject({ baseUrl: 'https://code.northwind.example/gitlab', project: PROJECT, url: 'https://code.northwind.example/gitlab/northwind/platform/api/-/merge_requests/3' });
    expect(parsePipelineUrl(`https://gitlab.northwind.example/${PROJECT}/-/pipelines/123`)).toMatchObject({ project: PROJECT, pipelineId: 123 });
    expect(mergeRequestUrl('https://gitlab.northwind.example/', PROJECT, 4)).toBe(`https://gitlab.northwind.example/${PROJECT}/-/merge_requests/4`);
  });

  it('names the project a clone or web URL is for, only on its own instance', () => {
    expect(projectOfUrl(`https://gitlab.com/${PROJECT}.git`, 'https://gitlab.com')).toBe(PROJECT);
    expect(projectOfUrl(`https://gitlab.com/${PROJECT}/-/tree/main`, 'https://gitlab.com')).toBe(PROJECT);
    expect(projectOfUrl(`https://gitlab.northwind.example/${PROJECT}.git`, 'https://gitlab.com')).toBeNull();
    expect(projectOfUrl('https://gitlab.com/northwind.git', 'https://gitlab.com')).toBeNull();
  });
});

describe('the GitLab client', () => {
  it('names a project by its whole path as one encoded segment, and an instance without its API root', () => {
    expect(projectId(PROJECT)).toBe('northwind%2Fplatform%2Fapi');
    expect(isProjectPath(PROJECT)).toBe(true);
    expect(isProjectPath('northwind')).toBe(false);
    expect(normalizeBaseUrl('https://gitlab.northwind.example/api/v4/')).toBe('https://gitlab.northwind.example');
    expect(normalizeBaseUrl(undefined)).toBe('https://gitlab.com');
    expect(hostOfBaseUrl('https://gitlab.northwind.example')).toBe('gitlab.northwind.example');
    expect(nextPageUrl('<https://gitlab.com/api/v4/x?page=2>; rel="next", <https://gitlab.com/api/v4/x?page=1>; rel="first"')).toBe('https://gitlab.com/api/v4/x?page=2');
  });

  it('sends the token as Bearer to the instance\'s API, walks pages by Link, and returns a refusal as data', async () => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.authorization });
      if (String(url).includes('page=2')) {
        return new Response(JSON.stringify([{ iid: 2 }]), { status: 200 });
      }
      if (String(url).includes('/merge_requests')) {
        return new Response(JSON.stringify([{ iid: 1 }]), { status: 200, headers: { link: `<https://gitlab.northwind.example/api/v4/projects/${projectId(PROJECT)}/merge_requests?page=2>; rel="next"` } });
      }
      return new Response(JSON.stringify({ message: '404 Project Not Found' }), { status: 404 });
    }));
    const client = createGitlabClient({ token: 'glpat-test', baseUrl: 'https://gitlab.northwind.example' });
    const list = await client.list<{ iid: number }>(`/projects/${projectId(PROJECT)}/merge_requests`, { state: 'opened' });

    expect(list).toMatchObject({ ok: true, data: [{ iid: 1 }, { iid: 2 }], truncated: false });
    expect(seen[0]!.url).toBe(`https://gitlab.northwind.example/api/v4/projects/northwind%2Fplatform%2Fapi/merge_requests?per_page=100&state=opened`);
    expect(seen[0]!.auth).toBe('Bearer glpat-test');

    const missing = await client.get('/projects/northwind%2Fgone');

    expect(missing).toEqual({ ok: false, status: 404, message: expect.stringMatching(/404 Project Not Found.*private project the token was not granted/) });
  });

  it('reads a public project without a token, sending no auth header at all', async () => {
    const headers: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      headers.push(init?.headers as Record<string, string>);
      return new Response('{}', { status: 200 });
    }));
    await createGitlabClient({}).get('/projects/1');

    expect(headers[0]).not.toHaveProperty('authorization');
  });
});

describe('GitLab constructs as the one event vocabulary', () => {
  it('a merge request is a pull request: iid the number, opened is open, merged is closed with its merge time', () => {
    expect(pullFromMergeRequest(mr() as never)).toMatchObject({ number: 9, state: 'open', html_url: `https://gitlab.com/${PROJECT}/-/merge_requests/9`, head: { ref: 'factory/41-reassign', sha: mr().sha }, base: { ref: 'main' }, user: { login: 'factory-bot' }, requested_reviewers: [{ login: 'dana.northwind' }], mergeable: true });
    expect(pullFromMergeRequest(mr({ state: 'merged', merged_at: '2026-11-05T10:00:00Z', squash_commit_sha: 'abc123', merge_user: { username: 'dana.northwind' } }) as never)).toMatchObject({ state: 'closed', merged_at: '2026-11-05T10:00:00Z', merge_commit_sha: 'abc123', merged_by: { login: 'dana.northwind' } });
    expect(pullFromMergeRequest(mr({ has_conflicts: true, detailed_merge_status: 'conflict' }) as never)).toMatchObject({ mergeable: false, mergeable_state: 'dirty' });
  });

  it('a job\'s status is a check\'s verdict: allowed failures and unstarted manual jobs pass, running ones are not done', () => {
    expect(conclusionOfJob('success')).toEqual({ status: 'completed', conclusion: 'success' });
    expect(conclusionOfJob('failed')).toEqual({ status: 'completed', conclusion: 'failure' });
    expect(conclusionOfJob('failed', true)).toEqual({ status: 'completed', conclusion: 'neutral' });
    expect(conclusionOfJob('manual')).toEqual({ status: 'completed', conclusion: 'skipped' });
    expect(conclusionOfJob('canceled')).toEqual({ status: 'completed', conclusion: 'cancelled' });
    expect(conclusionOfJob('running')).toEqual({ status: 'in_progress', conclusion: null });
    expect(checkRunsFromJobs([job(1, 'unit', 'success')])).toEqual([{ id: 1, name: 'test: unit', status: 'completed', conclusion: 'success' }]);
  });

  it('raises GitHub\'s payloads keyed as GitLab\'s, with the nested path as the repo', () => {
    const [opened] = mergeRequestLifecycleEvents(PROJECT, mr() as never, null);

    expect(opened).toMatchObject({ type: 'pr.opened', dedupeKey: `gitlab:${PROJECT}#9:pr.opened:${mr().sha}`, payload: { repo: PROJECT, number: 9, branch: 'factory/41-reassign', baseBranch: 'main', author: 'factory-bot', state: 'open', draft: false, dedupeKey: `gitlab:${PROJECT}#9:pr.opened:${mr().sha}` } });

    const red = mergeRequestChecksEvent(PROJECT, mr() as never, [job(11, 'unit', 'success'), job(12, 'e2e', 'failed'), job(13, 'lint', 'failed', { allow_failure: true })]);

    expect(red).toMatchObject({ type: 'pr.checks_completed', dedupeKey: `gitlab:${PROJECT}#9:pr.checks_completed:${mr().sha}:failed-13`, payload: { conclusion: 'failure', failedChecks: 'test: e2e', failedCheckCount: 1, checkCount: 3 } });
    expect(mergeRequestChecksEvent(PROJECT, mr() as never, [job(11, 'unit', 'running')])).toBeNull();
    expect(mergeRequestChecksEvent(PROJECT, mr() as never, [])).toBeNull();

    const merged = mergedMergeRequestEvent(PROJECT, mr({ state: 'merged', merged_at: '2026-11-05T10:00:00Z', merge_commit_sha: 'm3rge' }) as never);

    expect(merged).toMatchObject({ type: 'pr.merged', dedupeKey: `gitlab:${PROJECT}#9:pr.merged:${mr().sha}`, payload: { mergeSha: 'm3rge', mergedAt: '2026-11-05T10:00:00Z' } });
  });

  it('an approval, an unapproval and a request for changes are reviews, read from GitLab\'s own system notes', () => {
    const notes = [
      { id: 501, body: 'approved this merge request', system: true, author: { username: 'dana.northwind' }, created_at: '2026-11-04T13:00:00Z' },
      { id: 502, body: 'unapproved this merge request', system: true, author: { username: 'dana.northwind' }, created_at: '2026-11-04T13:05:00Z' },
      { id: 503, body: 'requested changes', system: true, author: { username: 'lee.northwind' }, created_at: '2026-11-04T13:06:00Z' },
      { id: 504, body: 'I approved this merge request in my head', system: false, author: { username: 'lee.northwind' }, created_at: '2026-11-04T13:07:00Z' },
      { id: 400, body: 'approved this merge request', system: true, author: { username: 'old' }, created_at: '2026-10-01T00:00:00Z' },
    ];
    const events = mergeRequestReviewEvents(PROJECT, mr() as never, notes, new Date('2026-11-04T00:00:00Z'));

    expect(events.map(e => [e.payload.reviewState, e.payload.reviewer, e.payload.reviewId, e.dedupeKey])).toEqual([
      ['approved', 'dana.northwind', 501, `gitlab:${PROJECT}#9:pr.review_submitted:${mr().sha}:501`],
      ['dismissed', 'dana.northwind', 502, `gitlab:${PROJECT}#9:pr.review_submitted:${mr().sha}:502`],
      ['changes_requested', 'lee.northwind', 503, `gitlab:${PROJECT}#9:pr.review_submitted:${mr().sha}:503`],
    ]);
    expect(events[0]!.payload.reviewUrl).toBe(`https://gitlab.com/${PROJECT}/-/merge_requests/9#note_501`);
  });

  it('a finished pipeline on the deploy branch is a run; a retry that finishes again is a new event', () => {
    const pipeline = { id: 3036094944, iid: 7201, project_id: 24075172, sha: 'cf8b62ce88aa', ref: 'main', status: 'failed', source: 'push', created_at: '2026-11-06T10:13:36.683Z', updated_at: '2026-11-06T11:21:03.649Z', web_url: `https://gitlab.com/${PROJECT}/-/pipelines/3036094944`, name: null };
    const failed = pipelineRunEvent(PROJECT, pipeline);

    expect(failed).toMatchObject({ type: 'run.failed', payload: { repo: PROJECT, runId: 3036094944, runNumber: 7201, name: 'pipeline', branch: 'main', headSha: 'cf8b62ce88aa', event: 'push', conclusion: 'failure', path: '.gitlab-ci.yml', url: pipeline.web_url } });
    expect(failed!.dedupeKey).toBe(`gitlab:${PROJECT}:run.failed:3036094944:1:2026-11-06T11:21:03.649Z`);
    expect(pipelineRunEvent(PROJECT, { ...pipeline, updated_at: '2026-11-06T12:00:00.000Z' })!.dedupeKey).not.toBe(failed!.dedupeKey);
    expect(pipelineRunEvent(PROJECT, { ...pipeline, status: 'success' })!.type).toBe('run.succeeded');
    expect(pipelineRunEvent(PROJECT, { ...pipeline, status: 'running' })).toBeNull();
    expect(pipelineRunEvent(PROJECT, { ...pipeline, status: 'canceled' })).toBeNull();
  });
});

describe('GitLab webhook deliveries', () => {
  it('checks X-Gitlab-Token in constant time, and says why it refused', () => {
    expect(verifyGitlabToken('s3cret', 's3cret')).toEqual({ ok: true });
    expect(verifyGitlabToken('s3cre7', 's3cret')).toEqual({ ok: false, reason: 'bad_token' });
    expect(verifyGitlabToken(null, 's3cret')).toEqual({ ok: false, reason: 'missing_token' });
    expect(verifyGitlabToken('s3cret', undefined)).toEqual({ ok: false, reason: 'missing_secret' });
  });

  const project = { path_with_namespace: PROJECT, web_url: `https://gitlab.northwind.example/${PROJECT}` };

  it('a merge request hook maps its action onto the lifecycle event, from the hook alone', () => {
    const hook = { object_kind: 'merge_request', user: { username: 'factory-bot' }, project, object_attributes: { iid: 9, title: 'Reassign', state: 'opened', action: 'open', source_branch: 'factory/41-reassign', target_branch: 'main', url: `https://gitlab.northwind.example/${PROJECT}/-/merge_requests/9`, created_at: '2026-11-04 12:00:00 UTC', updated_at: '2026-11-04 12:00:00 UTC', last_commit: { id: 'abc123' } } };
    const out = eventsFromGitlabWebhook('Merge Request Hook', hook, 'main');

    expect(out).toMatchObject({ project: PROJECT, host: 'gitlab.northwind.example', mergeRequest: { iid: 9, action: 'open' } });
    expect(out!.events.map(e => [e.type, e.dedupeKey, e.payload.author])).toEqual([['pr.opened', `gitlab:${PROJECT}#9:pr.opened:abc123`, 'factory-bot']]);

    const pushed = eventsFromGitlabWebhook('Merge Request Hook', { ...hook, object_attributes: { ...hook.object_attributes, action: 'update', oldrev: 'aaa' } }, 'main');

    expect(pushed!.events.map(e => e.type)).toEqual(['pr.synchronized']);
    expect(eventsFromGitlabWebhook('Merge Request Hook', { ...hook, object_attributes: { ...hook.object_attributes, action: 'update' } }, 'main')!.events).toEqual([]);
    expect(eventsFromGitlabWebhook('Merge Request Hook', { ...hook, object_attributes: { ...hook.object_attributes, action: 'approved' } }, 'main')!.events).toEqual([]);
  });

  it('the same merge request read whole earns the same key the poll raises', () => {
    const read = mr({ web_url: `https://gitlab.northwind.example/${PROJECT}/-/merge_requests/9` });

    expect(eventForMergeRequestAction(PROJECT, 'open', read as never, false)!.dedupeKey).toBe(mergeRequestLifecycleEvents(PROJECT, { ...read, created_at: '2026-11-04T13:08:00.494Z' } as never, null)[0]!.dedupeKey);
    expect(eventForMergeRequestAction(PROJECT, 'close', { ...read, state: 'closed' } as never, false)).toMatchObject({ type: 'pr.closed' });
    expect(eventForMergeRequestAction(PROJECT, 'merge', read as never, false)).toMatchObject({ type: 'pr.merged' });
  });

  it('a pipeline hook names the merge request to read checks for, a deploy-branch run, or a branch pipeline', () => {
    const pipeline = { id: 77, iid: 5, sha: 'abc123', ref: 'factory/41-reassign', status: 'success', source: 'merge_request_event', finished_at: '2026-11-04 12:06:48 UTC', created_at: '2026-11-04 11:43:26 UTC', url: `https://gitlab.northwind.example/${PROJECT}/-/pipelines/77` };

    expect(eventsFromGitlabWebhook('Pipeline Hook', { project, object_attributes: pipeline, merge_request: { iid: 9 } }, 'main')).toMatchObject({ checksFor: [{ iid: 9 }], events: [] });
    expect(eventsFromGitlabWebhook('Pipeline Hook', { project, object_attributes: { ...pipeline, ref: 'main', source: 'push', status: 'failed' }, merge_request: null }, 'main')!.events.map(e => [e.type, e.payload.url])).toEqual([['run.failed', pipeline.url]]);
    expect(eventsFromGitlabWebhook('Pipeline Hook', { project, object_attributes: { ...pipeline, source: 'push' }, merge_request: null }, 'main')).toMatchObject({ branchPipeline: { ref: 'factory/41-reassign', sha: 'abc123' }, events: [] });
    expect(eventsFromGitlabWebhook('Pipeline Hook', { project, object_attributes: { ...pipeline, status: 'running' } }, 'main')).toMatchObject({ events: [], checksFor: [] });
    expect(eventsFromGitlabWebhook('Push Hook', { project }, 'main')).toMatchObject({ events: [] });
    expect(eventsFromGitlabWebhook('Merge Request Hook', {}, 'main')).toBeNull();
  });
});
