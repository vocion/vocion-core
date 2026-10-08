/**
 * GitLab connector — the merge requests and issues of the GitLab projects a
 * source lists, as retrievable documents; and the REST client the repo
 * family's GitLab provider (`services/repo/providers/gitlab.ts`) reads merge
 * requests, diffs, files, trees and pipelines with.
 *
 * Auth: a personal, project or group access token (`glpat-…`) as a Bearer
 * token against `<baseUrl>/api/v4` — gitlab.com by default, or a
 * self-managed instance the source names. A project is addressed by its full
 * path (`group/subgroup/project`), URL-encoded, as GitLab documents.
 *
 * Incremental (`ctx.since` set): merge requests and issues with
 * `updated_after` the watermark less five minutes. Full sync: the last
 * `lookbackDays`, so an old, quiet one ages out at the full reconcile. A
 * project that cannot be read is reported (`onProgress` error) and the rest
 * carry on; the run then leaves the watermark and deletes nothing.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { orThrow, vendorRequest } from '@/libs/connectors/vendorRequest';
import { InspectInputError } from './inspect';

export const GITLAB_DEFAULT_URL = 'https://gitlab.com';

export const gitlabConfigSchema = z.object({
  /**
   * The projects to read, by full path: `group/project` or
   * `group/subgroup/project`. Named `repos`, as the github source names its
   * list, so the repo family reads one key whichever host it is.
   */
  repos: z.array(z.string().trim().min(1)).min(1, 'list at least one project'),
  /** The GitLab instance: gitlab.com, or a self-managed one. */
  baseUrl: z.string().url().default(GITLAB_DEFAULT_URL),
  /** How far back a first run, or a full sync, looks. */
  lookbackDays: z.number().int().positive().max(365).default(30),
  /** Index the projects' issues as well as their merge requests. */
  includeIssues: z.boolean().default(true),
});

const WATERMARK_OVERLAP_MS = 5 * 60_000;
const MAX_PAGES = 10;
const PAGE_SIZE = 100;
const BODY_MAX = 8000;

export type GitlabMergeRequest = {
  id: number;
  iid: number;
  title: string;
  description?: string | null;
  state: string;
  draft?: boolean;
  web_url: string;
  source_branch: string;
  target_branch: string;
  sha?: string | null;
  author?: { username?: string | null } | null;
  merged_by?: { username?: string | null } | null;
  merge_user?: { username?: string | null } | null;
  merged_at?: string | null;
  labels?: string[];
  created_at: string;
  updated_at: string;
  head_pipeline?: { id: number; status?: string | null; web_url?: string | null } | null;
  diff_refs?: { base_sha: string; head_sha: string; start_sha: string } | null;
};
export type GitlabIssue = { id: number; iid: number; title: string; description?: string | null; state: string; web_url: string; labels?: string[]; assignees?: Array<{ username?: string | null }>; author?: { username?: string | null } | null; created_at: string; updated_at: string };

/**
 * An instance URL as typed, down to its origin with no trailing slash.
 * @param raw - The URL, possibly with `/api/v4` or a trailing slash.
 */
export function normalizeGitlabUrl(raw: unknown): string {
  const s = typeof raw === 'string' && raw.trim() ? raw.trim() : GITLAB_DEFAULT_URL;
  return s.replace(/\/+$/, '').replace(/\/api\/v4$/i, '');
}

/**
 * The token, or why there is none.
 * @param values - The decrypted credential bag.
 */
export function gitlabTokenFrom(values?: Record<string, unknown> | null): { ok: true; token: string } | { ok: false; message: string } {
  const token = typeof values?.token === 'string' ? values.token.trim() : (typeof values?.accessToken === 'string' ? values.accessToken.trim() : '');
  return token ? { ok: true, token } : { ok: false, message: 'No GitLab access token is stored. Connect GitLab on the Connectors page with a personal access token (read_api, or api for comments, reviews and pipelines).' };
}

/** Where to reach one instance, and as whom. */
export type GitlabAccess = { baseUrl: string; token: string };

/**
 * One call to the instance's REST API.
 * @param a - The instance and token.
 * @param path - The path, from `/api/v4`.
 * @param init - Method, JSON body, and how to read the answer.
 * @param init.method - The HTTP method.
 * @param init.json - The body.
 * @param init.read - `json` (default) or `text`.
 */
export function gitlabApi<T>(a: GitlabAccess, path: string, init: { method?: string; json?: unknown; read?: 'json' | 'text' } = {}): Promise<VendorResult<T>> {
  return vendorRequest<T>({
    vendor: 'GitLab',
    url: `${a.baseUrl}/api/v4${path}`,
    method: init.method,
    json: init.json,
    read: init.read,
    headers: { authorization: `Bearer ${a.token}` },
    authHint: 'Check the access token and its scopes (read_api to read; api to comment, approve or run pipelines), and that it was made on this GitLab instance.',
  });
}

/**
 * A project path as the API addresses it.
 * @param path - `group/project`.
 */
export function gitlabProjectId(path: string): string {
  return encodeURIComponent(path.trim().replace(/^\/+|\/+$/g, ''));
}

function cap(s: string | null | undefined): string {
  const t = (s ?? '').trim();
  return t.length > BODY_MAX ? `${t.slice(0, BODY_MAX)} […]` : t;
}

/**
 * The searchable document for one merge request.
 * @param project - Its project path.
 * @param mr - The merge request.
 */
export function gitlabMergeRequestDoc(project: string, mr: GitlabMergeRequest): IngestDoc {
  return {
    externalId: `gitlab-mr:${mr.id}`,
    title: `${project}!${mr.iid} ${mr.title}`,
    content: [`${project}!${mr.iid} — ${mr.title}`, `State: ${mr.state}${mr.draft ? ' (draft)' : ''} · ${mr.source_branch} → ${mr.target_branch}${mr.author?.username ? ` · by ${mr.author.username}` : ''}`, cap(mr.description)].filter(Boolean).join('\n'),
    uri: mr.web_url,
    lastModifiedAt: new Date(mr.updated_at),
    metadata: { type: 'merge_request', project, iid: mr.iid, state: mr.state, draft: mr.draft === true, author: mr.author?.username ?? null, sourceBranch: mr.source_branch, targetBranch: mr.target_branch, mergedAt: mr.merged_at ?? null, labels: mr.labels ?? [] },
  };
}

/**
 * The searchable document for one issue.
 * @param project - Its project path.
 * @param issue - The issue.
 */
export function gitlabIssueDoc(project: string, issue: GitlabIssue): IngestDoc {
  const assignees = (issue.assignees ?? []).map(a => a.username).filter(Boolean);
  return {
    externalId: `gitlab-issue:${issue.id}`,
    title: `${project}#${issue.iid} ${issue.title}`,
    content: [`${project}#${issue.iid} — ${issue.title}`, [`State: ${issue.state}`, issue.labels?.length ? `Labels: ${issue.labels.join(', ')}` : null, assignees.length ? `Assignees: ${assignees.join(', ')}` : null].filter(Boolean).join(' · '), cap(issue.description)].filter(Boolean).join('\n'),
    uri: issue.web_url,
    lastModifiedAt: new Date(issue.updated_at),
    metadata: { type: 'issue', project, iid: issue.iid, state: issue.state, labels: issue.labels ?? [], assignees, author: issue.author?.username ?? null },
  };
}

/**
 * Every page of a list endpoint, up to the cap.
 * @yields {T[]} One page of rows at a time.
 * @param a - The instance and token.
 * @param path - The list path with its query, without `page`.
 */
async function* pages<T>(a: GitlabAccess, path: string): AsyncIterable<T[]> {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = orThrow(await gitlabApi<T[]>(a, `${path}&per_page=${PAGE_SIZE}&page=${page}`)) ?? [];
    yield rows;
    if (rows.length < PAGE_SIZE) {
      return;
    }
  }
}

/**
 * Test connection: whose token it is, and that each project is readable.
 * @param config - The source config (`repos`, `baseUrl`).
 * @param values - The credential values.
 */
export async function inspectGitlab(config: Record<string, unknown>, values: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = gitlabTokenFrom(values);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const a: GitlabAccess = { baseUrl: normalizeGitlabUrl(config.baseUrl), token: parsed.token };
  const me = await gitlabApi<{ username?: string; name?: string }>(a, '/user');
  if (!me.ok) {
    return { reachable: me.kind !== 'unreachable', authorized: false, checks: [{ key: 'account', label: `Signs in to ${a.baseUrl}`, ok: false, detail: me.message }], note: null, error: me.message };
  }
  const checks: ConnectorCheck[] = [{ key: 'account', label: `Signs in to ${a.baseUrl}`, ok: true, detail: me.data.username ?? me.data.name ?? 'user' }];
  const self = await gitlabApi<{ scopes?: string[] }>(a, '/personal_access_tokens/self');
  if (self.ok && Array.isArray(self.data.scopes)) {
    const scopes = self.data.scopes;
    checks.push({ key: 'scopes', label: 'Token scopes', ok: scopes.includes('api') || scopes.includes('read_api'), detail: `${scopes.join(', ')}${scopes.includes('api') ? '' : ' — read-only: comments, reviews and pipeline actions need api'}` });
  }
  const projects = Array.isArray(config.repos) ? (config.repos as unknown[]).map(String).filter(Boolean) : [];
  for (const project of projects) {
    const p = await gitlabApi<{ name_with_namespace?: string; default_branch?: string }>(a, `/projects/${gitlabProjectId(project)}`);
    checks.push({ key: `project:${project}`, label: `Project ${project}`, ok: p.ok, detail: p.ok ? `${p.data.name_with_namespace ?? project} (default branch ${p.data.default_branch ?? 'none'})` : p.message });
  }
  const failed = checks.filter(c => !c.ok);
  return { reachable: true, authorized: true, checks, note: null, error: failed.length > 0 ? failed.map(c => c.detail).join(' ') : null };
}

export const gitlabConnector: SourceConnector<typeof gitlabConfigSchema> = {
  slug: 'gitlab',
  brand: 'gitlab',
  name: 'GitLab',
  description: 'Merge requests and issues from GitLab projects (gitlab.com or self-managed), synced incrementally by updated time. Agents read merge requests, diffs, files and pipelines live through the code-host tools.',
  icon: 'GitPullRequest',
  authKind: 'apikey',
  configSchema: gitlabConfigSchema,
  defaultReconcileCron: '45 3 * * *',
  inspectNote: 'Reads whose token it is, its scopes, and each project. Read-only. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectGitlab(config, credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = gitlabConfigSchema.parse(ctx.config);
    const parsed = gitlabTokenFrom(ctx.credentials);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const a: GitlabAccess = { baseUrl: normalizeGitlabUrl(cfg.baseUrl), token: parsed.token };
    const after = ctx.since ? new Date(ctx.since.getTime() - WATERMARK_OVERLAP_MS) : new Date(Date.now() - cfg.lookbackDays * 86_400_000);
    const window = `updated_after=${encodeURIComponent(after.toISOString())}&order_by=updated_at&sort=desc&scope=all`;
    for (const project of cfg.repos) {
      const id = gitlabProjectId(project);
      try {
        for await (const rows of pages<GitlabMergeRequest>(a, `/projects/${id}/merge_requests?${window}`)) {
          for (const mr of rows) {
            ctx.onProgress?.({ kind: 'fetched', uri: mr.web_url });
            yield gitlabMergeRequestDoc(project, mr);
          }
        }
        if (cfg.includeIssues) {
          for await (const rows of pages<GitlabIssue>(a, `/projects/${id}/issues?${window}`)) {
            for (const issue of rows) {
              ctx.onProgress?.({ kind: 'fetched', uri: issue.web_url });
              yield gitlabIssueDoc(project, issue);
            }
          }
        }
      } catch (err) {
        // One unreadable project costs that project, not the others.
        ctx.onProgress?.({ kind: 'error', uri: project, message: `${project}: ${(err as Error).message}` });
      }
    }
  },
};
