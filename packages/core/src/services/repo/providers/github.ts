/**
 * GitHub as a code host — the first `RepoProvider` (`../provider.ts`).
 *
 * Everything here rides the workspace's own GitHub credential for the
 * repository (`githubChecks.ghFor` → `tokenForRepo`: the enabled github source
 * that lists it, a pasted token or a GitHub App installation), so a private
 * repository answers and a repository the workspace did not connect answers
 * nothing. Reads that the factory already had (`readCheckLogs`,
 * `listWorkflowRuns`, `cancelWorkflowRuns`) stay where they are; this file
 * adds the pull request as a summary, the diffs, a file at a ref, the
 * comment, the review and its dismissal, and the re-run of a whole run.
 */

import type { PipelineRunRef, PullRequestRef, PullRequestSummary, RepoFile, RepoProvider, ReviewInput } from '../provider';
import type { GithubCheckRun, GithubPullRequest, GithubReview } from '@/libs/github/events';
import { parsePullUrl } from '@/services/agents/tools/githubPullRead';
import { call, cancelWorkflowRuns, ghFor, parseRunUrl } from '@/services/factory/githubChecks';

const BODY_MAX = 20_000;
const FILES_MAX = 200;
/** Enough for a factory-sized change (`githubPullRead.composePullText` keeps the same line). */
const DIFF_MAX = 60_000;
const FILE_MAX = 60_000;

const REVIEW_EVENT: Record<ReviewInput['event'], 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
  approve: 'APPROVE',
  request_changes: 'REQUEST_CHANGES',
  comment: 'COMMENT',
};

type PullFile = { filename: string; status: string; additions?: number; deletions?: number };
type PullFull = GithubPullRequest & { body?: string | null; additions?: number; deletions?: number; changed_files?: number; labels?: Array<{ name?: string }> };

/**
 * One request to the repository's REST API with a non-JSON `Accept`, for a
 * diff or a raw file — what `call` cannot ask for.
 * @param gh - The repository and its token.
 * @param gh.owner
 * @param gh.repo
 * @param gh.token
 * @param path - The path under `/repos/<owner>/<name>`.
 * @param accept - The media type to ask for.
 * @param timeoutMs - How long to wait.
 */
async function callText(gh: { owner: string; repo: string; token: string }, path: string, accept: string, timeoutMs = 30_000): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}${path}`, {
    headers: { 'authorization': `Bearer ${gh.token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion', accept },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((err: Error) => ({ ok: false, status: 0, text: async () => err.message }) as unknown as Response);
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, status: res.status, message: `HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}` };
  }
  return { ok: true, text };
}

/**
 * A diff cut to what one read can hold, with a line that says so.
 * @param diff - The whole diff.
 */
function capDiff(diff: string): string {
  return diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n\n[Diff truncated at ${DIFF_MAX} of ${diff.length} characters, to keep this read whole.]` : diff;
}

async function readPull(orgId: string, ref: PullRequestRef): Promise<PullRequestSummary> {
  const gh = await ghFor(orgId, ref.repo);
  const meta = await call<PullFull>(gh, `/pulls/${ref.number}`);
  if (!meta.ok) {
    throw new Error(`${ref.url} could not be read: ${meta.message}`);
  }
  const pr = meta.data;
  const [files, reviews, checks] = await Promise.all([
    call<PullFile[]>(gh, `/pulls/${ref.number}/files?per_page=100`),
    call<GithubReview[]>(gh, `/pulls/${ref.number}/reviews?per_page=100`),
    pr.state === 'open' ? call<{ check_runs?: GithubCheckRun[] }>(gh, `/commits/${pr.head.sha}/check-runs?per_page=100`) : Promise.resolve(null),
  ]);
  const body = pr.body ?? '';
  return {
    repo: ref.repo,
    number: ref.number,
    url: pr.html_url ?? ref.url,
    title: pr.title,
    body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)}\n\n[Description cut at ${BODY_MAX} of ${body.length} characters.]` : body,
    author: pr.user?.login ?? null,
    state: pr.state,
    draft: pr.draft === true,
    merged: Boolean(pr.merged_at),
    mergedBy: pr.merged_by?.login ?? null,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    baseBranch: pr.base.ref,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFileCount: pr.changed_files ?? (files.ok ? files.data.length : 0),
    files: files.ok ? files.data.slice(0, FILES_MAX).map(f => ({ path: f.filename, status: f.status, additions: f.additions ?? 0, deletions: f.deletions ?? 0 })) : [],
    reviews: reviews.ok ? reviews.data.map(r => ({ reviewer: r.user?.login ?? null, state: r.state, submittedAt: r.submitted_at ?? null })) : [],
    checks: checks?.ok ? (checks.data.check_runs ?? []).map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion ?? null })) : [],
    labels: (pr.labels ?? []).map(l => l.name).filter((n): n is string => typeof n === 'string'),
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
  };
}

async function readPullDiff(orgId: string, ref: PullRequestRef): Promise<string> {
  const gh = await ghFor(orgId, ref.repo);
  const res = await callText(gh, `/pulls/${ref.number}`, 'application/vnd.github.v3.diff');
  if (!res.ok) {
    throw new Error(`the diff of ${ref.url} could not be read: ${res.message}`);
  }
  return capDiff(res.text);
}

async function readCompareDiff(orgId: string, repo: string, base: string, head: string): Promise<string> {
  const gh = await ghFor(orgId, repo);
  const res = await callText(gh, `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, 'application/vnd.github.v3.diff');
  if (!res.ok) {
    throw new Error(`the diff ${base}...${head} on ${repo} could not be read: ${res.message}`);
  }
  return capDiff(res.text);
}

async function readFile(orgId: string, repo: string, path: string, ref?: string | null): Promise<RepoFile> {
  const gh = await ghFor(orgId, repo);
  const clean = path.replace(/^\.?\//, '');
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await callText(gh, `/contents/${clean.split('/').map(encodeURIComponent).join('/')}${query}`, 'application/vnd.github.raw+json', 20_000);
  if (!res.ok) {
    throw new Error(`${repo}/${clean}${ref ? ` @ ${ref}` : ''} could not be read: ${res.message}${res.status === 404 ? ' (a path that is a folder, or a private repository the credential was not granted, also answers 404)' : ''}`);
  }
  const truncated = res.text.length > FILE_MAX;
  return { repo, path: clean, ref: ref ?? null, size: res.text.length, text: truncated ? res.text.slice(0, FILE_MAX) : res.text, truncated };
}

async function commentPull(orgId: string, ref: PullRequestRef, body: string): Promise<{ commentId: number; url: string }> {
  const gh = await ghFor(orgId, ref.repo);
  const res = await call<{ id: number; html_url: string }>(gh, `/issues/${ref.number}/comments`, { method: 'POST', body: { body } });
  if (!res.ok) {
    throw new Error(`GitHub refused the comment on ${ref.url}: ${res.message}${res.status === 403 || res.status === 404 ? ' (the credential needs Pull requests: write on this repository)' : ''}`);
  }
  return { commentId: res.data.id, url: res.data.html_url };
}

async function deletePullComment(orgId: string, repo: string, commentId: number): Promise<void> {
  const gh = await ghFor(orgId, repo);
  const res = await call<unknown>(gh, `/issues/comments/${commentId}`, { method: 'DELETE' });
  // 404: someone already deleted it in GitHub, which is what the undo was for.
  if (!res.ok && res.status !== 404) {
    throw new Error(`GitHub would not delete comment ${commentId} on ${repo}: ${res.message}`);
  }
}

async function submitReview(orgId: string, ref: PullRequestRef, review: ReviewInput): Promise<{ reviewId: number; url: string }> {
  const gh = await ghFor(orgId, ref.repo);
  const res = await call<{ id: number; html_url: string }>(gh, `/pulls/${ref.number}/reviews`, {
    method: 'POST',
    body: {
      event: REVIEW_EVENT[review.event],
      body: review.body,
      ...(review.comments?.length ? { comments: review.comments.map(c => ({ path: c.path, line: c.line, side: c.side ?? 'RIGHT', body: c.body })) } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub refused the review on ${ref.url}: ${res.message}${res.status === 422 ? ' (a review cannot approve its own author\'s pull request, and an inline comment must name a line the diff touches)' : ''}`);
  }
  return { reviewId: res.data.id, url: res.data.html_url };
}

async function dismissReview(orgId: string, ref: PullRequestRef, reviewId: number, message: string): Promise<void> {
  const gh = await ghFor(orgId, ref.repo);
  const res = await call<unknown>(gh, `/pulls/${ref.number}/reviews/${reviewId}/dismissals`, { method: 'PUT', body: { message, event: 'DISMISS' } });
  if (!res.ok) {
    throw new Error(`GitHub would not dismiss review ${reviewId} on ${ref.url}: ${res.message}`);
  }
}

async function cancelPipelineRun(orgId: string, ref: PipelineRunRef): Promise<{ cancelled: boolean }> {
  const out = await cancelWorkflowRuns(orgId, ref.repo, [ref.runId]);
  return { cancelled: out.cancelled.includes(ref.runId) };
}

async function rerunPipelineRun(orgId: string, ref: PipelineRunRef): Promise<void> {
  const gh = await ghFor(orgId, ref.repo);
  const res = await call<unknown>(gh, `/actions/runs/${ref.runId}/rerun`, { method: 'POST', body: {} });
  if (!res.ok) {
    throw new Error(`GitHub refused to start run ${ref.runId} on ${ref.repo} again: ${res.message}`);
  }
}

async function findUserByEmail(orgId: string, repo: string, email: string): Promise<{ login: string; url: string } | null> {
  const gh = await ghFor(orgId, repo);
  const res = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(`${email} in:email`)}&per_page=1`, {
    headers: { 'authorization': `Bearer ${gh.token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion', 'accept': 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) {
    return null;
  }
  const data = await res.json().catch(() => null) as { items?: Array<{ login?: string; html_url?: string }> } | null;
  const hit = data?.items?.[0];
  return hit?.login && hit.html_url ? { login: hit.login, url: hit.html_url } : null;
}

export const githubRepoProvider: RepoProvider = {
  kind: 'github',
  label: 'GitHub',
  parsePullRef(url) {
    const pr = parsePullUrl(url);
    return pr ? { repo: `${pr.owner}/${pr.repo}`, number: pr.number, url: `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}` } : null;
  },
  parseRunRef(url) {
    const run = parseRunUrl(url);
    return run ? { repo: `${run.owner}/${run.repo}`, runId: run.runId, url: `https://github.com/${run.owner}/${run.repo}/actions/runs/${run.runId}` } : null;
  },
  pullUrl: (repo, number) => `https://github.com/${repo}/pull/${number}`,
  readPull,
  readPullDiff,
  readCompareDiff,
  readFile,
  commentPull,
  deletePullComment,
  submitReview,
  dismissReview,
  cancelPipelineRun,
  rerunPipelineRun,
  findUserByEmail,
};
