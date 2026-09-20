import type { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * Approve each send, then enroll — the walk, end to end through the running
 * app, against a real four-send enrollment in the review queue.
 *
 * Four sends because that is the case this exists for: the screen used to
 * approve all four in one click, with no way to say "I have read send 3" and
 * nothing recording that it was read.
 *
 * What the unit and browser tests cannot show, and this does: that the record
 * written by the route is the record on the row, read back through the app's
 * own database client rather than through the API's report of itself; that a
 * reload keeps the checks; and that approving every send never reaches
 * HubSpot, because the run is still pending afterwards.
 *
 * Self-seeding like the rest of the `queue` project: the sign-up route is
 * invite-only, so the spec creates its own admin the way an operator would.
 *
 * Running it:
 *
 *   npx playwright test --project=queue approve-each-send
 *
 * Against a server already running on another port:
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3010 npx playwright test --project=queue approve-each-send
 */

const ADMIN = {
  name: 'Queue Admin',
  account: 'Queue E2E Co',
  email: 'queue-admin@example.test',
  password: 'queue-admin-1',
};

const SEED = 'e2e/queue/support/seed-sequence-review.ts';

/** Send 3's body as seeded, which is the copy the regenerate ask is about. */
const SEND_3_BODY = 'Rowan, one more note. Apologies for the nudge. If the automation side is already sorted, no worries at all.';

type Record_ = {
  status: string | null;
  sends: Array<{ step: number; subject?: string; body: string }>;
  revisions: Array<{ contentId?: string; version: number; kind?: string; body: string; ask?: string }>;
  contentReview: Record<string, { hash: string; at: string; by?: string }>;
};

/**
 * Run a support script the way the rest of the E2E tree does: outside the
 * Next process, through `dotenv -c` so it reads the same `.env.local` the app
 * under test reads and therefore reaches the same database.
 * @param args - Arguments after the script path.
 */
function seed(args: string[]): string {
  try {
    return execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split('\n').at(-1) ?? '';
  } catch (error) {
    const err = error as { stderr?: Buffer | string };
    throw new Error(`${SEED} failed: ${String(err.stderr ?? '').trim().split('\n').at(-1) ?? error}`);
  }
}

/**
 * The run's record columns, straight off the row.
 * @param runId
 */
function recordOf(runId: number): Record_ {
  return JSON.parse(seed(['--read', String(runId)])) as Record_;
}

/** The account, its project and the admin — the same command an operator runs on a real box. */
function createBootstrapAdmin(): void {
  try {
    execFileSync(
      'npm',
      ['run', '--silent', 'user:create', '--', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.password, '--role', 'admin'],
      { stdio: 'pipe' },
    );
  } catch (error) {
    // "Already exists" is the normal case on a database that already has the
    // admin; the sign-in below still works.
    const text = String((error as { stderr?: Buffer }).stderr ?? '');
    if (!/already|exists/i.test(text)) {
      throw new Error(`user:create failed: ${text.trim().split('\n').at(-1) ?? error}`);
    }
  }
}

test('a four-send sequence is walked send by send, and only Enroll reaches HubSpot', async ({ page }) => {
  createBootstrapAdmin();
  const { runId } = JSON.parse(seed(['--email', ADMIN.email])) as { runId: number };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto(`/dashboard/inbox/proposal-${runId}`);

  // ── The walk starts empty, and Enroll is held ────────────────────────────
  await expect(page.getByTestId('walk-count')).toHaveText('0 of 4 approved');
  await expect(page.getByTestId('decide-approve')).toBeDisabled();
  // The reason rides the button, not a banner: the count over the tab row
  // already says how far through the walk you are.
  await expect(page.locator('#bar-hint-decide-approve')).toContainText('0 of 4');
  await expect(page.getByTestId('primary-held')).toHaveCount(0);
  // One-word action buttons throughout.
  await expect(page.getByTestId('decide-approve')).toHaveText(/^Enroll/);
  await expect(page.getByTestId('approve-send-1')).toHaveText('Approve');

  await page.screenshot({ path: 'vitest-test-results/walk-1440-held.png', fullPage: false });

  // ── The split pane: copy and the instruction box, at once ────────────────
  const copy = await page.getByTestId('email-pane-send-1').boundingBox();
  const ask = await page.getByTestId('regenerate-send-1-open').boundingBox();

  expect(copy).not.toBeNull();
  expect(ask).not.toBeNull();
  // Side by side at 1440, not stacked: the old layout pushed the copy off
  // screen exactly when a reviewer needed to read it while writing the ask.
  expect(ask!.x).toBeGreaterThanOrEqual(copy!.x + copy!.width - 1);

  // ── Approve send 1: the tab checks, the count rises, the screen advances ─
  await page.getByTestId('approve-send-1').click();

  await expect(page.getByTestId('tab-check-send-1')).toBeVisible();
  await expect(page.getByTestId('walk-count')).toHaveText('1 of 4 approved');
  await expect(page.getByTestId('item-pane-send-2')).toBeVisible();

  // The record, on the row: the approved copy, and the check it is drawn from.
  const afterOne = recordOf(runId);
  const approved1 = afterOne.revisions.find(r => r.contentId === 'send-1' && r.kind === 'approved');

  expect(approved1?.body).toBe(afterOne.sends[0]!.body);
  expect(afterOne.contentReview['send-1']).toBeTruthy();
  // A checkpoint, not an execution.
  expect(afterOne.status).toBe('pending');

  // ── A check is not a promise: editing send 1 clears it, with no reload ───
  await page.getByTestId('tab-item-send-1').click();
  const body1 = page.getByTestId('email-pane-send-1').locator('textarea').first();
  await body1.fill('Rewritten after approving it.');

  await expect(page.getByTestId('tab-item-send-1')).not.toHaveAttribute('data-approved', 'true');
  await expect(page.getByTestId('walk-count')).toHaveText('0 of 4 approved');
  await expect(page.getByTestId('decide-approve')).toBeDisabled();

  // Approving it again records the edited copy, which is what a reviewer
  // vouched for — not what the agent wrote.
  await page.getByTestId('approve-send-1').click();

  await expect(page.getByTestId('walk-count')).toHaveText('1 of 4 approved');
  expect(recordOf(runId).revisions.filter(r => r.contentId === 'send-1' && r.kind === 'approved').at(-1)?.body)
    .toBe('Rewritten after approving it.');

  // ── A reload keeps the check and the edited copy together ────────────────
  await page.reload();

  await expect(page.getByTestId('walk-count')).toHaveText('1 of 4 approved');
  await expect(page.getByTestId('tab-check-send-1')).toBeVisible();

  await page.getByTestId('tab-item-send-1').click();

  await expect(page.getByTestId('email-pane-send-1').locator('textarea').first()).toHaveValue('Rewritten after approving it.');

  // ── The rest of the walk ─────────────────────────────────────────────────
  for (const id of ['send-2', 'send-3', 'send-4']) {
    await page.getByTestId(`tab-item-${id}`).click();
    await page.getByTestId(`approve-${id}`).click();

    await expect(page.getByTestId(`tab-item-${id}`)).toHaveAttribute('data-approved', 'true');
  }

  await expect(page.getByTestId('walk-count')).toHaveText('4 of 4 approved');
  // The hold releases only here.
  await expect(page.getByTestId('decide-approve')).toBeEnabled();
  await expect(page.getByTestId('primary-held')).toHaveCount(0);

  await page.screenshot({ path: 'vitest-test-results/walk-1440-complete.png', fullPage: false });

  // ── Approving every send sent nothing ────────────────────────────────────
  const walked = recordOf(runId);

  expect(walked.status).toBe('pending');
  expect(Object.keys(walked.contentReview).sort()).toEqual(['send-1', 'send-2', 'send-3', 'send-4']);

  // Every send carries the copy that was vouched for.
  for (const [i, send] of walked.sends.entries()) {
    const approved = walked.revisions.filter(r => r.contentId === `send-${i + 1}` && r.kind === 'approved').at(-1);

    expect(approved?.body).toBe(i === 0 ? 'Rewritten after approving it.' : send.body);
  }
});

test('a regenerate keeps the copy it is about to replace, and the ask with it', async ({ page }) => {
  createBootstrapAdmin();
  const { runId } = JSON.parse(seed(['--email', ADMIN.email])) as { runId: number };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto(`/dashboard/inbox/proposal-${runId}`);
  await page.getByTestId('tab-item-send-3').click();

  // The ask is typed beside the copy it is about — no disclosure to open.
  await page.getByLabel(/Regenerate instruction/).fill('Shorter, and drop the apology.');
  await page.screenshot({ path: 'vitest-test-results/walk-1440-split.png', fullPage: false });
  await page.getByTestId('regenerate-send-3').click();

  // The card holds its place, disabled, with the instruction on screen.
  await expect(page.getByTestId('regenerating-banner')).toBeVisible();

  // The record, before anything replaced the copy: send 3's proposed body,
  // keyed to send-3, with the ask it answers. This is the moment the old
  // code lost it — the redraft's dedup refresh replaces `input` wholesale.
  await expect.poll(() => recordOf(runId).revisions.filter(r => r.contentId === 'send-3').length).toBeGreaterThan(0);

  const filed = recordOf(runId).revisions.find(r => r.contentId === 'send-3')!;

  expect(filed.kind).toBe('proposed');
  expect(filed.body).toBe(SEND_3_BODY);
  expect(filed.ask).toBe('Shorter, and drop the apology.');
  expect(filed.version).toBe(1);
  // Nothing was filed against the sends the ask was not about.
  expect(recordOf(runId).revisions.filter(r => r.contentId !== 'send-3')).toHaveLength(0);
});

test('the split stacks rather than cramming when the pane is squeezed', async ({ page }) => {
  createBootstrapAdmin();
  const { runId } = JSON.parse(seed(['--email', ADMIN.email])) as { runId: number };

  // The width the pane gets beside an open conversation. The breakpoint is a
  // container query, so this is the case it exists for.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto(`/dashboard/inbox/proposal-${runId}`);

  const copy = await page.getByTestId('email-pane-send-1').boundingBox();
  const ask = await page.getByTestId('regenerate-send-1-open').boundingBox();

  // Both laid out, and the copy still read first.
  expect(copy!.width).toBeGreaterThan(0);
  expect(ask!.width).toBeGreaterThan(0);
  expect(ask!.y).toBeGreaterThan(copy!.y);

  await page.screenshot({ path: 'vitest-test-results/walk-900-stacked.png', fullPage: false });

  // The walk is still the walk at this width.
  await expect(page.getByTestId('walk-count')).toHaveText('0 of 4 approved');
  await expect(page.getByTestId('decide-approve')).toBeDisabled();
});

test('on a phone the decision bar is one row, not half the screen', async ({ page }) => {
  createBootstrapAdmin();
  const { runId } = JSON.parse(seed(['--email', ADMIN.email])) as { runId: number };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto(`/dashboard/inbox/proposal-${runId}`);

  await expect(page.getByTestId('walk-count')).toBeVisible();

  // The defect: three full-width verbs and the note toggle stacked down the
  // phone, so the bar took half the viewport on the one surface whose job is
  // reading what sits underneath it.
  const bar = (await page.getByTestId('sticky-action-bar').boundingBox())!;

  expect(bar.height).toBeLessThan(844 * 0.2);

  // Side by side, on one row: same top, in reading order left to right.
  const approve = (await page.getByTestId('decide-approve').boundingBox())!;
  const decline = (await page.getByTestId('decide-reject').boundingBox())!;
  const snooze = (await page.getByTestId('decide-snooze').boundingBox())!;

  expect(Math.round(decline.y)).toBe(Math.round(approve.y));
  expect(Math.round(snooze.y)).toBe(Math.round(approve.y));
  expect(decline.x).toBeLessThan(snooze.x);
  expect(snooze.x).toBeLessThan(approve.x);

  // The words went to the screen reader, not away: every verb is still
  // reachable by its name, and the primary keeps its word on screen.
  for (const name of ['Enroll', 'Decline', 'Snooze']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1);
  }

  await expect(page.getByTestId('decide-approve')).toHaveText(/Enroll/);
});
