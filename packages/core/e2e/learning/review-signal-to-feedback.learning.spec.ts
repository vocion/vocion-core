import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * A reviewer's reaction to an agent's proposed action, walked through the
 * running app: propose an action, react to it, and check what reached the
 * feedback queue the classifier drains.
 *
 *   reject with a reason        → one queued job carrying the reason
 *   reject the same item again  → still one job (idempotent on run + signal)
 *   approve with a note         → a job marked as reinforcement
 *   approve with no note        → nothing queued
 *
 * No model key and no worker: this covers the ingestion half only. What the
 * classifier then does with the text — and the duplicate check — is unit-tested
 * against a stubbed model, because a spec that called a real one would spend
 * money and flake.
 *
 * Running it:
 *
 *   npx playwright test --project=learning
 *
 * If the checkout serves the app on its own hostname (AUTH_URL in .env.local
 * pointing at something other than localhost, which worktrees do so their
 * session cookies stay apart), name that host or the sign-in fails the host
 * check:
 *
 *   PLAYWRIGHT_BASE_URL=http://<host>:<port> npx playwright test --project=learning
 */

const ADMIN = {
  name: 'Ines Okafor',
  account: 'Veerio Learning',
  email: 'ines@veerio.example',
  password: 'learning-loop-1',
};

/**
 * Tags this run's rows so a re-run against the same database stays readable —
 * and, more importantly, keeps them apart. `proposeAction` derives a dedup key
 * from the action plus its recipient, so re-proposing to the same address
 * refreshes the existing pending item instead of creating a new one, and the
 * signals would then land on a run an earlier run already reacted to.
 */
const RUN_TAG = `run-${Date.now()}`;

/**
 * Creates the account, its default project and the admin user directly in the
 * database — the same command an operator runs on a real box. Re-running
 * against a database that already has the user is fine: the script exits
 * non-zero saying so, and the sign-in below still works.
 */
function createBootstrapAdmin(): void {
  try {
    execFileSync(
      'npm',
      [
        'run',
        'user:create',
        '--silent',
        '--',
        '--email',
        ADMIN.email,
        '--name',
        ADMIN.name,
        '--account',
        ADMIN.account,
        '--password',
        ADMIN.password,
        '--role',
        'admin',
      ],
      { stdio: 'pipe' },
    );
  } catch (error) {
    console.warn(`[learning spec] user:create made no user: ${error instanceof Error ? error.message : String(error)}`);
  }
}

test('a reviewer\'s reason reaches the feedback queue, and a bare click does not', async ({ page }) => {
  createBootstrapAdmin();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  const api = page.request;

  // ── An agent proposes something a person has to judge ────────────────────
  const proposed = await api.post('/api/v1/reviews/propose', {
    data: {
      actionId: 'gmail.send',
      input: { to: `buyer+${RUN_TAG}@example.com`, subject: RUN_TAG, body: 'Checking in before the demo.' },
      agentSlug: 'sales-assistant',
      confidence: 0.71,
      rationale: 'Deal has been quiet for nine days.',
    },
  });

  expect(proposed.ok(), `propose failed: ${await proposed.text()}`).toBeTruthy();

  const runId = (await proposed.json()).runId as number;

  // ── Reject it, and say why ───────────────────────────────────────────────
  const rejection = await api.post('/api/v1/reviews/signal', {
    data: { id: runId, signal: 'reject', hint: `we never email a buyer before the demo (${RUN_TAG})` },
  });

  expect(rejection.ok(), `signal failed: ${await rejection.text()}`).toBeTruthy();

  const afterRejection = await listReviewJobs();
  const rejectionJob = afterRejection.find(job => job.externalId === `action_run:${runId}:reject`);

  expect(rejectionJob, 'the rejection reason was not queued for the classifier').toBeTruthy();
  expect(rejectionJob?.status).toBe('queued');
  expect(rejectionJob?.payload.text).toContain(RUN_TAG);
  expect(rejectionJob?.payload.agentSlug).toBe('sales-assistant');
  expect(rejectionJob?.payload.sourceRunId).toBe(runId);
  expect(rejectionJob?.payload.polarityHint).toBe('correct');

  // ── Re-deciding the same item queues nothing new ─────────────────────────
  await api.post('/api/v1/reviews/signal', {
    data: { id: runId, signal: 'reject', hint: 'saying it twice' },
  });

  const afterSecondRejection = await listReviewJobs();

  expect(afterSecondRejection.filter(job => job.externalId === `action_run:${runId}:reject`)).toHaveLength(1);

  // ── Praise with a reason is queued too, as reinforcement ─────────────────
  await api.post('/api/v1/reviews/signal', {
    data: { id: runId, signal: 'approve', hint: `leading with the number was right (${RUN_TAG})` },
  });

  const afterApproval = await listReviewJobs();
  const approvalJob = afterApproval.find(job => job.externalId === `action_run:${runId}:approve`);

  expect(approvalJob, 'the approval note was not queued for the classifier').toBeTruthy();
  expect(approvalJob?.payload.polarityHint).toBe('reinforce');

  // ── A bare click is measured, but proposes no rule ───────────────────────
  const second = await api.post('/api/v1/reviews/propose', {
    data: {
      actionId: 'gmail.send',
      input: { to: `other+${RUN_TAG}@example.com`, subject: `${RUN_TAG}-bare`, body: 'No note on this one.' },
      agentSlug: 'sales-assistant',
      confidence: 0.6,
      rationale: 'Second draft.',
    },
  });
  const bareRunId = (await second.json()).runId as number;
  await api.post('/api/v1/reviews/signal', { data: { id: bareRunId, signal: 'reject' } });

  const afterBareClick = await listReviewJobs();

  expect(afterBareClick.some(job => job.externalId.startsWith(`action_run:${bareRunId}:`))).toBe(false);

  /** The org's review-sourced feedback jobs, as the worker would see them. */
  async function listReviewJobs(): Promise<Array<{
    externalId: string;
    status: string;
    payload: { text?: string; agentSlug?: string; sourceRunId?: number; polarityHint?: string };
  }>> {
    const res = await api.get('/api/v1/feedback?source=review&limit=50');

    expect(res.ok(), `listing feedback jobs failed: ${await res.text()}`).toBeTruthy();

    const body = await res.json();
    return (body.items ?? body) as Array<{
      externalId: string;
      status: string;
      payload: { text?: string; agentSlug?: string; sourceRunId?: number; polarityHint?: string };
    }>;
  }
});
