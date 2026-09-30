/**
 * WHAT CI SAID, READ FROM GITHUB ITSELF (backlog 049). The pipeline's reads
 * and its two writes, with the workspace's own GitHub token (the `github`
 * source that lists the repository, `githubPullRead.tokenForRepo`):
 *
 *   - `readCheckLogs` — for a pull request (or one Actions run): each failing
 *     check with its conclusion, GitHub's annotations, the check's own
 *     summary and, for an Actions job, the failing step and the tail of its
 *     log. What a person would open the Checks tab to read, as evidence for
 *     `ciDiagnose` and for the Release engineer's `github_read_check_logs`.
 *   - `rerunFailedJobs` — re-runs the failed jobs of every failed workflow run
 *     on a head (the `github.rerun_failed_jobs` action); `cancelWorkflowRuns`
 *     is its undo while they are still running.
 *   - `branchChecks`, `readPull`, `pullChangedFiles`, `updatePullBranch` —
 *     what the reconciler reads back when a webhook never arrived, and how a
 *     pull request blocked by a red default branch is checked again once the
 *     branch is green.
 *
 * Nothing here reads meaning. The log tail is cut by the step's own
 * timestamps; which check failed is GitHub's conclusion field; why it failed
 * is `ciDiagnose`'s typed read.
 */

import type { GithubCheckRun, GithubPullRequest } from '@/libs/github/events';
import { parsePullUrl, tokenForRepo } from '@/services/agents/tools/githubPullRead';

/** Conclusions that are not a failure: it passed, or it never was a verdict. */
const PASSING = new Set(['success', 'neutral', 'skipped']);
/** A workflow run whose failed jobs can be re-run. */
const RERUNNABLE = new Set(['failure', 'timed_out', 'startup_failure', 'cancelled']);

const LOG_LINES = 60;
const LOG_CHARS = 6_000;

type Gh = { owner: string; repo: string; token: string };

type CheckRunFull = GithubCheckRun & {
  html_url?: string;
  details_url?: string | null;
  app?: { slug?: string } | null;
  output?: { title?: string | null; summary?: string | null } | null;
};

/** One failing check, with what GitHub says about it. */
export type FailingCheck = {
  name: string;
  conclusion: string;
  url: string | null;
  /** The failing step of an Actions job, when there is one. */
  step: string | null;
  /** Failure-level annotations: `path:line message`. */
  annotations: string[];
  /** The check's own title and summary (non-Actions checks write their finding here). */
  summary: string | null;
  /** The last lines of the failing step's log, for an Actions job. */
  logTail: string;
};

export type CheckLogs = {
  repo: string;
  /** The pull request, when the read was for one. */
  number: number | null;
  headSha: string;
  baseBranch: string | null;
  checkCount: number;
  failing: FailingCheck[];
  /** The files the pull request changes (up to 100). */
  changedFiles: string[];
};

const headers = (token: string) => ({ 'authorization': `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion', 'accept': 'application/vnd.github+json' });

async function ghFor(orgId: string, fullName: string): Promise<Gh> {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error(`${fullName} is not a repository: write it owner/name`);
  }
  const token = await tokenForRepo(orgId, fullName);
  if (!token) {
    // The gap is raised where the person can close it, and the refusal says so.
    const { withConnectionRequest } = await import('@/services/connections/connectionRequests');
    const request = await withConnectionRequest({ orgId, repo: fullName, kind: 'install', why: `The factory needs GitHub access to ${fullName} to read its pull requests and checks, re-run failed jobs and update branches.` });
    throw new Error(`this workspace has no GitHub connection for ${fullName}.${request || ' Connect it from Connections.'}`);
  }
  return { owner, repo, token };
}

async function call<T>(gh: Gh, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; message: string }> {
  const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...headers(gh.token), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  }).catch((err: Error) => ({ ok: false, status: 0, text: async () => err.message }) as unknown as Response);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {}
    return { ok: false, status: res.status, message: `HTTP ${res.status}${message ? `: ${message}` : ''}` };
  }
  // A write answers 201, 202 or 204, often with no body.
  const text = await res.text().catch(() => '');
  let data: T = undefined as T;
  try {
    data = (text ? JSON.parse(text) : undefined) as T;
  } catch {}
  return { ok: true, status: res.status, data };
}

/**
 * An Actions run (and job) named by a URL: `…/actions/runs/<run>(/job/<job>)`.
 * @param url - A GitHub Actions run or job URL.
 */
export function parseRunUrl(url: string): { owner: string; repo: string; runId: number; jobId: number | null } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.hostname !== 'github.com') {
    return null;
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 5 || parts[2] !== 'actions' || parts[3] !== 'runs') {
    return null;
  }
  const runId = Number(parts[4]);
  const jobId = parts[5] === 'job' ? Number(parts[6]) : Number.NaN;
  return Number.isInteger(runId) && runId > 0 ? { owner: parts[0]!, repo: parts[1]!, runId, jobId: Number.isInteger(jobId) && jobId > 0 ? jobId : null } : null;
}

/**
 * The Actions job behind a check run: GitHub runs each job as a check run
 * whose details URL names the job, and whose id is the job's id.
 * @param run - The check run.
 */
export function jobOf(run: CheckRunFull): number | null {
  if (run.app?.slug && run.app.slug !== 'github-actions') {
    return null;
  }
  const parsed = run.details_url ? parseRunUrl(run.details_url) : null;
  return parsed?.jobId ?? (run.app?.slug === 'github-actions' ? run.id : null);
}

// eslint-disable-next-line no-control-regex -- ANSI colour codes are control sequences by definition.
const ANSI = /\u001B\[[0-9;]*[A-Z]/gi;
const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?/;

/**
 * The tail of an Actions job log up to the end of its failing step. Lines are
 * stamped by the runner; a step's own `completed_at` says where it ended, so
 * the cleanup steps after it never crowd out the failure.
 * @param log - The job's whole log, as GitHub serves it.
 * @param endedAt - The failing step's `completed_at`, when known.
 * @param maxLines - How many lines to keep.
 * @param maxChars - The most characters to keep, from the end.
 */
export function logTailFor(log: string, endedAt: string | null, maxLines = LOG_LINES, maxChars = LOG_CHARS): string {
  const end = endedAt ? Date.parse(endedAt) + 2_000 : Number.NaN;
  const kept: string[] = [];
  let at = Number.NaN;
  for (const raw of log.split(/\r?\n/)) {
    const m = STAMP.exec(raw);
    if (m) {
      at = Date.parse(m[1]!);
    }
    if (Number.isFinite(end) && Number.isFinite(at) && at > end) {
      break;
    }
    const line = (m ? raw.slice(m[0].length) : raw).replace(ANSI, '').trimEnd();
    if (line) {
      kept.push(line);
    }
  }
  const tail = kept.slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

async function checkRunsOn(gh: Gh, ref: string): Promise<CheckRunFull[]> {
  const res = await call<{ check_runs?: CheckRunFull[] }>(gh, `/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`);
  if (!res.ok) {
    throw new Error(`the checks on ${ref.slice(0, 12)} could not be read: ${res.message}`);
  }
  return res.data.check_runs ?? [];
}

async function failingDetail(gh: Gh, run: CheckRunFull): Promise<FailingCheck> {
  const notes = await call<Array<{ path?: string; start_line?: number; message?: string; annotation_level?: string }>>(gh, `/check-runs/${run.id}/annotations?per_page=50`);
  const annotations = notes.ok
    ? notes.data.filter(n => n.annotation_level === 'failure').slice(0, 8).map(n => `${n.path && n.path !== '.github' ? `${n.path}${n.start_line ? `:${n.start_line}` : ''} ` : ''}${(n.message ?? '').replace(/\s+/g, ' ').trim()}`.slice(0, 400))
    : [];
  const summary = [run.output?.title, run.output?.summary].filter(Boolean).join(' — ').replace(/\s+/g, ' ').trim().slice(0, 600) || null;
  const jobId = jobOf(run);
  let step: string | null = null;
  let logTail = '';
  if (jobId) {
    const job = await call<{ steps?: Array<{ name: string; conclusion: string | null; completed_at?: string | null }> }>(gh, `/actions/jobs/${jobId}`);
    const failed = job.ok ? (job.data.steps ?? []).find(s => s.conclusion === 'failure') : undefined;
    step = failed?.name ?? null;
    const log = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/actions/jobs/${jobId}/logs`, { headers: headers(gh.token), signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (log?.ok) {
      logTail = logTailFor(await log.text(), failed?.completed_at ?? null);
    }
  }
  return { name: run.name, conclusion: String(run.conclusion ?? 'unknown'), url: run.html_url ?? run.details_url ?? null, step, annotations, summary, logTail };
}

/**
 * What failed on a pull request's head (or on one Actions run), read from GitHub.
 * @param orgId - The workspace (its GitHub token).
 * @param url - A pull request URL, or an Actions run URL.
 * @param opts - Options.
 * @param opts.headSha - The commit to read; the pull request's head when omitted.
 * @param opts.maxChecks - How many failing checks to read in full.
 */
export async function readCheckLogs(orgId: string, url: string, opts: { headSha?: string | null; maxChecks?: number } = {}): Promise<CheckLogs> {
  const pr = parsePullUrl(url);
  const run = pr ? null : parseRunUrl(url);
  if (!pr && !run) {
    throw new Error(`${url} is neither a GitHub pull request nor an Actions run`);
  }
  const gh = await ghFor(orgId, `${(pr ?? run)!.owner}/${(pr ?? run)!.repo}`);
  const repo = `${gh.owner}/${gh.repo}`;
  const max = opts.maxChecks ?? 3;
  if (run) {
    const r = await call<{ head_sha: string; head_branch?: string | null }>(gh, `/actions/runs/${run.runId}`);
    if (!r.ok) {
      throw new Error(`Actions run ${run.runId} on ${repo} could not be read: ${r.message}`);
    }
    const jobs = await call<{ jobs?: Array<{ id: number; name: string; conclusion: string | null; html_url?: string }> }>(gh, `/actions/runs/${run.runId}/jobs?per_page=50`);
    const failed = jobs.ok ? (jobs.data.jobs ?? []).filter(j => j.conclusion && !PASSING.has(j.conclusion)) : [];
    const failing = await Promise.all(failed.slice(0, max).map(j => failingDetail(gh, { id: j.id, name: j.name, status: 'completed', conclusion: j.conclusion, html_url: j.html_url, app: { slug: 'github-actions' } })));
    return { repo, number: null, headSha: r.data.head_sha, baseBranch: r.data.head_branch ?? null, checkCount: jobs.ok ? (jobs.data.jobs ?? []).length : 0, failing, changedFiles: [] };
  }
  const meta = await call<GithubPullRequest>(gh, `/pulls/${pr!.number}`);
  if (!meta.ok) {
    throw new Error(`${url} could not be read: ${meta.message}`);
  }
  const headSha = opts.headSha || meta.data.head.sha;
  const runs = await checkRunsOn(gh, headSha);
  const failed = runs.filter(r => r.status === 'completed' && !PASSING.has(String(r.conclusion)));
  const failing = await Promise.all(failed.slice(0, max).map(r => failingDetail(gh, r)));
  // The names of the rest, so a reader knows the list was cut.
  for (const r of failed.slice(max)) {
    failing.push({ name: r.name, conclusion: String(r.conclusion), url: r.html_url ?? null, step: null, annotations: [], summary: null, logTail: '' });
  }
  return { repo, number: pr!.number, headSha, baseBranch: meta.data.base.ref, checkCount: runs.length, failing, changedFiles: await pullChangedFiles(orgId, url).catch(() => []) };
}

/**
 * The files a pull request changes, by path.
 * @param orgId - The workspace.
 * @param url - The pull request.
 */
export async function pullChangedFiles(orgId: string, url: string): Promise<string[]> {
  const pr = parsePullUrl(url);
  if (!pr) {
    return [];
  }
  const gh = await ghFor(orgId, `${pr.owner}/${pr.repo}`);
  const res = await call<Array<{ filename: string }>>(gh, `/pulls/${pr.number}/files?per_page=100`);
  return res.ok ? res.data.map(f => f.filename) : [];
}

/**
 * A pull request as GitHub has it now.
 * @param orgId - The workspace.
 * @param url - The pull request.
 */
export async function readPull(orgId: string, url: string): Promise<{ repo: string; pr: GithubPullRequest; checkRuns: GithubCheckRun[] }> {
  const pr = parsePullUrl(url);
  if (!pr) {
    throw new Error(`${url} is not a GitHub pull request`);
  }
  const gh = await ghFor(orgId, `${pr.owner}/${pr.repo}`);
  const meta = await call<GithubPullRequest>(gh, `/pulls/${pr.number}`);
  if (!meta.ok) {
    throw new Error(`${url} could not be read: ${meta.message}`);
  }
  const checkRuns = meta.data.state === 'open' ? await checkRunsOn(gh, meta.data.head.sha) : [];
  return { repo: `${gh.owner}/${gh.repo}`, pr: meta.data, checkRuns };
}

/**
 * The checks on a branch's newest commit: which failed, and whether all finished.
 * @param orgId - The workspace.
 * @param repo - `owner/name`.
 * @param branch - The branch, e.g. the default branch a pull request targets.
 */
export async function branchChecks(orgId: string, repo: string, branch: string): Promise<{ sha: string | null; complete: boolean; failing: string[]; checkCount: number }> {
  const gh = await ghFor(orgId, repo);
  const head = await call<{ sha?: string }>(gh, `/commits/${encodeURIComponent(branch)}`);
  const sha = head.ok ? head.data.sha ?? null : null;
  if (!sha) {
    throw new Error(`${repo}@${branch} could not be read${head.ok ? '' : `: ${head.message}`}`);
  }
  const runs = await checkRunsOn(gh, sha);
  return {
    sha,
    complete: runs.length > 0 && runs.every(r => r.status === 'completed'),
    failing: runs.filter(r => r.status === 'completed' && !PASSING.has(String(r.conclusion))).map(r => r.name),
    checkCount: runs.length,
  };
}

/**
 * Re-run the failed jobs of every failed workflow run on a head. An Actions
 * run URL re-runs that run alone.
 * @param orgId - The workspace.
 * @param url - A pull request, or an Actions run.
 * @param headSha - The head whose runs to re-run; the pull request's head when omitted.
 */
export async function rerunFailedJobs(orgId: string, url: string, headSha?: string | null): Promise<{ repo: string; headSha: string | null; runIds: number[] }> {
  const pr = parsePullUrl(url);
  const run = pr ? null : parseRunUrl(url);
  if (!pr && !run) {
    throw new Error(`${url} is neither a GitHub pull request nor an Actions run`);
  }
  const gh = await ghFor(orgId, `${(pr ?? run)!.owner}/${(pr ?? run)!.repo}`);
  const repo = `${gh.owner}/${gh.repo}`;
  let sha = headSha ?? null;
  let runIds: number[];
  if (run) {
    runIds = [run.runId];
  } else {
    if (!sha) {
      const meta = await call<GithubPullRequest>(gh, `/pulls/${pr!.number}`);
      if (!meta.ok) {
        throw new Error(`${url} could not be read: ${meta.message}`);
      }
      sha = meta.data.head.sha;
    }
    const runs = await call<{ workflow_runs?: Array<{ id: number; status?: string | null; conclusion?: string | null }> }>(gh, `/actions/runs?head_sha=${sha}&per_page=50`);
    if (!runs.ok) {
      throw new Error(`the workflow runs on ${sha.slice(0, 12)} could not be listed: ${runs.message}`);
    }
    runIds = (runs.data.workflow_runs ?? []).filter(r => r.status === 'completed' && RERUNNABLE.has(String(r.conclusion))).map(r => r.id);
    if (runIds.length === 0) {
      throw new Error(`no failed GitHub Actions run on ${sha.slice(0, 12)} to re-run (a check from another app cannot be re-run from here)`);
    }
  }
  for (const id of runIds) {
    const res = await call<unknown>(gh, `/actions/runs/${id}/rerun-failed-jobs`, { method: 'POST', body: {} });
    if (!res.ok) {
      const request = res.status === 403
        ? await (await import('@/services/connections/connectionRequests')).withConnectionRequest({ orgId, repo, kind: 'upgrade', why: `Re-running failed CI jobs on ${repo} needs Actions: write, which this workspace's GitHub access does not carry.` })
        : '';
      throw new Error(`GitHub refused to re-run run ${id} on ${repo}: ${res.message}${res.status === 403 || res.status === 404 ? ' (the token needs Actions: write on this repository)' : ''}${request}`);
    }
  }
  return { repo, headSha: sha, runIds };
}

/**
 * Cancel workflow runs that are still running — the undo of a re-run.
 * @param orgId - The workspace.
 * @param repo - `owner/name`.
 * @param runIds - The runs.
 */
export async function cancelWorkflowRuns(orgId: string, repo: string, runIds: number[]): Promise<{ cancelled: number[]; finished: number[] }> {
  const gh = await ghFor(orgId, repo);
  const cancelled: number[] = [];
  const finished: number[] = [];
  for (const id of runIds) {
    const res = await call<unknown>(gh, `/actions/runs/${id}/cancel`, { method: 'POST', body: {} });
    // 409: the run already finished, so there is nothing left to cancel.
    (res.ok ? cancelled : finished).push(id);
  }
  return { cancelled, finished };
}

/**
 * Bring a pull request's branch up to date with its base (GitHub's "Update
 * branch"), so its checks run again against the base as it is now.
 * @param orgId - The workspace.
 * @param url - The pull request.
 * @param expectedHead - The head the update is for; GitHub refuses it if the branch moved.
 */
export async function updatePullBranch(orgId: string, url: string, expectedHead?: string | null): Promise<void> {
  const pr = parsePullUrl(url);
  if (!pr) {
    throw new Error(`${url} is not a GitHub pull request`);
  }
  const gh = await ghFor(orgId, `${pr.owner}/${pr.repo}`);
  const res = await call<unknown>(gh, `/pulls/${pr.number}/update-branch`, { method: 'PUT', body: expectedHead ? { expected_head_sha: expectedHead } : {} });
  if (!res.ok) {
    const request = res.status === 403
      ? await (await import('@/services/connections/connectionRequests')).withConnectionRequest({ orgId, repo: `${pr.owner}/${pr.repo}`, kind: 'upgrade', why: `Bringing pull requests on ${pr.owner}/${pr.repo} up to date with their base needs Contents: write, which this workspace's GitHub access does not carry.` })
      : '';
    throw new Error(`GitHub did not update ${url} with its base: ${res.message}${request}`);
  }
}
