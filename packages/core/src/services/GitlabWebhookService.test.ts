/**
 * The GitLab webhook: the secret is checked before anything is parsed, the
 * project names the workspaces whose gitlab sources list it on that instance,
 * and each delivery becomes the event the poll would raise, read whole with
 * the source's credential when it has one. Sources and GitLab are injected;
 * names are invented.
 */
import type { GitlabSourceRef } from './GitlabWebhookService';
import type { GithubEvent } from '@/libs/github/events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { createGitlabClient } = await import('@/libs/gitlab/client');
const { gitlabConfigSchema } = await import('@/libs/sources/gitlab');
const { handleGitlabWebhook } = await import('./GitlabWebhookService');

const BASE = 'https://gitlab.northwind.example';
const PROJECT = 'northwind/platform/api';
const ID = 'northwind%2Fplatform%2Fapi';
const SHA = '08013a5a95819b3d43fc22e2bac9cd664d8be21b';
const SECRET = 'whsec-northwind';
const project = { path_with_namespace: PROJECT, web_url: `${BASE}/${PROJECT}` };
const mr = { iid: 9, title: 'Reassign a route', state: 'opened', created_at: '2026-11-04T12:00:00Z', updated_at: '2026-11-04T13:00:00Z', source_branch: 'factory/41-reassign', target_branch: 'main', sha: SHA, web_url: `${BASE}/${PROJECT}/-/merge_requests/9`, author: { username: 'factory-bot' }, head_pipeline: { id: 300, project_id: 55, sha: SHA, ref: 'factory/41-reassign', status: 'failed', web_url: `${BASE}/${PROJECT}/-/pipelines/300` } };

const source: GitlabSourceRef = { orgId: 'org_1', sourceId: 3, apiTokenId: 'tok_1', config: gitlabConfigSchema.parse({ projects: [PROJECT], branchPrefix: 'factory/', baseUrl: BASE }) };

function deps(withToken: boolean) {
  const emitted: GithubEvent[] = [];
  const sourcesForProject = vi.fn(async (_project: string, _host: string | null) => [source]);
  return {
    emitted,
    sourcesForProject,
    deps: {
      sourcesForProject,
      clientFor: async () => (withToken ? createGitlabClient({ token: 'glpat-test', baseUrl: BASE }) : null),
      emit: async (_orgId: string, _sourceId: number, event: GithubEvent) => {
        emitted.push(event);
      },
    },
  };
}

function stubGitlab(routes: Array<[RegExp, unknown]>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url).replace(`${BASE}/api/v4`, '');
    const hit = routes.find(([re]) => re.test(path));
    return new Response(JSON.stringify(hit ? hit[1] : { message: '404' }), { status: hit ? 200 : 404 });
  }));
}

const headers = (event: string, token: string | null = SECRET) => new Headers({ 'x-gitlab-event': event, ...(token ? { 'x-gitlab-token': token } : {}) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/webhooks/gitlab', () => {
  it('refuses a delivery without the right token before reading it, and answers 501 with no secret set', async () => {
    const d = deps(true);

    await expect(handleGitlabWebhook({ rawBody: 'not json', headers: headers('Merge Request Hook', 'wrong'), secret: SECRET }, d.deps)).resolves.toMatchObject({ status: 401 });
    await expect(handleGitlabWebhook({ rawBody: '{}', headers: headers('Merge Request Hook', null), secret: SECRET }, d.deps)).resolves.toMatchObject({ status: 401 });
    await expect(handleGitlabWebhook({ rawBody: '{}', headers: headers('Merge Request Hook'), secret: undefined }, d.deps)).resolves.toMatchObject({ status: 501 });
    expect(d.sourcesForProject).not.toHaveBeenCalled();
  });

  it('an opened merge request is read whole and raised with the poll\'s key, for the sources listing it on that instance', async () => {
    stubGitlab([[new RegExp(`^/projects/${ID}/merge_requests/9$`), mr]]);
    const d = deps(true);
    const body = { object_kind: 'merge_request', project, user: { username: 'someone-else' }, object_attributes: { iid: 9, action: 'open', state: 'opened', source_branch: 'factory/41-reassign', target_branch: 'main', url: mr.web_url, last_commit: { id: SHA } } };
    const out = await handleGitlabWebhook({ rawBody: JSON.stringify(body), headers: headers('Merge Request Hook'), secret: SECRET }, d.deps);

    expect(out).toEqual({ status: 200, body: { ok: true, emitted: 1 } });
    expect(d.sourcesForProject).toHaveBeenCalledWith(PROJECT, 'gitlab.northwind.example');
    expect(d.emitted.map(e => [e.type, e.dedupeKey, e.payload.author])).toEqual([['pr.opened', `gitlab:${PROJECT}#9:pr.opened:${SHA}`, 'factory-bot']]);
  });

  it('a source with no credential still gets the lifecycle event, built from the hook', async () => {
    const d = deps(false);
    const body = { project, user: { username: 'factory-bot' }, object_attributes: { iid: 9, action: 'close', state: 'closed', source_branch: 'factory/41-reassign', target_branch: 'main', url: mr.web_url, last_commit: { id: SHA }, updated_at: '2026-11-04 13:00:00 UTC' } };
    await handleGitlabWebhook({ rawBody: JSON.stringify(body), headers: headers('Merge Request Hook'), secret: SECRET }, d.deps);

    expect(d.emitted.map(e => e.type)).toEqual(['pr.closed']);
  });

  it('an approval is read from its system note, keyed on the note as the poll keys it', async () => {
    const now = new Date('2026-11-04T13:05:00Z');
    stubGitlab([
      [new RegExp(`^/projects/${ID}/merge_requests/9$`), mr],
      [new RegExp(`^/projects/${ID}/merge_requests/9/notes`), [{ id: 501, body: 'approved this merge request', system: true, author: { username: 'dana.northwind' }, created_at: '2026-11-04T13:04:00Z' }]],
    ]);
    const d = deps(true);
    const body = { project, user: { username: 'dana.northwind' }, object_attributes: { iid: 9, action: 'approved', state: 'opened', source_branch: 'factory/41-reassign', target_branch: 'main', url: mr.web_url, last_commit: { id: SHA } } };
    await handleGitlabWebhook({ rawBody: JSON.stringify(body), headers: headers('Merge Request Hook'), secret: SECRET }, d.deps, now);

    expect(d.emitted.map(e => [e.type, e.payload.reviewState, e.dedupeKey])).toEqual([['pr.review_submitted', 'approved', `gitlab:${PROJECT}#9:pr.review_submitted:${SHA}:501`]]);
  });

  it('a pipeline that finished on a merge request raises its checks, read from the jobs; one on the deploy branch is a run', async () => {
    stubGitlab([
      [new RegExp(`^/projects/${ID}/merge_requests/9$`), mr],
      [/^\/projects\/55\/pipelines\/300\/jobs/, [{ id: 12, name: 'e2e', stage: 'test', status: 'failed', allow_failure: false }]],
    ]);
    const d = deps(true);
    await handleGitlabWebhook({ rawBody: JSON.stringify({ project, object_attributes: { id: 300, sha: SHA, ref: 'factory/41-reassign', status: 'failed', source: 'merge_request_event' }, merge_request: { iid: 9 } }), headers: headers('Pipeline Hook'), secret: SECRET }, d.deps);
    await handleGitlabWebhook({ rawBody: JSON.stringify({ project, object_attributes: { id: 400, iid: 12, sha: 'cf8b62ce', ref: 'main', status: 'failed', source: 'push', finished_at: '2026-11-04 12:45:00 UTC', url: `${BASE}/${PROJECT}/-/pipelines/400` }, merge_request: null }), headers: headers('Pipeline Hook'), secret: SECRET }, d.deps);

    expect(d.emitted.map(e => [e.type, e.payload.conclusion, e.dedupeKey])).toEqual([
      ['pr.checks_completed', 'failure', `gitlab:${PROJECT}#9:pr.checks_completed:${SHA}:failed-12`],
      ['run.failed', 'failure', `gitlab:${PROJECT}:run.failed:400:1:2026-11-04T12:45:00.000Z`],
    ]);
  });

  it('a project no gitlab source lists is acknowledged and ignored', async () => {
    const d = deps(true);
    d.sourcesForProject.mockResolvedValueOnce([]);
    const out = await handleGitlabWebhook({ rawBody: JSON.stringify({ project, object_attributes: { iid: 9, action: 'open' } }), headers: headers('Merge Request Hook'), secret: SECRET }, d.deps);

    expect(out).toEqual({ status: 200, body: { ok: true, ignored: `no gitlab source lists ${PROJECT}` } });
  });
});
