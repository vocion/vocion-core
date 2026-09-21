/**
 * GitHub activity as Vocion events — the pure half of the `github` source.
 *
 * Two paths feed the same automations: the connector polls the REST API on the
 * source's schedule, and `POST /api/webhooks/github` receives deliveries the
 * moment they happen. Both go through the functions here, so an automation
 * subscribed to `pr.checks_completed` sees one payload shape whichever path
 * carried the news, and the same dedupe key — which is what lets both run at
 * once without firing twice.
 *
 * Event names and payloads are public API in the sense `EventService` gives
 * the term: a workspace author writes `when: { event: pr.merged }` and gets
 * the fields below as the run's input. Renaming one breaks every workspace
 * that subscribes, so treat these as a contract. Every payload field is a
 * scalar, because `when.filter` compares with `===`; the failed check names
 * are joined with `, ` for that reason.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* Event names                                                         */
/* ------------------------------------------------------------------ */

/** A pull request was opened (or reopened). */
export const PR_OPENED = 'pr.opened';
/** New commits were pushed to an open pull request's branch. */
export const PR_SYNCHRONIZED = 'pr.synchronized';
/** Every check run on the pull request's head commit has finished. */
export const PR_CHECKS_COMPLETED = 'pr.checks_completed';
/** A review was submitted on the pull request. */
export const PR_REVIEW_SUBMITTED = 'pr.review_submitted';
/** The pull request was merged. */
export const PR_MERGED = 'pr.merged';
/** The pull request was closed without merging. */
export const PR_CLOSED = 'pr.closed';
/** A GitHub Actions run on the deploy branch finished without succeeding. */
export const RUN_FAILED = 'run.failed';

export const GITHUB_EVENT_TYPES = [
  PR_OPENED,
  PR_SYNCHRONIZED,
  PR_CHECKS_COMPLETED,
  PR_REVIEW_SUBMITTED,
  PR_MERGED,
  PR_CLOSED,
  RUN_FAILED,
] as const;

export type GithubEventType = (typeof GITHUB_EVENT_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

/**
 * What every `pr.*` event carries. The keys an automation's `when.filter`
 * can match on and its workflow or mission receives as input.
 */
export type PullRequestEventPayload = {
  /** `owner/name`, as the source lists it. */
  repo: string;
  number: number;
  /** The pull request page on GitHub. */
  url: string;
  /** The head commit at the time of the event. */
  headSha: string;
  /** The head branch, e.g. `factory/task-042`. */
  branch: string;
  /** The branch the pull request targets. */
  baseBranch: string;
  title: string;
  /** GitHub login of whoever opened the pull request. */
  author: string;
  /** `open` or `closed` — the state at the time of the event. */
  state: string;
  draft: boolean;
  /** Also passed to `emitEvent`; carried here so a run can cite what deduped it. */
  dedupeKey: string;
};

export type PrChecksCompletedPayload = PullRequestEventPayload & {
  /** `success`, or `failure` when any check did not pass. */
  conclusion: 'success' | 'failure';
  /** The names of the checks that did not pass, joined with `, `. Empty on success. */
  failedChecks: string;
  failedCheckCount: number;
  checkCount: number;
};

export type PrReviewSubmittedPayload = PullRequestEventPayload & {
  /** `approved`, `changes_requested`, `commented` or `dismissed`. */
  reviewState: string;
  reviewer: string;
  reviewId: number;
  /** The commit the review was left on, which may trail `headSha`. */
  reviewedSha: string;
  reviewUrl: string;
  submittedAt: string;
};

export type PrMergedPayload = PullRequestEventPayload & {
  /** The merge commit on the base branch. */
  mergeSha: string;
  mergedAt: string;
};

export type PrClosedPayload = PullRequestEventPayload & {
  closedAt: string;
};

export type RunFailedPayload = {
  repo: string;
  runId: number;
  runNumber: number;
  runAttempt: number;
  /** The workflow's name, e.g. `Deploy`. */
  name: string;
  branch: string;
  headSha: string;
  /** What triggered the run — `push`, `workflow_dispatch`, `schedule`. */
  event: string;
  /** `failure`, `timed_out`, `startup_failure` … — whatever GitHub concluded. */
  conclusion: string;
  url: string;
  completedAt: string;
  dedupeKey: string;
};

/** One event, ready for `emitEvent`. */
export type GithubEvent = {
  type: GithubEventType;
  payload: Record<string, unknown>;
  dedupeKey: string;
};

/* ------------------------------------------------------------------ */
/* Upstream shapes — the fields read off the REST API and webhook bodies */
/* ------------------------------------------------------------------ */

/** A pull request as `GET /repos/{o}/{r}/pulls` lists it and as the `pull_request` webhook carries it. */
export type GithubPullRequest = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  draft?: boolean;
  user?: { login?: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
};

/** A check run as `GET /repos/{o}/{r}/commits/{sha}/check-runs` lists it. */
export type GithubCheckRun = {
  id: number;
  name: string;
  status: string;
  conclusion?: string | null;
};

/** A review as `GET /repos/{o}/{r}/pulls/{n}/reviews` lists it and as the `pull_request_review` webhook carries it. */
export type GithubReview = {
  id: number;
  state: string;
  user?: { login?: string } | null;
  submitted_at?: string | null;
  commit_id: string;
  html_url: string;
};

/** A workflow run as `GET /repos/{o}/{r}/actions/runs` lists it and as the `workflow_run` webhook carries it. */
export type GithubWorkflowRun = {
  id: number;
  name?: string | null;
  head_branch?: string | null;
  head_sha: string;
  run_number: number;
  run_attempt?: number;
  event: string;
  status?: string | null;
  conclusion?: string | null;
  html_url: string;
  updated_at: string;
};

/* ------------------------------------------------------------------ */
/* Building events                                                     */
/* ------------------------------------------------------------------ */

/**
 * The idempotency key for one pull-request event: repo, number, kind and
 * head sha, so a re-poll that sees the same state is a no-op and a push that
 * moves the head is a new event. Reviews add their own id, because two
 * reviews can land on one sha.
 * @param repo - `owner/name`.
 * @param number - Pull request number.
 * @param kind - The event type.
 * @param sha - The head sha the event is about.
 * @param extra - A further discriminator, when one sha can carry several events of the kind.
 */
export function prDedupeKey(repo: string, number: number, kind: GithubEventType, sha: string, extra?: string | number): string {
  return `github:${repo}#${number}:${kind}:${sha}${extra === undefined ? '' : `:${extra}`}`;
}

/**
 * Whether a head branch is one the source watches. No prefix means every
 * branch; `factory/` keeps the poller to what the factory pushed.
 * @param branch - The pull request's head ref.
 * @param prefix - The configured prefix, if any.
 */
export function matchesBranchPrefix(branch: string, prefix: string | undefined | null): boolean {
  const wanted = prefix?.trim();
  return !wanted || branch.startsWith(wanted);
}

function basePayload(repo: string, pr: GithubPullRequest, dedupeKey: string): PullRequestEventPayload {
  return {
    repo,
    number: pr.number,
    url: pr.html_url,
    headSha: pr.head.sha,
    branch: pr.head.ref,
    baseBranch: pr.base.ref,
    title: pr.title,
    author: pr.user?.login ?? '',
    state: pr.state,
    draft: pr.draft === true,
    dedupeKey,
  };
}

function prEvent(type: GithubEventType, repo: string, pr: GithubPullRequest, extra: Record<string, unknown> = {}, discriminator?: string | number): GithubEvent {
  const dedupeKey = prDedupeKey(repo, pr.number, type, pr.head.sha, discriminator);
  return { type, payload: { ...basePayload(repo, pr, dedupeKey), ...extra }, dedupeKey };
}

/**
 * The lifecycle events a pull request earned since the watermark, judged
 * from its timestamps alone: opened when it was created inside the window,
 * synchronized when it moved inside the window without being created there
 * (the dedupe key holds the head sha, so an update that pushed nothing is
 * absorbed on emit), merged or closed when it ended inside the window.
 *
 * Checks and reviews need a second request each and are built by
 * `checksCompletedEvent` and `reviewSubmittedEvents`.
 * @param repo - `owner/name`.
 * @param pr - The pull request as the API listed it.
 * @param since - The watermark; null on a first run, when everything in the list is new.
 */
export function pullRequestLifecycleEvents(repo: string, pr: GithubPullRequest, since: Date | null): GithubEvent[] {
  const events: GithubEvent[] = [];
  const at = (iso: string | null | undefined): boolean => !!iso && (since === null || new Date(iso) >= since);

  if (at(pr.created_at)) {
    events.push(prEvent(PR_OPENED, repo, pr));
  } else if (pr.state === 'open' && at(pr.updated_at)) {
    events.push(prEvent(PR_SYNCHRONIZED, repo, pr));
  }
  if (pr.merged_at && at(pr.merged_at)) {
    events.push(prEvent(PR_MERGED, repo, pr, { mergeSha: pr.merge_commit_sha ?? '', mergedAt: pr.merged_at }));
  } else if (pr.state === 'closed' && !pr.merged_at && at(pr.closed_at)) {
    events.push(prEvent(PR_CLOSED, repo, pr, { closedAt: pr.closed_at ?? '' }));
  }
  return events;
}

/** Conclusions that do not make a check "failed": it passed, or it was never a verdict. */
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

/**
 * `pr.checks_completed` for a head sha whose every check run has finished,
 * or null while any is still running (or none exist yet — a commit with no
 * checks is not a commit whose checks passed).
 * @param repo - `owner/name`.
 * @param pr - The pull request.
 * @param checkRuns - The check runs on `pr.head.sha`.
 */
export function checksCompletedEvent(repo: string, pr: GithubPullRequest, checkRuns: GithubCheckRun[]): GithubEvent | null {
  if (checkRuns.length === 0 || checkRuns.some(run => run.status !== 'completed')) {
    return null;
  }
  const failed = checkRuns.filter(run => !PASSING_CONCLUSIONS.has(run.conclusion ?? '')).map(run => run.name);
  const extra: Omit<PrChecksCompletedPayload, keyof PullRequestEventPayload> = {
    conclusion: failed.length > 0 ? 'failure' : 'success',
    failedChecks: failed.join(', '),
    failedCheckCount: failed.length,
    checkCount: checkRuns.length,
  };
  return prEvent(PR_CHECKS_COMPLETED, repo, pr, extra);
}

/**
 * One `pr.review_submitted` per review left since the watermark. GitHub
 * spells the state `APPROVED` on the REST API and `approved` on the webhook;
 * the payload lowercases so a filter can be written once.
 * @param repo - `owner/name`.
 * @param pr - The pull request.
 * @param reviews - The reviews on it.
 * @param since - The watermark; null takes every review.
 */
export function reviewSubmittedEvents(repo: string, pr: GithubPullRequest, reviews: GithubReview[], since: Date | null): GithubEvent[] {
  return reviews
    .filter(review => review.submitted_at && (since === null || new Date(review.submitted_at) >= since))
    // A pending review has no verdict yet and is private to its author.
    .filter(review => review.state.toLowerCase() !== 'pending')
    .map((review) => {
      const extra: Omit<PrReviewSubmittedPayload, keyof PullRequestEventPayload> = {
        reviewState: review.state.toLowerCase(),
        reviewer: review.user?.login ?? '',
        reviewId: review.id,
        reviewedSha: review.commit_id,
        reviewUrl: review.html_url,
        submittedAt: review.submitted_at ?? '',
      };
      return prEvent(PR_REVIEW_SUBMITTED, repo, pr, extra, review.id);
    });
}

/** A run whose conclusion means "did not succeed". Cancelled and skipped runs are somebody's choice, not a failure. */
const FAILING_RUN_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure', 'action_required', 'stale']);

/**
 * `run.failed` for a completed workflow run that did not succeed, or null
 * for anything else. Keyed on the run id and attempt, so a re-run that fails
 * again is a new event and a re-poll of the same attempt is not.
 * @param repo - `owner/name`.
 * @param run - The workflow run.
 */
export function runFailedEvent(repo: string, run: GithubWorkflowRun): GithubEvent | null {
  if ((run.status ?? 'completed') !== 'completed' || !FAILING_RUN_CONCLUSIONS.has(run.conclusion ?? '')) {
    return null;
  }
  const attempt = run.run_attempt ?? 1;
  const dedupeKey = `github:${repo}:${RUN_FAILED}:${run.id}:${attempt}`;
  const payload: RunFailedPayload = {
    repo,
    runId: run.id,
    runNumber: run.run_number,
    runAttempt: attempt,
    name: run.name ?? '',
    branch: run.head_branch ?? '',
    headSha: run.head_sha,
    event: run.event,
    conclusion: run.conclusion ?? '',
    url: run.html_url,
    completedAt: run.updated_at,
    dedupeKey,
  };
  return { type: RUN_FAILED, payload, dedupeKey };
}

/* ------------------------------------------------------------------ */
/* Webhook deliveries                                                  */
/* ------------------------------------------------------------------ */

/**
 * Check a delivery's `X-Hub-Signature-256` against the shared secret:
 * `sha256=` + HMAC-SHA256 of the raw body. Compared in constant time.
 * @param rawBody - The body exactly as received, before parsing.
 * @param signatureHeader - The `X-Hub-Signature-256` header value.
 * @param secret - The webhook secret configured on GitHub and in `GITHUB_WEBHOOK_SECRET`.
 */
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
): { ok: true } | { ok: false; reason: 'missing_secret' | 'missing_signature' | 'bad_signature' } {
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (!signatureHeader) {
    return { ok: false, reason: 'missing_signature' };
  }
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

/** What a webhook delivery turned into. */
export type WebhookMapping = {
  /** `owner/name` of the repository the delivery is about. */
  repo: string;
  events: GithubEvent[];
  /**
   * A check suite finished on these pull requests, but the delivery carries
   * neither their titles nor the check names: the receiver hydrates them
   * through the API with the source's own credential.
   */
  checkSuiteFor: Array<{ number: number; headSha: string; branch: string }>;
};

type PullRequestDelivery = { action?: string; pull_request?: GithubPullRequest; review?: GithubReview };
type CheckSuiteDelivery = { action?: string; check_suite?: { head_sha: string; head_branch?: string | null; pull_requests?: Array<{ number: number; head: { ref: string; sha: string } }> } };
type WorkflowRunDelivery = { action?: string; workflow_run?: GithubWorkflowRun };

/**
 * The events one webhook delivery carries, by `X-GitHub-Event` name. Anything
 * this source does not model — pings, labels, comments, a check suite that
 * touched no pull request — maps to nothing and is acknowledged.
 * @param eventName - The `X-GitHub-Event` header.
 * @param body - The parsed delivery.
 * @param deployBranch - The branch whose failed runs become `run.failed`.
 */
export function eventsFromWebhook(eventName: string, body: unknown, deployBranch: string): WebhookMapping | null {
  const delivery = (body ?? {}) as { repository?: { full_name?: string } };
  const repo = delivery.repository?.full_name;
  if (!repo) {
    return null;
  }
  const out: WebhookMapping = { repo, events: [], checkSuiteFor: [] };

  if (eventName === 'pull_request') {
    const { action, pull_request: pr } = body as PullRequestDelivery;
    if (!pr) {
      return out;
    }
    if (action === 'opened' || action === 'reopened' || action === 'ready_for_review') {
      out.events.push(prEvent(PR_OPENED, repo, pr));
    } else if (action === 'synchronize') {
      out.events.push(prEvent(PR_SYNCHRONIZED, repo, pr));
    } else if (action === 'closed' && pr.merged_at) {
      out.events.push(prEvent(PR_MERGED, repo, pr, { mergeSha: pr.merge_commit_sha ?? '', mergedAt: pr.merged_at }));
    } else if (action === 'closed') {
      out.events.push(prEvent(PR_CLOSED, repo, pr, { closedAt: pr.closed_at ?? '' }));
    }
    return out;
  }

  if (eventName === 'pull_request_review') {
    const { action, pull_request: pr, review } = body as PullRequestDelivery;
    if (action === 'submitted' && pr && review) {
      out.events.push(...reviewSubmittedEvents(repo, pr, [review], null));
    }
    return out;
  }

  if (eventName === 'check_suite') {
    const { action, check_suite: suite } = body as CheckSuiteDelivery;
    if (action === 'completed' && suite) {
      for (const pr of suite.pull_requests ?? []) {
        out.checkSuiteFor.push({ number: pr.number, headSha: suite.head_sha, branch: pr.head.ref });
      }
    }
    return out;
  }

  if (eventName === 'workflow_run') {
    const { action, workflow_run: run } = body as WorkflowRunDelivery;
    if (action === 'completed' && run && run.head_branch === deployBranch) {
      const event = runFailedEvent(repo, run);
      if (event) {
        out.events.push(event);
      }
    }
    return out;
  }

  return out;
}
