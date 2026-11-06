/**
 * GitLab as a code host — the repo family's second provider (`../provider.ts`),
 * on gitlab.com or a self-managed instance, against the REST v4 API.
 *
 * Everything here rides the workspace's own GitLab credential for the project
 * (`../gitlabAccess.ts`: the enabled gitlab source that lists it, its pasted
 * access token or its "Connect with GitLab" login, refreshed before use), so a
 * private project answers and a project the workspace did not connect answers
 * nothing. A provider is bound to one instance (`gitlabRepoProviderOn`), which
 * is how `pullUrl` and `runUrl` can be written without a lookup.
 *
 * GitLab's words, and the family's:
 *
 *   merge request `!9`        pull request number 9 (the `iid`, per project)
 *   pipeline and its jobs     the checks on a head (`libs/gitlab/events.ts`)
 *   note                      a comment on the pull request
 *   approve / unapprove       a review that approves / its dismissal
 *   note + diff discussions   a review that requests changes or comments, its
 *                             findings as discussions positioned on their lines
 *                             (the position is built from the MR's `diff_refs`)
 *   pipeline retry / cancel   a run started again / stopped
 *
 * Project paths can be nested (`group/subgroup/project`); every request names
 * the project by its whole path, URL-encoded as one segment.
 */

import type { ChangeFileInput, OpenedRepoChange, PipelineRunRef, PullRequestRef, PullRequestSummary, RepoFile, RepoProvider, RepoTree, RepoTreeEntry, ReviewInput } from '../provider';
import type { GitlabClient } from '@/libs/gitlab/client';
import type { GitlabJob, GitlabMergeRequest, GitlabPipeline } from '@/libs/gitlab/events';
import { createGitlabClient, GITLAB_URL, hostOfBaseUrl, normalizeBaseUrl, projectId } from '@/libs/gitlab/client';
import { checkRunsFromJobs, mergedMergeRequestEvent, pullFromMergeRequest } from '@/libs/gitlab/events';
import { mergeRequestUrl, parseMergeRequestUrl, parsePipelineUrl, pipelineUrl } from '@/libs/gitlab/urls';
import { requireGitlabAccess } from '../gitlabAccess';

const BODY_MAX = 20_000;
const FILES_MAX = 200;
const DIFF_MAX = 60_000;
const FILE_MAX = 60_000;
/** Pages of 100 tree entries one read may walk; a bigger tree is read as truncated. */
const TREE_PAGES = 100;
/** Every branch a change from Vocion may write, and Undo may delete (`githubChange.ts` names them). */
const CHANGE_PREFIXES = ['vocion/pipeline-', 'vocion/seo-', 'vocion/revert-'];

/** One entry of `GET …/merge_requests/:iid/diffs` or of a compare's `diffs`. */
type DiffEntry = { old_path: string; new_path: string; new_file?: boolean; deleted_file?: boolean; renamed_file?: boolean; diff?: string; b_mode?: string };

type Bound = { client: GitlabClient; id: string; baseUrl: string };

/**
 * A client for a project, on the instance the provider is bound to, with the
 * workspace's credential for it.
 * @param orgId - The workspace.
 * @param project - The project path.
 * @param baseUrl - The instance.
 */
async function bind(orgId: string, project: string, baseUrl: string): Promise<Bound> {
  const access = await requireGitlabAccess(orgId, project, hostOfBaseUrl(baseUrl));
  return { client: createGitlabClient({ token: access.token, baseUrl: access.baseUrl }), id: projectId(project), baseUrl: access.baseUrl };
}

/**
 * A diff cut to what one read can hold, with a line that says so.
 * @param diff - The whole diff.
 */
function capDiff(diff: string): string {
  return diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n\n[Diff truncated at ${DIFF_MAX} of ${diff.length} characters, to keep this read whole.]` : diff;
}

/**
 * GitLab's per-file diffs as one unified diff with git's headers, so
 * `pathsInDiff` and a reviewer read it the way they read GitHub's.
 * @param entries - The diff entries.
 */
export function unifiedDiffOf(entries: readonly DiffEntry[]): string {
  return entries.map((e) => {
    const head = [`diff --git a/${e.old_path} b/${e.new_path}`];
    if (e.new_file) {
      head.push(`new file mode ${e.b_mode ?? '100644'}`);
    } else if (e.deleted_file) {
      head.push('deleted file mode 100644');
    } else if (e.renamed_file) {
      head.push(`rename from ${e.old_path}`, `rename to ${e.new_path}`);
    }
    head.push(e.new_file ? '--- /dev/null' : `--- a/${e.old_path}`, e.deleted_file ? '+++ /dev/null' : `+++ b/${e.new_path}`);
    const body = (e.diff ?? '').replace(/\n$/, '');
    return body ? `${head.join('\n')}\n${body}` : head.join('\n');
  }).join('\n');
}

/**
 * Lines added and removed in one file's diff.
 * @param diff - The file's hunks.
 */
function countLines(diff: string | undefined): { additions: number; deletions: number } {
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

/**
 * A merge request's per-file diffs: the `/diffs` endpoint (GitLab 15.7+),
 * else the older `/changes`.
 * @param b - The bound client.
 * @param iid - The merge request.
 */
async function mergeRequestDiffs(b: Bound, iid: number): Promise<{ ok: true; entries: DiffEntry[] } | { ok: false; message: string }> {
  const diffs = await b.client.list<DiffEntry>(`/projects/${b.id}/merge_requests/${iid}/diffs`, {}, { maxPages: 3 });
  if (diffs.ok) {
    return { ok: true, entries: diffs.data };
  }
  if (diffs.status !== 404) {
    return { ok: false, message: diffs.message };
  }
  const changes = await b.client.get<{ changes?: DiffEntry[] }>(`/projects/${b.id}/merge_requests/${iid}/changes`);
  return changes.ok ? { ok: true, entries: changes.data.changes ?? [] } : { ok: false, message: changes.message };
}

/**
 * The merge request a ref names, read whole, or a thrown sentence.
 * @param b - The bound client.
 * @param ref - The pull request.
 */
async function readMergeRequest(b: Bound, ref: PullRequestRef): Promise<GitlabMergeRequest> {
  const mr = await b.client.get<GitlabMergeRequest>(`/projects/${b.id}/merge_requests/${ref.number}`);
  if (!mr.ok) {
    throw new Error(`${ref.url} could not be read: ${mr.message}`);
  }
  return mr.data;
}

/**
 * The jobs of a merge request's head pipeline, when it runs on the head; [] when there is none.
 * @param b - The bound client.
 * @param mr - The merge request, read whole.
 */
async function headJobs(b: Bound, mr: GitlabMergeRequest): Promise<GitlabJob[]> {
  const p = mr.head_pipeline;
  if (!p || p.sha !== mr.sha) {
    return [];
  }
  const jobs = await b.client.list<GitlabJob>(`/projects/${p.project_id ?? b.id}/pipelines/${p.id}/jobs`, {}, { maxPages: 3 });
  return jobs.ok ? jobs.data : [];
}

/**
 * A path inside the repository and nothing else, or a thrown sentence. The
 * path is one URL-encoded segment in GitLab's API, but `..` is refused anyway:
 * a path that leaves the root is never a file of the project.
 * @param repo - The project path, for the message.
 * @param path - The path asked for.
 */
function cleanFilePath(repo: string, path: string): string {
  const clean = path.replace(/^\.?\//, '');
  const segments = clean.split('/');
  if (clean.length === 0 || segments.some(s => s.length === 0 || s === '.' || s === '..')) {
    throw new Error(`${repo}: "${path}" is not a path inside the repository`);
  }
  return clean;
}

/**
 * The project's default branch, or a thrown sentence.
 * @param b - The bound client.
 * @param repo - The project path, for the message.
 */
async function defaultBranchOf(b: Bound, repo: string): Promise<string> {
  const meta = await b.client.get<{ default_branch?: string | null }>(`/projects/${b.id}`);
  if (!meta.ok) {
    throw new Error(`${repo} could not be read: ${meta.message}`);
  }
  const branch = meta.data.default_branch?.trim();
  if (!branch) {
    throw new Error(`${repo} names no default branch (an empty project?); ask for a ref.`);
  }
  return branch;
}

/**
 * A branch name for a change: the prefix, the minute, a slug of its title.
 * @param prefix - The branch prefix.
 * @param title - The change's title.
 * @param now - The clock.
 */
function changeBranch(prefix: string, title: string, now: Date = new Date()): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'change';
  return `${prefix}${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${slug}`;
}

/**
 * The GitLab provider bound to one instance.
 * @param instance - The instance's base URL, e.g. `https://gitlab.com`.
 */
export function gitlabRepoProviderOn(instance: string): RepoProvider {
  const baseUrl = normalizeBaseUrl(instance);

  async function readPull(orgId: string, ref: PullRequestRef): Promise<PullRequestSummary> {
    const b = await bind(orgId, ref.repo, baseUrl);
    const mr = await readMergeRequest(b, ref);
    const [diffs, approvals, jobs] = await Promise.all([
      mergeRequestDiffs(b, mr.iid),
      b.client.get<{ approved_by?: Array<{ user?: { username?: string } }> }>(`/projects/${b.id}/merge_requests/${mr.iid}/approvals`),
      mr.state === 'opened' ? headJobs(b, mr) : Promise.resolve([] as GitlabJob[]),
    ]);
    const files = diffs.ok
      ? diffs.entries.map((e) => {
          const n = countLines(e.diff);
          return { path: e.new_path, status: e.new_file ? 'added' : e.deleted_file ? 'removed' : e.renamed_file ? 'renamed' : 'modified', ...n };
        })
      : [];
    const pr = pullFromMergeRequest(mr);
    const body = mr.description ?? '';
    const counted = Number.parseInt(String(mr.changes_count ?? ''), 10);
    return {
      repo: ref.repo,
      number: mr.iid,
      url: mr.web_url,
      title: mr.title,
      body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)}\n\n[Description cut at ${BODY_MAX} of ${body.length} characters.]` : body,
      author: mr.author?.username ?? null,
      state: pr.state,
      draft: pr.draft === true,
      merged: mr.state === 'merged',
      mergedBy: pr.merged_by?.login || null,
      headBranch: mr.source_branch,
      headSha: mr.sha,
      baseBranch: mr.target_branch,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      changedFileCount: Number.isFinite(counted) ? counted : files.length,
      files: files.slice(0, FILES_MAX),
      reviews: approvals.ok ? (approvals.data.approved_by ?? []).map(a => ({ reviewer: a.user?.username ?? null, state: 'APPROVED', submittedAt: null })) : [],
      checks: checkRunsFromJobs(jobs).map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion ?? null })),
      labels: mr.labels ?? [],
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
    };
  }

  async function readPullDiff(orgId: string, ref: PullRequestRef): Promise<string> {
    const b = await bind(orgId, ref.repo, baseUrl);
    // `raw_diffs` (GitLab 17+) is git's own unified diff; older instances build it from the per-file diffs.
    const raw = await b.client.request<string>(`/projects/${b.id}/merge_requests/${ref.number}/raw_diffs`, { text: true });
    if (raw.ok) {
      return capDiff(raw.data);
    }
    const diffs = await mergeRequestDiffs(b, ref.number);
    if (!diffs.ok) {
      throw new Error(`the diff of ${ref.url} could not be read: ${diffs.message}`);
    }
    return capDiff(unifiedDiffOf(diffs.entries));
  }

  async function readCompareDiff(orgId: string, repo: string, base: string, head: string): Promise<string> {
    const b = await bind(orgId, repo, baseUrl);
    const res = await b.client.get<{ diffs?: DiffEntry[] }>(`/projects/${b.id}/repository/compare`, { from: base, to: head, straight: 'false' });
    if (!res.ok) {
      throw new Error(`the diff ${base}...${head} on ${repo} could not be read: ${res.message}`);
    }
    return capDiff(unifiedDiffOf(res.data.diffs ?? []));
  }

  async function readFile(orgId: string, repo: string, path: string, ref?: string | null): Promise<RepoFile> {
    const clean = cleanFilePath(repo, path);
    const b = await bind(orgId, repo, baseUrl);
    const at = ref?.trim() || await defaultBranchOf(b, repo);
    const res = await b.client.request<string>(`/projects/${b.id}/repository/files/${encodeURIComponent(clean)}/raw`, { params: { ref: at }, text: true, timeoutMs: 20_000 });
    if (!res.ok) {
      throw new Error(`${repo}/${clean} @ ${at} could not be read: ${res.message}${res.status === 404 ? ' (a path that is a folder, or a private project the credential was not granted, also answers 404)' : ''}`);
    }
    const truncated = res.data.length > FILE_MAX;
    return { repo, path: clean, ref: ref ?? null, size: res.data.length, text: truncated ? res.data.slice(0, FILE_MAX) : res.data, truncated };
  }

  async function readTree(orgId: string, repo: string, ref?: string | null): Promise<RepoTree> {
    const b = await bind(orgId, repo, baseUrl);
    const at = ref?.trim() || await defaultBranchOf(b, repo);
    const res = await b.client.list<{ path?: string; type?: string }>(`/projects/${b.id}/repository/tree`, { recursive: 'true', ref: at, pagination: 'keyset' }, { maxPages: TREE_PAGES });
    if (!res.ok) {
      throw new Error(`the tree of ${repo} @ ${at} could not be read: ${res.message}${res.status === 404 ? ' (a ref that does not exist, or a private project the credential was not granted, also answers 404)' : ''}`);
    }
    const entries: RepoTreeEntry[] = [];
    for (const e of res.data) {
      // `commit` is a submodule, which is neither a file nor a folder here.
      if (typeof e?.path === 'string' && e.path && (e.type === 'blob' || e.type === 'tree')) {
        entries.push({ path: e.path, type: e.type });
      }
    }
    return { repo, ref: at, truncated: res.truncated === true, entries };
  }

  async function commentPull(orgId: string, ref: PullRequestRef, body: string): Promise<{ commentId: number; url: string }> {
    const b = await bind(orgId, ref.repo, baseUrl);
    const res = await b.client.request<{ id: number }>(`/projects/${b.id}/merge_requests/${ref.number}/notes`, { method: 'POST', body: { body } });
    if (!res.ok) {
      throw new Error(`GitLab refused the comment on ${ref.url}: ${res.message}`);
    }
    return { commentId: res.data.id, url: `${ref.url}#note_${res.data.id}` };
  }

  async function deleteNote(b: Bound, iid: number, noteId: number): Promise<void> {
    const res = await b.client.request<unknown>(`/projects/${b.id}/merge_requests/${iid}/notes/${noteId}`, { method: 'DELETE' });
    // 404: someone already deleted it in GitLab, which is what the undo was for.
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitLab would not delete note ${noteId} on !${iid}: ${res.message}`);
    }
  }

  async function submitReview(orgId: string, ref: PullRequestRef, review: ReviewInput): Promise<{ reviewId: number; url: string }> {
    const b = await bind(orgId, ref.repo, baseUrl);
    const mr = await readMergeRequest(b, ref);
    let noteId = 0;
    if (review.body.trim()) {
      const note = await b.client.request<{ id: number }>(`/projects/${b.id}/merge_requests/${mr.iid}/notes`, { method: 'POST', body: { body: review.body } });
      if (!note.ok) {
        throw new Error(`GitLab refused the review on ${ref.url}: ${note.message}`);
      }
      noteId = note.data.id;
    }
    // Findings on lines: one diff discussion each, positioned against the
    // three commits GitLab diffed (`diff_refs`), on the new side unless LEFT.
    const refs = mr.diff_refs;
    if (review.comments?.length && refs?.base_sha && refs.head_sha && refs.start_sha) {
      for (const c of review.comments) {
        const left = c.side === 'LEFT';
        const res = await b.client.request<unknown>(`/projects/${b.id}/merge_requests/${mr.iid}/discussions`, {
          method: 'POST',
          body: {
            body: c.body,
            position: { position_type: 'text', base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha, old_path: c.path, new_path: c.path, ...(left ? { old_line: c.line } : { new_line: c.line }) },
          },
        });
        if (!res.ok) {
          throw new Error(`GitLab refused the finding on ${c.path}:${c.line} of ${ref.url}: ${res.message} (an inline finding must name a line the diff touches)`);
        }
      }
    }
    if (review.event === 'approve') {
      const res = await b.client.request<unknown>(`/projects/${b.id}/merge_requests/${mr.iid}/approve`, { method: 'POST', body: { sha: mr.sha } });
      if (!res.ok) {
        throw new Error(`GitLab refused the approval on ${ref.url}: ${res.message}${res.status === 401 || res.status === 403 ? ' (the author may not approve their own merge request, and the token needs api)' : ''}`);
      }
    }
    return { reviewId: noteId, url: noteId ? `${mr.web_url}#note_${noteId}` : mr.web_url };
  }

  async function dismissReview(orgId: string, ref: PullRequestRef, reviewId: number, _message: string): Promise<void> {
    const b = await bind(orgId, ref.repo, baseUrl);
    // An approval is withdrawn; a merge request this account had not approved answers 404, which is fine.
    const un = await b.client.request<unknown>(`/projects/${b.id}/merge_requests/${ref.number}/unapprove`, { method: 'POST' });
    if (!un.ok && un.status !== 404 && un.status !== 401) {
      throw new Error(`GitLab would not withdraw the approval on ${ref.url}: ${un.message}`);
    }
    if (reviewId > 0) {
      await deleteNote(b, ref.number, reviewId);
    }
  }

  async function cancelPipelineRun(orgId: string, ref: PipelineRunRef): Promise<{ cancelled: boolean }> {
    const b = await bind(orgId, ref.repo, baseUrl);
    const now = await b.client.get<GitlabPipeline>(`/projects/${b.id}/pipelines/${ref.runId}`);
    if (!now.ok) {
      throw new Error(`pipeline ${ref.runId} on ${ref.repo} could not be read: ${now.message}`);
    }
    if (['success', 'failed', 'canceled', 'skipped'].includes(now.data.status)) {
      return { cancelled: false };
    }
    const res = await b.client.request<GitlabPipeline>(`/projects/${b.id}/pipelines/${ref.runId}/cancel`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`GitLab refused to cancel pipeline ${ref.runId} on ${ref.repo}: ${res.message}`);
    }
    return { cancelled: true };
  }

  async function rerunPipelineRun(orgId: string, ref: PipelineRunRef): Promise<void> {
    const b = await bind(orgId, ref.repo, baseUrl);
    // Retry runs the pipeline's failed and cancelled jobs again, in the same pipeline.
    const res = await b.client.request<unknown>(`/projects/${b.id}/pipelines/${ref.runId}/retry`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`GitLab refused to start pipeline ${ref.runId} on ${ref.repo} again: ${res.message}`);
    }
  }

  async function findUserByEmail(orgId: string, repo: string, email: string): Promise<{ login: string; url: string } | null> {
    const b = await bind(orgId, repo, baseUrl).catch(() => null);
    if (!b) {
      return null;
    }
    // GitLab matches a user's public email for anyone, and any email for an administrator.
    const res = await b.client.get<Array<{ username?: string; web_url?: string }>>('/users', { search: email, per_page: '1' });
    const hit = res.ok ? res.data[0] : undefined;
    return hit?.username && hit.web_url ? { login: hit.username, url: hit.web_url } : null;
  }

  async function readPullHead(orgId: string, ref: PullRequestRef): Promise<{ sha: string; state: string; merged: boolean } | null> {
    const b = await bind(orgId, ref.repo, baseUrl).catch(() => null);
    const mr = b ? await b.client.get<GitlabMergeRequest>(`/projects/${b.id}/merge_requests/${ref.number}`) : null;
    if (!mr?.ok || !mr.data.sha) {
      return null;
    }
    return { sha: mr.data.sha, state: mr.data.state === 'opened' ? 'open' : 'closed', merged: mr.data.state === 'merged' };
  }

  async function readPullState(orgId: string, ref: PullRequestRef) {
    const b = await bind(orgId, ref.repo, baseUrl);
    const mr = await readMergeRequest(b, ref);
    const jobs = mr.state === 'opened' ? await headJobs(b, mr) : [];
    return { repo: ref.repo, pr: pullFromMergeRequest(mr), checkRuns: checkRunsFromJobs(jobs) };
  }

  async function mergePull(orgId: string, ref: PullRequestRef, judgedSha: string | null) {
    const b = await bind(orgId, ref.repo, baseUrl);
    const mr = await readMergeRequest(b, ref);
    if (mr.state === 'merged') {
      return { sha: mr.merge_commit_sha ?? mr.squash_commit_sha ?? null, already: true, event: null };
    }
    if (mr.state !== 'opened') {
      throw new Error(`${ref.url} is ${mr.state}, so there is nothing to merge`);
    }
    if (judgedSha && !mr.sha.startsWith(judgedSha.slice(0, 7))) {
      throw new Error(`the branch moved after QA's verdict (judged ${judgedSha.slice(0, 12)}, head is ${mr.sha.slice(0, 12)}); QA must look at the new commit first`);
    }
    const { checksAllowMerge } = await import('@/services/factory/githubMerge');
    const verdict = checksAllowMerge(checkRunsFromJobs(await headJobs(b, mr)).map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion ?? null })));
    if (!verdict.ok) {
      throw new Error(`not merged: ${verdict.why}`);
    }
    const put = (squash: boolean) => b.client.request<GitlabMergeRequest>(`/projects/${b.id}/merge_requests/${mr.iid}/merge`, { method: 'PUT', body: { sha: mr.sha, squash, should_remove_source_branch: false }, timeoutMs: 60_000 });
    // Squash, as the GitHub provider does; a project that forbids squashing refuses it, and the merge is made as the project merges.
    let res = await put(true);
    if (!res.ok && (res.status === 400 || res.status === 422) && /squash/i.test(res.message)) {
      res = await put(false);
    }
    if (!res.ok) {
      throw new Error(`GitLab refused the merge (HTTP ${res.status}): ${res.message}${res.status === 405 ? ' (GitLab says it is not mergeable: a pipeline that must succeed, an approval rule, an unresolved thread or a conflict)' : ''}`);
    }
    let merged = res.data;
    if (merged.state !== 'merged') {
      // GitLab may finish the merge a moment after it answers.
      await new Promise(resolve => setTimeout(resolve, 2_000));
      const again = await b.client.get<GitlabMergeRequest>(`/projects/${b.id}/merge_requests/${mr.iid}`);
      merged = again.ok ? again.data : merged;
    }
    const isMerged = merged.state === 'merged';
    return { sha: merged.merge_commit_sha ?? merged.squash_commit_sha ?? null, already: false, event: isMerged ? mergedMergeRequestEvent(ref.repo, merged) : null };
  }

  async function closePull(orgId: string, ref: PullRequestRef, comment: string): Promise<{ closed: boolean; state: string }> {
    const b = await bind(orgId, ref.repo, baseUrl);
    const mr = await readMergeRequest(b, ref);
    if (mr.state !== 'opened') {
      return { closed: false, state: mr.state === 'merged' ? 'merged' : mr.state };
    }
    await b.client.request<unknown>(`/projects/${b.id}/merge_requests/${mr.iid}/notes`, { method: 'POST', body: { body: comment } });
    const res = await b.client.request<unknown>(`/projects/${b.id}/merge_requests/${mr.iid}`, { method: 'PUT', body: { state_event: 'close' } });
    if (!res.ok) {
      throw new Error(`GitLab refused to close ${ref.url}: ${res.message}`);
    }
    return { closed: true, state: 'closed' };
  }

  async function revertPull(orgId: string, ref: PullRequestRef): Promise<{ revertUrl: string }> {
    const b = await bind(orgId, ref.repo, baseUrl);
    const mr = await readMergeRequest(b, ref);
    if (mr.state !== 'merged') {
      throw new Error(`${ref.url} is ${mr.state}, not merged, so there is nothing to revert`);
    }
    // The commit the merge put on the target: the squash commit, else the merge commit.
    const commit = mr.squash_commit_sha ?? mr.merge_commit_sha;
    if (!commit) {
      throw new Error(`${ref.url} was merged by fast-forward without a squash, so no single commit carries it; revert its commits on GitLab by hand`);
    }
    const branch = changeBranch('vocion/revert-', `${mr.iid}-${mr.title}`);
    const created = await b.client.request<unknown>(`/projects/${b.id}/repository/branches`, { method: 'POST', params: { branch, ref: mr.target_branch } });
    if (!created.ok) {
      throw new Error(`GitLab would not create ${branch} for the revert: ${created.message}`);
    }
    const reverted = await b.client.request<unknown>(`/projects/${b.id}/repository/commits/${commit}/revert`, { method: 'POST', body: { branch } });
    if (!reverted.ok) {
      throw new Error(`GitLab would not revert ${commit.slice(0, 12)}: ${reverted.message}`);
    }
    const opened = await b.client.request<GitlabMergeRequest>(`/projects/${b.id}/merge_requests`, { method: 'POST', body: { source_branch: branch, target_branch: mr.target_branch, title: `Revert "${mr.title}"`.slice(0, 255), description: `This reverts !${mr.iid} (${commit.slice(0, 12)}), opened from Vocion.` } });
    if (!opened.ok) {
      throw new Error(`GitLab did not open the revert: ${opened.message}`);
    }
    return { revertUrl: opened.data.web_url };
  }

  async function openChange(orgId: string, o: { repo: string; title: string; body: string; files: ChangeFileInput[]; base?: string | null; branch?: string | null }): Promise<OpenedRepoChange> {
    const b = await bind(orgId, o.repo, baseUrl);
    const base = o.base?.trim() || await defaultBranchOf(b, o.repo);
    const branch = o.branch?.trim() || changeBranch('vocion/pipeline-', o.title);
    const startRef = o.branch ? branch : base;
    const actions: Array<Record<string, unknown>> = [];
    for (const f of o.files) {
      const path = cleanFilePath(o.repo, f.path);
      if (f.delete) {
        actions.push({ action: 'delete', file_path: path });
        continue;
      }
      // GitLab writes a file as create or update, never "whichever": ask which it is at the start ref.
      const exists = await b.client.request<unknown>(`/projects/${b.id}/repository/files/${encodeURIComponent(path)}`, { method: 'HEAD', params: { ref: startRef } });
      actions.push({ action: exists.ok ? 'update' : 'create', file_path: path, content: f.content ?? '' });
    }
    const commit = await b.client.request<{ id: string }>(`/projects/${b.id}/repository/commits`, {
      method: 'POST',
      body: { branch, ...(o.branch ? {} : { start_branch: base }), commit_message: o.title, actions },
    });
    if (!commit.ok) {
      throw new Error(`GitLab refused the commit on ${o.repo}: ${commit.message}`);
    }
    const open = await b.client.get<GitlabMergeRequest[]>(`/projects/${b.id}/merge_requests`, { state: 'opened', source_branch: branch });
    let mr = open.ok ? open.data[0] : undefined;
    const created = !mr;
    if (!mr) {
      const made = await b.client.request<GitlabMergeRequest>(`/projects/${b.id}/merge_requests`, { method: 'POST', body: { source_branch: branch, target_branch: base, title: o.title, description: o.body, remove_source_branch: true } });
      if (!made.ok) {
        throw new Error(`GitLab did not open the merge request for ${branch}: ${made.message}`);
      }
      mr = made.data;
    }
    return { repo: o.repo, url: mr.web_url, number: mr.iid, branch, base: mr.target_branch ?? base, headSha: commit.data.id, created, paths: actions.map(a => String(a.file_path)) };
  }

  async function discardChange(orgId: string, o: { url: string; repo: string; branch: string }) {
    const ref = parseMergeRequestUrl(o.url);
    if (!ref) {
      throw new Error(`${o.url} is not a GitLab merge request`);
    }
    const pull = { repo: o.repo, number: ref.iid, url: ref.url };
    const b = await bind(orgId, o.repo, baseUrl);
    const mr = await readMergeRequest(b, pull);
    if (mr.state === 'merged') {
      const { revertUrl } = await revertPull(orgId, pull);
      return { closed: false, branchDeleted: false, revertUrl, state: 'merged' };
    }
    let closed = false;
    if (mr.state === 'opened') {
      const res = await b.client.request<unknown>(`/projects/${b.id}/merge_requests/${mr.iid}`, { method: 'PUT', body: { state_event: 'close' } });
      closed = res.ok;
    }
    let branchDeleted = false;
    if (CHANGE_PREFIXES.some(p => o.branch.startsWith(p))) {
      const del = await b.client.request<unknown>(`/projects/${b.id}/repository/branches/${encodeURIComponent(o.branch)}`, { method: 'DELETE' });
      branchDeleted = del.ok || del.status === 404;
    }
    return { closed, branchDeleted, revertUrl: null, state: closed ? 'closed' : mr.state };
  }

  return {
    kind: 'gitlab',
    label: 'GitLab',
    parsePullRef(url) {
      const mr = parseMergeRequestUrl(url);
      return mr ? { repo: mr.project, number: mr.iid, url: mr.url } : null;
    },
    parseRunRef(url) {
      const p = parsePipelineUrl(url);
      return p ? { repo: p.project, runId: p.pipelineId, url: p.url } : null;
    },
    pullUrl: (repo, number) => mergeRequestUrl(baseUrl, repo, number),
    runUrl: (repo, runId) => pipelineUrl(baseUrl, repo, runId),
    readPull,
    readPullDiff,
    readCompareDiff,
    readFile,
    readTree,
    commentPull,
    async deletePullComment(orgId, repo, commentId, number) {
      if (!number) {
        throw new Error(`GitLab deletes a note through its merge request, and this comment on ${repo} names none`);
      }
      await deleteNote(await bind(orgId, repo, baseUrl), number, commentId);
    },
    submitReview,
    dismissReview,
    cancelPipelineRun,
    rerunPipelineRun,
    findUserByEmail,
    readPullHead,
    readPullState,
    mergePull,
    closePull,
    revertPull,
    openChange,
    discardChange,
  };
}

/** The provider for gitlab.com. */
export const gitlabRepoProvider: RepoProvider = gitlabRepoProviderOn(GITLAB_URL);
