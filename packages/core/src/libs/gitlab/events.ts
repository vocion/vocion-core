/**
 * GitLab activity as Vocion events — the pure half of the `gitlab` source.
 *
 * ONE EVENT VOCABULARY FOR EVERY CODE HOST. An automation that says
 * `when: { event: pr.checks_completed, filter: { conclusion: failure } }` was
 * written against the GitHub source, and it must fire for a GitLab merge
 * request with the same payload, or every workspace's automations would need
 * a GitLab twin. So nothing here builds an event: a merge request is mapped
 * onto the pull request shape the GitHub builders read (`libs/github/events.ts`,
 * whose field names are the repo family's lingua franca), a pipeline's jobs
 * onto check runs, an approval onto a review, a pipeline onto a workflow run,
 * and the builders in `libs/github/events.ts` do the rest. The only thing that
 * differs is the dedupe key's prefix, `gitlab:` instead of `github:`, so a
 * GitLab project that happens to share a path with a GitHub repository never
 * dedupes against it.
 *
 *   merge request          → pull request (`iid` is the number, `opened` is
 *                            `open`, `merged` is `closed` with `merged_at`)
 *   pipeline job           → check run (a failed job that is allowed to fail
 *                            is `neutral`, a manual job that never ran is
 *                            `skipped`, both passing, as GitHub's are)
 *   approval / unapproval  → review `approved` / `dismissed`; GitLab 17's
 *                            "requested changes" → `changes_requested`
 *   pipeline               → workflow run (`.gitlab-ci.yml` is its `path`)
 *
 * The approval mapping reads GitLab's own SYSTEM notes, whose bodies GitLab
 * writes from a fixed template ("approved this merge request"). That is a
 * machine's state change, not a person's words, so it is read as data.
 *
 * Webhook deliveries (`X-Gitlab-Event`) map onto the same builders, verified
 * by the shared secret GitLab sends in `X-Gitlab-Token`.
 */

import type { GithubCheckRun, GithubEvent, GithubPullRequest, GithubReview, GithubWorkflowRun } from '@/libs/github/events';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import {
  checksCompletedEvent,
  mergedPullEvent,
  PR_CLOSED,
  PR_OPENED,
  PR_SYNCHRONIZED,
  prEvent,
  pullRequestLifecycleEvents,
  reviewSubmittedEvents,
  runFailedEvent,
  runSucceededEvent,
} from '@/libs/github/events';

/* ------------------------------------------------------------------ */
/* Upstream shapes — the fields read off the REST API and hook bodies  */
/* ------------------------------------------------------------------ */

type GitlabUser = { username?: string | null } | null | undefined;

/** A merge request as `GET /projects/:id/merge_requests[/:iid]` returns it. */
export type GitlabMergeRequest = {
  id?: number;
  iid: number;
  project_id?: number;
  title: string;
  description?: string | null;
  /** `opened`, `closed`, `merged` or `locked`. */
  state: string;
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  closed_at?: string | null;
  author?: GitlabUser;
  merged_by?: GitlabUser;
  merge_user?: GitlabUser;
  reviewers?: GitlabUser[] | null;
  source_branch: string;
  target_branch: string;
  /** The head commit. */
  sha: string;
  merge_commit_sha?: string | null;
  squash_commit_sha?: string | null;
  draft?: boolean;
  work_in_progress?: boolean;
  web_url: string;
  labels?: string[];
  has_conflicts?: boolean;
  /** Single reads: `mergeable`, `conflict`, `checking`, `ci_still_running`, `not_approved` … */
  detailed_merge_status?: string;
  /** Single reads: the three commits a diff position is built from. */
  diff_refs?: { base_sha?: string; head_sha?: string; start_sha?: string } | null;
  /** Single reads: the newest pipeline on the head, which may run in the source project (a fork). */
  head_pipeline?: GitlabPipeline | null;
  /** Single reads: a count as a string, `"1000+"` past a thousand. */
  changes_count?: string | null;
};

/** A pipeline as `GET /projects/:id/pipelines[/:id]` returns it. */
export type GitlabPipeline = {
  id: number;
  iid?: number | null;
  project_id?: number;
  sha: string;
  ref: string;
  /** `created`, `pending`, `running`, `success`, `failed`, `canceled`, `skipped`, `manual`, `scheduled` … */
  status: string;
  /** What started it: `push`, `web`, `schedule`, `merge_request_event`, `api`, `trigger` … */
  source?: string | null;
  name?: string | null;
  web_url: string;
  created_at?: string | null;
  updated_at?: string | null;
  finished_at?: string | null;
};

/** A job as `GET /projects/:id/pipelines/:pipeline_id/jobs` returns it. */
export type GitlabJob = {
  id: number;
  name: string;
  stage?: string | null;
  status: string;
  allow_failure?: boolean;
  web_url?: string | null;
  finished_at?: string | null;
};

/** A note as `GET /projects/:id/merge_requests/:iid/notes` returns it. */
export type GitlabNote = {
  id: number;
  body: string;
  system?: boolean;
  author?: GitlabUser;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* Mapping onto the shapes the event builders read                     */
/* ------------------------------------------------------------------ */

/**
 * A merge request as the pull request the event builders and the factory's
 * read-backs understand.
 * @param mr - The merge request.
 */
export function pullFromMergeRequest(mr: GitlabMergeRequest): GithubPullRequest {
  const merged = mr.state === 'merged';
  const conflict = mr.has_conflicts === true || mr.detailed_merge_status === 'conflict';
  return {
    number: mr.iid,
    title: mr.title,
    state: mr.state === 'opened' ? 'open' : 'closed',
    html_url: mr.web_url,
    draft: mr.draft === true || mr.work_in_progress === true,
    user: { login: mr.author?.username ?? '' },
    requested_reviewers: (mr.reviewers ?? []).map(r => ({ login: r?.username ?? '' })).filter(r => r.login),
    head: { ref: mr.source_branch, sha: mr.sha },
    base: { ref: mr.target_branch },
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    closed_at: merged ? null : (mr.closed_at ?? (mr.state === 'opened' ? null : mr.updated_at)),
    merged_at: merged ? (mr.merged_at ?? mr.updated_at) : null,
    // A merge commit, else the squash commit, else (a fast-forward) the head itself.
    merge_commit_sha: merged ? (mr.merge_commit_sha ?? mr.squash_commit_sha ?? mr.sha) : null,
    merged_by: merged ? { login: mr.merged_by?.username ?? mr.merge_user?.username ?? '' } : null,
    mergeable: conflict ? false : mr.detailed_merge_status === 'checking' || mr.detailed_merge_status === 'unchecked' ? null : true,
    mergeable_state: conflict ? 'dirty' : (mr.detailed_merge_status ?? undefined),
  };
}

const RUNNING_JOB = new Set(['created', 'pending', 'running', 'preparing', 'waiting_for_resource', 'scheduled', 'waiting_for_callback']);

/**
 * A job's verdict in the check vocabulary: `status` is `completed` once it
 * finished, and `conclusion` is GitHub's word for how.
 * @param status - The job's status.
 * @param allowFailure - Whether the pipeline lets it fail.
 */
export function conclusionOfJob(status: string, allowFailure = false): { status: string; conclusion: string | null } {
  if (RUNNING_JOB.has(status)) {
    return { status: status === 'running' ? 'in_progress' : 'queued', conclusion: null };
  }
  switch (status) {
    case 'success':
      return { status: 'completed', conclusion: 'success' };
    case 'failed':
      return { status: 'completed', conclusion: allowFailure ? 'neutral' : 'failure' };
    case 'canceled':
    case 'canceling':
      return { status: 'completed', conclusion: 'cancelled' };
    // A manual job that nobody started never ran: no verdict, like a skipped one.
    case 'manual':
    case 'skipped':
      return { status: 'completed', conclusion: 'skipped' };
    default:
      return { status: 'completed', conclusion: status };
  }
}

/**
 * A pipeline's jobs as check runs.
 * @param jobs - The jobs (the latest attempt of each; GitLab hides retried ones by default).
 */
export function checkRunsFromJobs(jobs: readonly GitlabJob[]): GithubCheckRun[] {
  return jobs.map((job) => {
    const v = conclusionOfJob(job.status, job.allow_failure === true);
    return { id: job.id, name: job.stage ? `${job.stage}: ${job.name}` : job.name, status: v.status, conclusion: v.conclusion };
  });
}

/**
 * The review a system note records, or null for any other note. GitLab
 * writes these bodies itself, from fixed templates.
 * @param note - A note on the merge request.
 */
export function reviewStateOfNote(note: Pick<GitlabNote, 'body' | 'system'>): 'APPROVED' | 'DISMISSED' | 'CHANGES_REQUESTED' | null {
  if (!note.system) {
    return null;
  }
  const body = note.body.trim().toLowerCase();
  if (body.startsWith('approved this merge request')) {
    return 'APPROVED';
  }
  if (body.startsWith('unapproved this merge request')) {
    return 'DISMISSED';
  }
  if (body.startsWith('requested changes')) {
    return 'CHANGES_REQUESTED';
  }
  return null;
}

/**
 * The reviews a merge request's notes record, as GitHub reviews: one per
 * approval, unapproval or request for changes, keyed on the note's id.
 * @param mr - The merge request.
 * @param notes - Its notes.
 */
export function reviewsFromNotes(mr: GitlabMergeRequest, notes: readonly GitlabNote[]): GithubReview[] {
  const out: GithubReview[] = [];
  for (const note of notes) {
    const state = reviewStateOfNote(note);
    if (state) {
      out.push({ id: note.id, state, user: { login: note.author?.username ?? '' }, submitted_at: note.created_at, commit_id: mr.sha, html_url: `${mr.web_url}#note_${note.id}` });
    }
  }
  return out;
}

const FINISHED_PIPELINE: Record<string, string> = { success: 'success', failed: 'failure', canceled: 'cancelled', skipped: 'skipped' };

/**
 * A pipeline as the workflow run the run events are built from.
 * @param pipeline - The pipeline.
 */
export function runFromPipeline(pipeline: GitlabPipeline): GithubWorkflowRun {
  const conclusion = FINISHED_PIPELINE[pipeline.status] ?? null;
  return {
    id: pipeline.id,
    name: pipeline.name || 'pipeline',
    head_branch: pipeline.ref,
    head_sha: pipeline.sha,
    run_number: pipeline.iid ?? pipeline.id,
    run_attempt: 1,
    event: pipeline.source ?? '',
    status: conclusion ? 'completed' : pipeline.status,
    conclusion,
    html_url: pipeline.web_url,
    updated_at: pipeline.finished_at ?? pipeline.updated_at ?? pipeline.created_at ?? new Date(0).toISOString(),
    path: '.gitlab-ci.yml',
    created_at: pipeline.created_at ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/**
 * An event built by the GitHub builders, keyed as GitLab's: the key prefix is
 * the host's, in the key and in the payload's copy of it.
 * @param event - The event.
 * @param suffix - A further discriminator appended to the key.
 */
export function onGitlab(event: GithubEvent, suffix?: string): GithubEvent {
  const dedupeKey = `${event.dedupeKey.replace(/^github:/, 'gitlab:')}${suffix ? `:${suffix}` : ''}`;
  return { ...event, dedupeKey, payload: { ...event.payload, dedupeKey } };
}

/**
 * The lifecycle events a merge request earned since the watermark.
 * @param project - The project path.
 * @param mr - The merge request.
 * @param since - The watermark; null takes everything.
 */
export function mergeRequestLifecycleEvents(project: string, mr: GitlabMergeRequest, since: Date | null): GithubEvent[] {
  return pullRequestLifecycleEvents(project, pullFromMergeRequest(mr), since).map(e => onGitlab(e));
}

/**
 * `pr.checks_completed` for a merge request whose head pipeline finished, or null.
 * @param project - The project path.
 * @param mr - The merge request.
 * @param jobs - The head pipeline's jobs.
 */
export function mergeRequestChecksEvent(project: string, mr: GitlabMergeRequest, jobs: readonly GitlabJob[]): GithubEvent | null {
  const event = checksCompletedEvent(project, pullFromMergeRequest(mr), checkRunsFromJobs(jobs));
  return event ? onGitlab(event) : null;
}

/**
 * `pr.review_submitted` for each approval, unapproval or request for changes since the watermark.
 * @param project - The project path.
 * @param mr - The merge request.
 * @param notes - Its notes.
 * @param since - The watermark; null takes every one.
 */
export function mergeRequestReviewEvents(project: string, mr: GitlabMergeRequest, notes: readonly GitlabNote[], since: Date | null): GithubEvent[] {
  return reviewSubmittedEvents(project, pullFromMergeRequest(mr), reviewsFromNotes(mr, notes), since).map(e => onGitlab(e));
}

/**
 * `pr.merged` in the one shape the sync and Vocion's own merge both emit.
 * @param project - The project path.
 * @param mr - The merge request, after the merge.
 */
export function mergedMergeRequestEvent(project: string, mr: GitlabMergeRequest): GithubEvent {
  return onGitlab(mergedPullEvent(project, pullFromMergeRequest(mr)));
}

/**
 * `run.failed` or `run.succeeded` for a finished pipeline, or null. A
 * pipeline that is retried keeps its id, so its key carries the time it
 * finished: a retry that fails again is a new event, a re-poll is not.
 * @param project - The project path.
 * @param pipeline - The pipeline.
 */
export function pipelineRunEvent(project: string, pipeline: GitlabPipeline): GithubEvent | null {
  const run = runFromPipeline(pipeline);
  const event = runFailedEvent(project, run) ?? runSucceededEvent(project, run);
  return event ? onGitlab(event, run.updated_at) : null;
}

/* ------------------------------------------------------------------ */
/* Webhook deliveries                                                  */
/* ------------------------------------------------------------------ */

/**
 * Check a delivery's `X-Gitlab-Token` against the shared secret, in constant
 * time. GitLab sends the secret itself, not a signature of the body.
 * @param header - The `X-Gitlab-Token` header value.
 * @param secret - `GITLAB_WEBHOOK_SECRET`.
 */
export function verifyGitlabToken(header: string | null, secret: string | undefined): { ok: true } | { ok: false; reason: 'missing_secret' | 'missing_token' | 'bad_token' } {
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (!header) {
    return { ok: false, reason: 'missing_token' };
  }
  const a = Buffer.from(secret);
  const b = Buffer.from(header);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_token' };
  }
  return { ok: true };
}

/** What a webhook delivery turned into, before anything is read from the API. */
export type GitlabWebhookMapping = {
  /** The project path the delivery is about. */
  project: string;
  /** The instance's web origin, from `project.web_url`. */
  host: string | null;
  events: GithubEvent[];
  /** A merge request the delivery is about, to read whole with the source's token when it has one. */
  mergeRequest: { iid: number; action: string } | null;
  /** A pipeline finished on a merge request: its checks are read from the API. */
  checksFor: Array<{ iid: number }>;
  /** A branch pipeline finished: the open merge requests from that branch get their checks read. */
  branchPipeline: { ref: string; sha: string } | null;
};

type MergeRequestHook = {
  object_attributes?: {
    iid?: number;
    title?: string;
    state?: string;
    action?: string;
    source_branch?: string;
    target_branch?: string;
    url?: string;
    created_at?: string;
    updated_at?: string;
    merge_commit_sha?: string | null;
    draft?: boolean;
    work_in_progress?: boolean;
    oldrev?: string;
    last_commit?: { id?: string };
  };
  user?: GitlabUser;
};

type PipelineHook = {
  object_attributes?: GitlabPipeline & { url?: string };
  merge_request?: { iid?: number } | null;
};

/**
 * GitLab's hook timestamps are `2026-11-04 12:06:48 UTC`; ISO is what the builders compare.
 * @param s - A hook timestamp.
 */
function isoOf(s: string | undefined | null): string {
  if (!s) {
    return new Date().toISOString();
  }
  const d = new Date(s.replace(' UTC', 'Z').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * A merge request hook's object as a merge request, for a source with no
 * token to read it whole. The author is the actor only when the actor opened it.
 * @param hook - The delivery.
 */
export function mergeRequestFromHook(hook: MergeRequestHook): GitlabMergeRequest | null {
  const o = hook.object_attributes;
  if (!o?.iid || !o.source_branch || !o.target_branch || !o.url) {
    return null;
  }
  const opened = o.action === 'open' || o.action === 'reopen';
  return {
    iid: o.iid,
    title: o.title ?? '',
    state: o.state ?? 'opened',
    created_at: isoOf(o.created_at),
    updated_at: isoOf(o.updated_at),
    merged_at: o.state === 'merged' ? isoOf(o.updated_at) : null,
    closed_at: o.state === 'closed' ? isoOf(o.updated_at) : null,
    author: opened ? hook.user : null,
    merge_user: o.state === 'merged' ? hook.user : null,
    source_branch: o.source_branch,
    target_branch: o.target_branch,
    sha: o.last_commit?.id ?? '',
    merge_commit_sha: o.merge_commit_sha ?? null,
    draft: o.draft === true || o.work_in_progress === true,
    web_url: o.url,
  };
}

/**
 * The lifecycle event one merge request action earns, from the merge request
 * as read (whole when the source has a token, from the hook when not).
 * @param project - The project path.
 * @param action - The hook's `object_attributes.action`.
 * @param mr - The merge request.
 * @param pushed - Whether the update moved the head (`oldrev` present).
 */
export function eventForMergeRequestAction(project: string, action: string, mr: GitlabMergeRequest, pushed: boolean): GithubEvent | null {
  const pr = pullFromMergeRequest(mr);
  const build = (type: typeof PR_OPENED | typeof PR_SYNCHRONIZED) => onGitlab(prEvent(type, project, pr));
  if (action === 'open' || action === 'reopen') {
    return build(PR_OPENED);
  }
  if (action === 'update' && pushed && mr.state === 'opened') {
    return build(PR_SYNCHRONIZED);
  }
  if (action === 'merge') {
    return mergedMergeRequestEvent(project, { ...mr, state: 'merged' });
  }
  if (action === 'close') {
    return onGitlab(prEvent(PR_CLOSED, project, pr, { closedAt: pr.closed_at ?? mr.updated_at }));
  }
  return null;
}

/**
 * What one delivery carries, by its `X-Gitlab-Event` name. Anything this
 * source does not model maps to nothing and is acknowledged.
 * @param eventName - The `X-Gitlab-Event` header, e.g. `Merge Request Hook`.
 * @param body - The parsed delivery.
 * @param deployBranch - The branch whose finished pipelines become run events.
 */
export function eventsFromGitlabWebhook(eventName: string, body: unknown, deployBranch: string): GitlabWebhookMapping | null {
  const delivery = (body ?? {}) as { project?: { path_with_namespace?: string; web_url?: string } };
  const project = delivery.project?.path_with_namespace;
  if (!project) {
    return null;
  }
  let host: string | null = null;
  try {
    host = delivery.project?.web_url ? new URL(delivery.project.web_url).hostname.toLowerCase() : null;
  } catch {
    host = null;
  }
  const out: GitlabWebhookMapping = { project, host, events: [], mergeRequest: null, checksFor: [], branchPipeline: null };

  if (eventName === 'Merge Request Hook') {
    const hook = body as MergeRequestHook;
    const action = hook.object_attributes?.action ?? '';
    const iid = hook.object_attributes?.iid;
    if (!iid) {
      return out;
    }
    out.mergeRequest = { iid, action };
    const mr = mergeRequestFromHook(hook);
    if (mr && action !== 'approved' && action !== 'unapproved' && action !== 'approval' && action !== 'unapproval') {
      const event = eventForMergeRequestAction(project, action, mr, Boolean(hook.object_attributes?.oldrev));
      if (event) {
        out.events.push(event);
      }
    }
    return out;
  }

  if (eventName === 'Pipeline Hook') {
    const hook = body as PipelineHook;
    const p = hook.object_attributes;
    if (!p || !FINISHED_PIPELINE[p.status]) {
      return out;
    }
    if (hook.merge_request?.iid) {
      out.checksFor.push({ iid: hook.merge_request.iid });
      return out;
    }
    if (p.ref === deployBranch) {
      const pipeline = { ...p, web_url: p.web_url ?? p.url ?? (delivery.project?.web_url ? `${delivery.project.web_url}/-/pipelines/${p.id}` : ''), finished_at: p.finished_at ? isoOf(p.finished_at) : null, created_at: isoOf(p.created_at) };
      const event = pipelineRunEvent(project, pipeline);
      if (event) {
        out.events.push(event);
      }
    } else {
      out.branchPipeline = { ref: p.ref, sha: p.sha };
    }
    return out;
  }

  return out;
}
