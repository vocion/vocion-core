/**
 * GitHub activity → Vocion events, from fixture API payloads. Pins the event
 * names, the payload keys an automation filters on, that dedupe keys are
 * stable across re-polls and move with the head sha, the branch filter, and
 * the webhook mapping plus its signature check — the contract both the poll
 * and the webhook path honour.
 */
import type { GithubPullRequest } from './events';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checksCompletedEvent,
  eventsFromWebhook,
  matchesBranchPrefix,
  PR_CHECKS_COMPLETED,
  PR_CLOSED,
  PR_MERGED,
  PR_OPENED,
  PR_REVIEW_SUBMITTED,
  PR_SYNCHRONIZED,
  prDedupeKey,
  pullRequestLifecycleEvents,
  reviewSubmittedEvents,
  RUN_FAILED,
  runFailedEvent,
  verifyGithubSignature,
} from './events';

const REPO = 'northwind/orders-api';
const SINCE = new Date('2026-09-19T12:00:00Z');

/**
 * A pull request as the REST API lists it, opened before the window and pushed inside it.
 * @param over - Fields to change from the default.
 */
function pr(over: Partial<GithubPullRequest> = {}): GithubPullRequest {
  return {
    number: 3,
    title: 'feat(intake): accept requests from the mailbox',
    state: 'open',
    html_url: 'https://github.com/northwind/orders-api/pull/3',
    draft: false,
    user: { login: 'factory-bot' },
    head: { ref: 'factory/task-042', sha: 'abc123' },
    base: { ref: 'main' },
    created_at: '2026-09-18T09:00:00Z',
    updated_at: '2026-09-19T15:00:00Z',
    closed_at: null,
    merged_at: null,
    merge_commit_sha: null,
    ...over,
  };
}

describe('pullRequestLifecycleEvents', () => {
  it('emits pr.opened for a pull request created inside the window, with the documented payload', () => {
    const events = pullRequestLifecycleEvents(REPO, pr({ created_at: '2026-09-19T14:00:00Z' }), SINCE);

    expect(events.map(e => e.type)).toEqual([PR_OPENED]);
    expect(events[0]!.payload).toEqual({
      repo: REPO,
      number: 3,
      url: 'https://github.com/northwind/orders-api/pull/3',
      headSha: 'abc123',
      branch: 'factory/task-042',
      baseBranch: 'main',
      title: 'feat(intake): accept requests from the mailbox',
      author: 'factory-bot',
      state: 'open',
      draft: false,
      dedupeKey: `github:${REPO}#3:pr.opened:abc123`,
    });
  });

  it('emits pr.synchronized for an open pull request that moved inside the window but was created before it', () => {
    const events = pullRequestLifecycleEvents(REPO, pr(), SINCE);

    expect(events.map(e => e.type)).toEqual([PR_SYNCHRONIZED]);
    expect(events[0]!.dedupeKey).toBe(`github:${REPO}#3:pr.synchronized:abc123`);
  });

  it('emits nothing for a pull request untouched since the watermark', () => {
    expect(pullRequestLifecycleEvents(REPO, pr({ updated_at: '2026-09-19T11:00:00Z' }), SINCE)).toEqual([]);
  });

  it('emits pr.merged with the merge sha, and not pr.closed, for a merged pull request', () => {
    const events = pullRequestLifecycleEvents(REPO, pr({ state: 'closed', closed_at: '2026-09-19T16:00:00Z', merged_at: '2026-09-19T16:00:00Z', merge_commit_sha: 'merge999' }), SINCE);

    expect(events.map(e => e.type)).toEqual([PR_MERGED]);
    expect(events[0]!.payload).toMatchObject({ mergeSha: 'merge999', mergedAt: '2026-09-19T16:00:00Z', state: 'closed' });
  });

  it('emits pr.closed for a pull request closed without merging', () => {
    const events = pullRequestLifecycleEvents(REPO, pr({ state: 'closed', closed_at: '2026-09-19T16:00:00Z' }), SINCE);

    expect(events.map(e => e.type)).toEqual([PR_CLOSED]);
    expect(events[0]!.payload).toMatchObject({ closedAt: '2026-09-19T16:00:00Z' });
  });

  it('on a first run (no watermark) treats everything listed as new', () => {
    const events = pullRequestLifecycleEvents(REPO, pr({ created_at: '2026-01-01T00:00:00Z' }), null);

    expect(events.map(e => e.type)).toEqual([PR_OPENED]);
  });

  it('keeps every payload field a scalar, so when.filter can match any of them', () => {
    const events = pullRequestLifecycleEvents(REPO, pr({ created_at: '2026-09-19T14:00:00Z' }), SINCE);

    for (const value of Object.values(events[0]!.payload)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });
});

describe('prDedupeKey', () => {
  it('is stable for the same repo, number, kind and sha, so a re-poll is a no-op', () => {
    expect(prDedupeKey(REPO, 3, PR_OPENED, 'abc123')).toBe(prDedupeKey(REPO, 3, PR_OPENED, 'abc123'));
  });

  it('changes when the head sha moves, so a push is a new event', () => {
    expect(prDedupeKey(REPO, 3, PR_SYNCHRONIZED, 'abc123')).not.toBe(prDedupeKey(REPO, 3, PR_SYNCHRONIZED, 'def456'));
  });

  it('tells two kinds on one sha apart', () => {
    expect(prDedupeKey(REPO, 3, PR_OPENED, 'abc123')).not.toBe(prDedupeKey(REPO, 3, PR_CHECKS_COMPLETED, 'abc123'));
  });
});

describe('checksCompletedEvent', () => {
  const runs = [
    { id: 1, name: 'unit', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'typecheck', status: 'completed', conclusion: 'failure' },
    { id: 3, name: 'lint', status: 'completed', conclusion: 'timed_out' },
    { id: 4, name: 'codecov', status: 'completed', conclusion: 'neutral' },
  ];

  it('reports failure and names the failed checks, comma-joined', () => {
    const event = checksCompletedEvent(REPO, pr(), runs);

    expect(event?.type).toBe(PR_CHECKS_COMPLETED);
    expect(event?.payload).toMatchObject({ conclusion: 'failure', failedChecks: 'typecheck, lint', failedCheckCount: 2, checkCount: 4 });
    expect(event?.dedupeKey).toBe(`github:${REPO}#3:pr.checks_completed:abc123`);
  });

  it('reports success when every check passed, was neutral or was skipped', () => {
    const event = checksCompletedEvent(REPO, pr(), [runs[0]!, runs[3]!, { id: 5, name: 'docs', status: 'completed', conclusion: 'skipped' }]);

    expect(event?.payload).toMatchObject({ conclusion: 'success', failedChecks: '', failedCheckCount: 0 });
  });

  it('waits while any check is still running, and for a commit with no checks', () => {
    expect(checksCompletedEvent(REPO, pr(), [runs[0]!, { id: 9, name: 'e2e', status: 'in_progress', conclusion: null }])).toBeNull();
    expect(checksCompletedEvent(REPO, pr(), [])).toBeNull();
  });
});

describe('reviewSubmittedEvents', () => {
  const reviews = [
    { id: 11, state: 'APPROVED', user: { login: 'chris' }, submitted_at: '2026-09-19T13:00:00Z', commit_id: 'abc123', html_url: 'https://github.com/northwind/orders-api/pull/3#pullrequestreview-11' },
    { id: 12, state: 'CHANGES_REQUESTED', user: { login: 'sam' }, submitted_at: '2026-09-19T11:00:00Z', commit_id: 'abc122', html_url: 'https://github.com/northwind/orders-api/pull/3#pullrequestreview-12' },
    { id: 13, state: 'PENDING', user: { login: 'sam' }, submitted_at: null, commit_id: 'abc123', html_url: '' },
  ];

  it('emits one event per review submitted inside the window, lowercasing the state', () => {
    const events = reviewSubmittedEvents(REPO, pr(), reviews, SINCE);

    expect(events.map(e => e.type)).toEqual([PR_REVIEW_SUBMITTED]);
    expect(events[0]!.payload).toMatchObject({ reviewState: 'approved', reviewer: 'chris', reviewId: 11, reviewedSha: 'abc123' });
    // Two reviews can land on one sha, so the review id is part of the key.
    expect(events[0]!.dedupeKey).toBe(`github:${REPO}#3:pr.review_submitted:abc123:11`);
  });

  it('drops pending reviews even with no watermark', () => {
    expect(reviewSubmittedEvents(REPO, pr(), reviews, null).map(e => e.payload.reviewId)).toEqual([11, 12]);
  });
});

describe('runFailedEvent', () => {
  const run = {
    id: 5001,
    name: 'Deploy',
    head_branch: 'main',
    head_sha: 'deadbeef',
    run_number: 88,
    run_attempt: 2,
    event: 'push',
    status: 'completed',
    conclusion: 'failure',
    html_url: 'https://github.com/northwind/orders-api/actions/runs/5001',
    updated_at: '2026-09-19T17:00:00Z',
  };

  it('emits run.failed with the run url and conclusion, keyed on run id and attempt', () => {
    const event = runFailedEvent(REPO, run);

    expect(event?.type).toBe(RUN_FAILED);
    expect(event?.payload).toEqual({
      repo: REPO,
      runId: 5001,
      runNumber: 88,
      runAttempt: 2,
      name: 'Deploy',
      branch: 'main',
      headSha: 'deadbeef',
      event: 'push',
      conclusion: 'failure',
      url: 'https://github.com/northwind/orders-api/actions/runs/5001',
      completedAt: '2026-09-19T17:00:00Z',
      dedupeKey: `github:${REPO}:run.failed:5001:2`,
    });
  });

  it('ignores runs that succeeded, were cancelled, or are still going', () => {
    expect(runFailedEvent(REPO, { ...run, conclusion: 'success' })).toBeNull();
    expect(runFailedEvent(REPO, { ...run, conclusion: 'cancelled' })).toBeNull();
    expect(runFailedEvent(REPO, { ...run, status: 'in_progress', conclusion: null })).toBeNull();
  });

  it('counts a timed-out run as failed', () => {
    expect(runFailedEvent(REPO, { ...run, conclusion: 'timed_out' })?.payload.conclusion).toBe('timed_out');
  });
});

describe('matchesBranchPrefix', () => {
  it('watches every branch with no prefix and only the prefixed ones with one', () => {
    expect(matchesBranchPrefix('feature/x', undefined)).toBe(true);
    expect(matchesBranchPrefix('feature/x', '')).toBe(true);
    expect(matchesBranchPrefix('factory/task-1', 'factory/')).toBe(true);
    expect(matchesBranchPrefix('feature/x', 'factory/')).toBe(false);
  });
});

describe('verifyGithubSignature', () => {
  const SECRET = 'hook-secret';
  const body = '{"zen":"Keep it logically awesome."}';
  const sign = (text: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(text).digest('hex')}`;

  it('accepts GitHub\'s sha256= HMAC of the raw body', () => {
    expect(verifyGithubSignature(body, sign(body), SECRET)).toEqual({ ok: true });
  });

  it('refuses a signature made with another secret, a missing header, and a deployment with no secret', () => {
    expect(verifyGithubSignature(body, sign(body, 'other'), SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyGithubSignature(`${body} `, sign(body), SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyGithubSignature(body, null, SECRET)).toEqual({ ok: false, reason: 'missing_signature' });
    expect(verifyGithubSignature(body, sign(body), undefined)).toEqual({ ok: false, reason: 'missing_secret' });
  });
});

describe('eventsFromWebhook', () => {
  const repository = { full_name: REPO };

  it('maps pull_request actions to the lifecycle events with the connector\'s dedupe keys', () => {
    const opened = eventsFromWebhook('pull_request', { action: 'opened', pull_request: pr(), repository }, 'main');
    const synced = eventsFromWebhook('pull_request', { action: 'synchronize', pull_request: pr({ head: { ref: 'factory/task-042', sha: 'def456' } }), repository }, 'main');
    const merged = eventsFromWebhook('pull_request', { action: 'closed', pull_request: pr({ state: 'closed', merged_at: '2026-09-19T16:00:00Z', merge_commit_sha: 'merge999' }), repository }, 'main');
    const closed = eventsFromWebhook('pull_request', { action: 'closed', pull_request: pr({ state: 'closed', closed_at: '2026-09-19T16:00:00Z' }), repository }, 'main');

    expect(opened?.repo).toBe(REPO);
    expect(opened?.events.map(e => e.type)).toEqual([PR_OPENED]);
    // The same key the poller would build, so whichever path arrives second dedupes.
    expect(opened?.events[0]!.dedupeKey).toBe(prDedupeKey(REPO, 3, PR_OPENED, 'abc123'));
    expect(synced?.events.map(e => [e.type, e.payload.headSha])).toEqual([[PR_SYNCHRONIZED, 'def456']]);
    expect(merged?.events.map(e => [e.type, e.payload.mergeSha])).toEqual([[PR_MERGED, 'merge999']]);
    expect(closed?.events.map(e => e.type)).toEqual([PR_CLOSED]);
  });

  it('maps a submitted review, whose state GitHub spells lowercase on the webhook', () => {
    const out = eventsFromWebhook('pull_request_review', {
      action: 'submitted',
      review: { id: 11, state: 'approved', user: { login: 'chris' }, submitted_at: '2026-09-19T13:00:00Z', commit_id: 'abc123', html_url: 'u' },
      pull_request: pr(),
      repository,
    }, 'main');

    expect(out?.events.map(e => [e.type, e.payload.reviewState])).toEqual([[PR_REVIEW_SUBMITTED, 'approved']]);
  });

  it('names the pull requests a completed check suite touched, for the receiver to hydrate', () => {
    const out = eventsFromWebhook('check_suite', {
      action: 'completed',
      check_suite: { head_sha: 'abc123', conclusion: 'failure', pull_requests: [{ number: 3, head: { ref: 'factory/task-042', sha: 'abc123' } }] },
      repository,
    }, 'main');

    expect(out?.events).toEqual([]);
    expect(out?.checkSuiteFor).toEqual([{ number: 3, headSha: 'abc123', branch: 'factory/task-042' }]);
  });

  it('maps a failed workflow run on the deploy branch and ignores one on another branch', () => {
    const run = { id: 1, name: 'Deploy', head_branch: 'main', head_sha: 'x', run_number: 1, run_attempt: 1, event: 'push', status: 'completed', conclusion: 'failure', html_url: 'u', updated_at: '2026-09-19T17:00:00Z' };

    expect(eventsFromWebhook('workflow_run', { action: 'completed', workflow_run: run, repository }, 'main')?.events.map(e => e.type)).toEqual([RUN_FAILED]);
    expect(eventsFromWebhook('workflow_run', { action: 'completed', workflow_run: { ...run, head_branch: 'factory/x' }, repository }, 'main')?.events).toEqual([]);
    expect(eventsFromWebhook('workflow_run', { action: 'completed', workflow_run: run, repository }, 'release')?.events).toEqual([]);
  });

  it('maps unmodelled deliveries to nothing, and a delivery with no repository to null', () => {
    expect(eventsFromWebhook('issue_comment', { action: 'created', repository }, 'main')?.events).toEqual([]);
    expect(eventsFromWebhook('pull_request', { action: 'labeled', pull_request: pr(), repository }, 'main')?.events).toEqual([]);
    expect(eventsFromWebhook('ping', { zen: 'x' }, 'main')).toBeNull();
  });
});
