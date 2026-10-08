/**
 * GitLab as a code host — the second `RepoProvider` (`../provider.ts`).
 *
 * GitLab's names for the family's constructs: a pull request is a merge
 * request (`!12`, addressed by its project-scoped `iid`), a check is a job of
 * the merge request's head pipeline, a review is an approval plus a note, and
 * a pipeline run is a pipeline. Every call rides the credential of the
 * enabled `gitlab` source that lists the project (`credentialsForSource`), on
 * the instance that source names — gitlab.com or self-managed — so a project
 * the workspace did not connect answers nothing.
 *
 * Where GitLab differs, this file says so rather than pretending: "request
 * changes" has no REST call, so such a review is a note that says it;
 * dismissing a review unapproves and deletes its note.
 */

import type { PipelineRunRef, PipelineRunSummary, PullRequestSummary, RepoFile, RepoProvider, RepoTree, RepoTreeEntry } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { GitlabAccess, GitlabMergeRequest } from '@/libs/sources/gitlab';
import { familySourcesForOrg } from '@/libs/connectors/families';
import { orThrow } from '@/libs/connectors/vendorRequest';
import { gitlabApi, gitlabProjectId, gitlabTokenFrom, normalizeGitlabUrl } from '@/libs/sources/gitlab';
import { credentialsForSource } from '@/services/connectors/sourceCredentials';

const BODY_MAX = 20_000;
const FILES_MAX = 200;
const DIFF_MAX = 60_000;
const FILE_MAX = 60_000;
const TREE_PAGES_MAX = 50;
const FINISHED = new Set(['success', 'failed', 'canceled', 'skipped', 'manual']);

type GitlabDiff = { old_path: string; new_path: string; new_file?: boolean; renamed_file?: boolean; deleted_file?: boolean; diff?: string };
type GitlabJob = { id: number; name: string; stage?: string | null; status: string };
type GitlabPipeline = { id: number; status: string; ref?: string | null; sha?: string | null; source?: string | null; web_url: string; created_at?: string | null };

/**
 * The enabled gitlab sources of a workspace, with their instance.
 * @param orgId - The workspace.
 */
async function gitlabSources(orgId: string): Promise<Array<{ source: FamilySource; baseUrl: string; projects: string[] }>> {
  const sources = (await familySourcesForOrg(orgId, 'repo')).filter(s => s.kind === 'gitlab');
  return sources.map(source => ({
    source,
    baseUrl: normalizeGitlabUrl(source.config.baseUrl),
    projects: Array.isArray(source.config.repos) ? (source.config.repos as unknown[]).map(p => String(p).trim().replace(/^\/+|\/+$/g, '')) : [],
  }));
}

function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The provider for a host an enabled gitlab source names, or null.
 * @param orgId - The workspace.
 * @param host - A hostname, as `hostOf` gives it.
 */
export async function gitlabProviderForHost(orgId: string, host: string): Promise<RepoProvider | null> {
  const hit = (await gitlabSources(orgId)).find(s => hostOfUrl(s.baseUrl) === host);
  return hit ? gitlabRepoProvider(hit.baseUrl) : null;
}

/**
 * The provider for a bare project path an enabled gitlab source lists, or null.
 * @param orgId - The workspace.
 * @param path - `group/project`.
 */
export async function gitlabProviderForRepo(orgId: string, path: string): Promise<RepoProvider | null> {
  const wanted = path.toLowerCase();
  const hit = (await gitlabSources(orgId)).find(s => s.projects.some(p => p.toLowerCase() === wanted));
  return hit ? gitlabRepoProvider(hit.baseUrl) : null;
}

/**
 * The credential for a project on an instance: the enabled gitlab source on
 * that instance that lists it. Refused by name otherwise.
 * @param orgId - The workspace.
 * @param baseUrl - The instance.
 * @param repo - The project path.
 */
async function accessFor(orgId: string, baseUrl: string, repo: string): Promise<GitlabAccess> {
  const wanted = repo.toLowerCase();
  const hit = (await gitlabSources(orgId)).find(s => s.baseUrl === baseUrl && s.projects.some(p => p.toLowerCase() === wanted));
  if (!hit) {
    throw new Error(`${repo} is not a project this workspace connected on ${baseUrl}: no enabled GitLab source lists it. Add it to the source's projects (repos).`);
  }
  const parsed = gitlabTokenFrom(await credentialsForSource(orgId, hit.source));
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return { baseUrl, token: parsed.token };
}

/**
 * A diff cut to what one read can hold, with a line that says so.
 * @param diff - The whole diff.
 */
function capDiff(diff: string): string {
  return diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n\n[Diff truncated at ${DIFF_MAX} of ${diff.length} characters, to keep this read whole.]` : diff;
}

/**
 * GitLab's per-file diffs as one unified diff, with the `diff --git` headers
 * the family's path checks read.
 * @param diffs - The files, as GitLab lists them.
 */
export function unifiedDiff(diffs: GitlabDiff[]): string {
  return diffs.map((d) => {
    const head = [`diff --git a/${d.old_path} b/${d.new_path}`];
    if (d.new_file) {
      head.push('new file mode 100644');
    }
    if (d.deleted_file) {
      head.push('deleted file mode 100644');
    }
    head.push(`--- ${d.new_file ? '/dev/null' : `a/${d.old_path}`}`, `+++ ${d.deleted_file ? '/dev/null' : `b/${d.new_path}`}`);
    const body = d.diff ?? '';
    return `${head.join('\n')}\n${body}${body.endsWith('\n') ? '' : '\n'}`;
  }).join('');
}

function lineCounts(diff: string | undefined): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of (diff ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function checkOf(job: GitlabJob): { name: string; status: string; conclusion: string | null } {
  if (job.status === 'running') {
    return { name: job.name, status: 'in_progress', conclusion: null };
  }
  if (job.status === 'pending' || job.status === 'created' || job.status === 'waiting_for_resource' || job.status === 'preparing' || job.status === 'scheduled') {
    return { name: job.name, status: 'queued', conclusion: null };
  }
  const conclusion = job.status === 'failed' ? 'failure' : job.status === 'canceled' ? 'cancelled' : job.status;
  return { name: job.name, status: 'completed', conclusion };
}

/**
 * The repo provider for one GitLab instance.
 * @param rawBaseUrl - The instance, as a source names it.
 */
export function gitlabRepoProvider(rawBaseUrl: string): RepoProvider {
  const baseUrl = normalizeGitlabUrl(rawBaseUrl);
  const mrPath = (repo: string, iid: number) => `/projects/${gitlabProjectId(repo)}/merge_requests/${iid}`;
  const pullUrl = (repo: string, number: number) => `${baseUrl}/${repo}/-/merge_requests/${number}`;

  /**
   * The part of a URL on this instance after its base, or null.
   * @param url - A URL, perhaps on this instance.
   */
  const onInstance = (url: string): string | null => {
    const clean = url.trim().replace(/[?#].*$/, '');
    return clean.toLowerCase().startsWith(`${baseUrl.toLowerCase()}/`) ? clean.slice(baseUrl.length + 1) : null;
  };

  const diffsOf = async (a: GitlabAccess, repo: string, iid: number): Promise<GitlabDiff[]> => {
    const res = await gitlabApi<GitlabDiff[]>(a, `${mrPath(repo, iid)}/diffs?per_page=100`);
    if (res.ok) {
      return res.data ?? [];
    }
    // Instances older than 15.7 have only the deprecated `changes`.
    if (res.kind === 'not_found') {
      return (orThrow(await gitlabApi<{ changes?: GitlabDiff[] }>(a, `${mrPath(repo, iid)}/changes`)).changes) ?? [];
    }
    throw new Error(res.message);
  };

  const defaultBranch = async (a: GitlabAccess, repo: string): Promise<string> => {
    const meta = orThrow(await gitlabApi<{ default_branch?: string | null }>(a, `/projects/${gitlabProjectId(repo)}`));
    if (!meta?.default_branch) {
      throw new Error(`${repo} names no default branch (an empty project?); ask for a ref.`);
    }
    return meta.default_branch;
  };

  return {
    kind: 'gitlab',
    label: 'GitLab',
    pullUrl,

    parsePullRef(url) {
      const rest = onInstance(url);
      const m = rest ? /^(.+?)\/-\/merge_requests\/(\d+)/.exec(rest) : null;
      return m ? { repo: m[1]!, number: Number(m[2]), url: pullUrl(m[1]!, Number(m[2])) } : null;
    },

    parseRunRef(url) {
      const rest = onInstance(url);
      const m = rest ? /^(.+?)\/-\/pipelines\/(\d+)/.exec(rest) : null;
      return m ? { repo: m[1]!, runId: Number(m[2]), url: `${baseUrl}/${m[1]}/-/pipelines/${m[2]}` } : null;
    },

    async readPull(orgId, ref): Promise<PullRequestSummary> {
      const a = await accessFor(orgId, baseUrl, ref.repo);
      const mr = orThrow(await gitlabApi<GitlabMergeRequest>(a, mrPath(ref.repo, ref.number)));
      const [diffs, approvals, jobs] = await Promise.all([
        diffsOf(a, ref.repo, ref.number).catch(() => [] as GitlabDiff[]),
        gitlabApi<{ approved_by?: Array<{ user?: { username?: string } }> }>(a, `${mrPath(ref.repo, ref.number)}/approvals`),
        mr.head_pipeline ? gitlabApi<GitlabJob[]>(a, `/projects/${gitlabProjectId(ref.repo)}/pipelines/${mr.head_pipeline.id}/jobs?per_page=100`) : Promise.resolve(null),
      ]);
      const files = diffs.map((d) => {
        const counts = lineCounts(d.diff);
        return { path: d.new_path, status: d.new_file ? 'added' : d.deleted_file ? 'removed' : d.renamed_file ? 'renamed' : 'modified', ...counts };
      });
      const body = mr.description ?? '';
      return {
        repo: ref.repo,
        number: ref.number,
        url: mr.web_url,
        title: mr.title,
        body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)}\n\n[Description cut at ${BODY_MAX} of ${body.length} characters.]` : body,
        author: mr.author?.username ?? null,
        state: mr.state === 'opened' ? 'open' : mr.state,
        draft: mr.draft === true,
        merged: mr.state === 'merged',
        mergedBy: mr.merge_user?.username ?? mr.merged_by?.username ?? null,
        headBranch: mr.source_branch,
        headSha: mr.sha ?? '',
        baseBranch: mr.target_branch,
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: files.reduce((n, f) => n + f.deletions, 0),
        changedFileCount: files.length,
        files: files.slice(0, FILES_MAX),
        reviews: approvals.ok ? (approvals.data.approved_by ?? []).map(r => ({ reviewer: r.user?.username ?? null, state: 'APPROVED', submittedAt: null })) : [],
        checks: jobs?.ok ? (jobs.data ?? []).map(checkOf) : [],
        labels: mr.labels ?? [],
        createdAt: mr.created_at,
        updatedAt: mr.updated_at,
      };
    },

    async readPullDiff(orgId, ref) {
      const a = await accessFor(orgId, baseUrl, ref.repo);
      return capDiff(unifiedDiff(await diffsOf(a, ref.repo, ref.number)));
    },

    async readCompareDiff(orgId, repo, base, head) {
      const a = await accessFor(orgId, baseUrl, repo);
      const res = orThrow(await gitlabApi<{ diffs?: GitlabDiff[] }>(a, `/projects/${gitlabProjectId(repo)}/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`));
      return capDiff(unifiedDiff(res.diffs ?? []));
    },

    async readFile(orgId, repo, path, ref): Promise<RepoFile> {
      const a = await accessFor(orgId, baseUrl, repo);
      const clean = path.replace(/^\.?\//, '');
      // Segments under the project root and nothing else: no `..` that URL
      // normalisation could fold into another API route.
      const segments = clean.split('/');
      if (clean.length === 0 || segments.some(s => s.length === 0 || s === '.' || s === '..')) {
        throw new Error(`${repo}: "${path}" is not a path inside the repository`);
      }
      const at = ref?.trim() || await defaultBranch(a, repo);
      const res = await gitlabApi<string>(a, `/projects/${gitlabProjectId(repo)}/repository/files/${encodeURIComponent(clean)}/raw?ref=${encodeURIComponent(at)}`, { read: 'text' });
      if (!res.ok) {
        throw new Error(`${repo}/${clean} @ ${at} could not be read: ${res.message}${res.kind === 'not_found' ? ' (a path that is a folder also answers 404)' : ''}`);
      }
      const truncated = res.data.length > FILE_MAX;
      return { repo, path: clean, ref: ref ?? null, size: res.data.length, text: truncated ? res.data.slice(0, FILE_MAX) : res.data, truncated };
    },

    async readTree(orgId, repo, ref): Promise<RepoTree> {
      const a = await accessFor(orgId, baseUrl, repo);
      const at = ref?.trim() || await defaultBranch(a, repo);
      const entries: RepoTreeEntry[] = [];
      let truncated = false;
      for (let page = 1; ; page += 1) {
        if (page > TREE_PAGES_MAX) {
          truncated = true;
          break;
        }
        const rows = orThrow(await gitlabApi<Array<{ path: string; type: string }>>(a, `/projects/${gitlabProjectId(repo)}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(at)}`)) ?? [];
        for (const e of rows) {
          if (e.type === 'blob' || e.type === 'tree') {
            entries.push({ path: e.path, type: e.type });
          }
        }
        if (rows.length < 100) {
          break;
        }
      }
      return { repo, ref: at, truncated, entries };
    },

    async commentPull(orgId, ref, body) {
      const a = await accessFor(orgId, baseUrl, ref.repo);
      const note = orThrow(await gitlabApi<{ id: number }>(a, `${mrPath(ref.repo, ref.number)}/notes`, { method: 'POST', json: { body } }));
      return { commentId: note.id, url: `${pullUrl(ref.repo, ref.number)}#note_${note.id}` };
    },

    async deletePullComment(orgId, repo, commentId, pullNumber) {
      if (!pullNumber) {
        throw new Error(`GitLab files a note under its merge request, and this run did not record which one; delete note ${commentId} on ${repo} by hand.`);
      }
      const a = await accessFor(orgId, baseUrl, repo);
      const res = await gitlabApi(a, `${mrPath(repo, pullNumber)}/notes/${commentId}`, { method: 'DELETE', read: 'text' });
      // 404: someone already deleted it, which is what the undo was for.
      if (!res.ok && res.kind !== 'not_found') {
        throw new Error(res.message);
      }
    },

    async submitReview(orgId, ref, review) {
      const a = await accessFor(orgId, baseUrl, ref.repo);
      const prefix = review.event === 'request_changes' ? '**Changes requested.**\n\n' : '';
      const note = orThrow(await gitlabApi<{ id: number }>(a, `${mrPath(ref.repo, ref.number)}/notes`, { method: 'POST', json: { body: `${prefix}${review.body}` } }));
      if (review.comments?.length) {
        const mr = orThrow(await gitlabApi<GitlabMergeRequest>(a, mrPath(ref.repo, ref.number)));
        if (!mr.diff_refs) {
          throw new Error(`${ref.url} has no diff to put a line comment on.`);
        }
        for (const c of review.comments) {
          const position = { position_type: 'text', ...mr.diff_refs, new_path: c.path, old_path: c.path, ...(c.side === 'LEFT' ? { old_line: c.line } : { new_line: c.line }) };
          orThrow(await gitlabApi(a, `${mrPath(ref.repo, ref.number)}/discussions`, { method: 'POST', json: { body: c.body, position } }));
        }
      }
      if (review.event === 'approve') {
        orThrow(await gitlabApi(a, `${mrPath(ref.repo, ref.number)}/approve`, { method: 'POST', json: {} }));
      }
      return { reviewId: note.id, url: `${pullUrl(ref.repo, ref.number)}#note_${note.id}` };
    },

    async dismissReview(orgId, ref, reviewId) {
      const a = await accessFor(orgId, baseUrl, ref.repo);
      // Unapprove answers 401/404 when the token had not approved; either way the approval is gone.
      await gitlabApi(a, `${mrPath(ref.repo, ref.number)}/unapprove`, { method: 'POST', json: {} });
      const res = await gitlabApi(a, `${mrPath(ref.repo, ref.number)}/notes/${reviewId}`, { method: 'DELETE', read: 'text' });
      if (!res.ok && res.kind !== 'not_found') {
        throw new Error(res.message);
      }
    },

    async cancelPipelineRun(orgId, ref: PipelineRunRef) {
      const a = await accessFor(orgId, baseUrl, ref.repo);
      const pipeline = orThrow(await gitlabApi<GitlabPipeline>(a, `/projects/${gitlabProjectId(ref.repo)}/pipelines/${ref.runId}`));
      if (FINISHED.has(pipeline.status)) {
        return { cancelled: false };
      }
      orThrow(await gitlabApi(a, `/projects/${gitlabProjectId(ref.repo)}/pipelines/${ref.runId}/cancel`, { method: 'POST', json: {} }));
      return { cancelled: true };
    },

    async rerunPipelineRun(orgId, ref) {
      const a = await accessFor(orgId, baseUrl, ref.repo);
      orThrow(await gitlabApi(a, `/projects/${gitlabProjectId(ref.repo)}/pipelines/${ref.runId}/retry`, { method: 'POST', json: {} }));
    },

    async findUserByEmail(orgId, repo, email) {
      const a = await accessFor(orgId, baseUrl, repo);
      const res = await gitlabApi<Array<{ username?: string; web_url?: string }>>(a, `/users?search=${encodeURIComponent(email)}&per_page=1`);
      const hit = res.ok ? res.data?.[0] : undefined;
      return hit?.username && hit.web_url ? { login: hit.username, url: hit.web_url } : null;
    },

    async listPipelineRuns(orgId, repo, opts): Promise<PipelineRunSummary[]> {
      const a = await accessFor(orgId, baseUrl, repo);
      const pipelines = orThrow(await gitlabApi<GitlabPipeline[]>(a, `/projects/${gitlabProjectId(repo)}/pipelines?per_page=${opts.limit}&order_by=id&sort=desc${opts.branch ? `&ref=${encodeURIComponent(opts.branch)}` : ''}`)) ?? [];
      return Promise.all(pipelines.map(async (p, i): Promise<PipelineRunSummary> => {
        const run: PipelineRunSummary = { id: p.id, url: p.web_url, ref: p.ref ?? null, sha: p.sha ?? null, status: p.status, source: p.source ?? null, createdAt: p.created_at ?? null };
        if (i >= 3) {
          return run;
        }
        const jobs = await gitlabApi<GitlabJob[]>(a, `/projects/${gitlabProjectId(repo)}/pipelines/${p.id}/jobs?per_page=100`);
        return { ...run, jobs: jobs.ok ? (jobs.data ?? []).map(j => ({ name: j.name, stage: j.stage ?? null, status: j.status })) : [] };
      }));
    },
  };
}
