/**
 * GitLab connector against recorded REST answers: merge requests and issues
 * of each listed project become documents, an incremental run asks only for
 * what changed, an unreadable project is reported without costing the
 * others, and Test connection says whose token it is, its scopes, and which
 * projects it reads. The projects are invented.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitlabConnector, normalizeGitlabUrl } from './gitlab';

function vendor(route: (url: string) => [unknown, number?]) {
  const urls: Array<{ url: string; auth: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    urls.push({ url, auth: (init.headers as Record<string, string>).authorization ?? '' });
    const [body, status] = route(url);
    return new Response(JSON.stringify(body), { status: status ?? 200 });
  }));
  return urls;
}

async function collect(docs: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of docs) {
    out.push(d);
  }
  return out;
}

const MR = { id: 9001, iid: 12, title: 'Retry webhook deliveries', description: 'Adds backoff.', state: 'opened', draft: false, web_url: 'https://gitlab.example/acme/api/-/merge_requests/12', source_branch: 'feat/retry', target_branch: 'main', author: { username: 'jamie' }, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' };
const ISSUE = { id: 7001, iid: 4, title: 'Webhooks drop under load', state: 'opened', web_url: 'https://gitlab.example/acme/api/-/issues/4', labels: ['bug'], assignees: [{ username: 'jamie' }], created_at: '2026-09-30T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gitlab sync', () => {
  it('yields merge requests and issues per project on the named instance, and reports an unreadable project without stopping', async () => {
    const urls = vendor((url) => {
      if (url.includes('acme%2Fgone')) {
        return [{ message: '404 Project Not Found' }, 404];
      }
      return [url.includes('/merge_requests?') ? [MR] : [ISSUE]];
    });
    const errors: string[] = [];
    const ctx: SourceContext = { sourceId: 1, orgId: 'org_1', config: { repos: ['acme/gone', 'acme/api'], baseUrl: 'https://gitlab.example/' }, credentials: { token: 'glpat-northwind' }, onProgress: e => e.kind === 'error' && errors.push(e.message ?? '') };

    const docs = await collect(gitlabConnector.sync(ctx));

    expect(docs.map(d => d.externalId)).toEqual(['gitlab-mr:9001', 'gitlab-issue:7001']);
    expect(docs[0]).toMatchObject({ title: 'acme/api!12 Retry webhook deliveries', metadata: { type: 'merge_request', iid: 12, sourceBranch: 'feat/retry' } });
    expect(docs[1]).toMatchObject({ title: 'acme/api#4 Webhooks drop under load', metadata: { type: 'issue', labels: ['bug'], assignees: ['jamie'] } });
    expect(errors).toEqual([expect.stringContaining('acme/gone: GitLab has nothing there')]);
    expect(urls.every(u => u.url.startsWith('https://gitlab.example/api/v4/') && u.auth === 'Bearer glpat-northwind')).toBe(true);
  });

  it('asks only for what changed since the watermark, less five minutes', async () => {
    const urls = vendor(() => [[]]);
    const since = new Date('2026-10-08T10:00:00Z');

    await collect(gitlabConnector.sync({ sourceId: 1, orgId: 'org_1', config: { repos: ['acme/api'], includeIssues: false }, credentials: { token: 't' }, since }));

    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]!.url).searchParams.get('updated_after')).toBe('2026-10-08T09:55:00.000Z');
    expect(urls[0]!.url.startsWith('https://gitlab.com/api/v4/projects/acme%2Fapi/merge_requests?')).toBe(true);
    expect(normalizeGitlabUrl('https://gitlab.example/api/v4/')).toBe('https://gitlab.example');
  });

  it('Test connection names the account, its scopes, and each project', async () => {
    vendor((url) => {
      if (url.endsWith('/user')) {
        return [{ username: 'jamie' }];
      }
      if (url.includes('personal_access_tokens/self')) {
        return [{ scopes: ['read_api'] }];
      }
      return [{ name_with_namespace: 'Acme / API', default_branch: 'main' }];
    });

    const out = await gitlabConnector.inspect!({ config: { repos: ['acme/api'] }, credentials: { token: 'glpat-x' }, options: {} }) as { checks: Array<{ key: string; ok: boolean; detail: string }> };

    expect(out.checks).toEqual([
      expect.objectContaining({ key: 'account', ok: true, detail: 'jamie' }),
      expect.objectContaining({ key: 'scopes', ok: true, detail: expect.stringContaining('read-only') }),
      expect.objectContaining({ key: 'project:acme/api', ok: true, detail: 'Acme / API (default branch main)' }),
    ]);
  });
});
