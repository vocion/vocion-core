import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * Snoozing is measurable — the path from the review card's Snooze button to a
 * number on the adoption screen, through the running app:
 *
 *   propose an action                    → it is the focused review item
 *   snooze it from the card ("Tomorrow") → it leaves the queue, still pending
 *   open /dashboard/adoption             → the reviewer's row counts one more
 *                                          snooze, and the same Approvals as
 *                                          before: a deferral is not a decision
 *   open the reviewer's detail panel     → the Snoozes stat agrees, and the
 *                                          deferral is named on the timeline
 *
 * Counts are asserted as deltas, never absolutes. A local PGlite database
 * keeps earlier runs' events, and this spec has to mean the same thing on the
 * first run and the tenth.
 *
 * The proposed item is the focused one because the review queue orders actions
 * newest-first, and this one is seconds old.
 *
 * Per-AGENT snooze counts are not asserted here, and cannot be: a proposal
 * made over a dashboard session is stamped with the signed-in user as its
 * `invokedBy`, so attribution honestly resolves to no agent. The
 * agent-attributed path is covered where it can be driven directly —
 * `services/adoption/attribution.test.ts` and
 * `services/ReviewService.assignment.test.ts`.
 *
 * Self-seeding like the rest of the `queue` project: the sign-up route is
 * invite-only, so the bootstrap admin is created straight in the database.
 * Admin matters twice here — the adoption screen and every
 * `router.adoption.*` procedure are admin-only.
 *
 * Running it:
 *
 *   npx playwright test --project=queue review-snooze-adoption
 *
 * If the checkout serves the app on its own hostname (a worktree does, so its
 * session cookie stays apart), name that host or the sign-in fails the host
 * check:
 *
 *   PLAYWRIGHT_BASE_URL=http://<host>:<port> npx playwright test --project=queue
 */

const ADMIN = {
  name: 'Mo Delgado',
  account: 'Veerio Events',
  email: 'mo@veerio.example',
  password: 'events-queue-1',
};

/** The agent named on the proposal, as an ingestion agent would name itself. */
const AGENT_SLUG = 'ingestion-lead';

/**
 * The object type a workspace applies. The proposed item needs one to exist,
 * the same as it would in a real workspace; nothing here is under test.
 */
const OBJECT_TYPE = {
  slug: 'event_candidate',
  label: 'Event candidate',
  schema: {
    type: 'object',
    required: ['title', 'start'],
    propertyOrder: ['title', 'start', 'venue'],
    properties: {
      title: { type: 'string', title: 'Event' },
      start: { type: 'string', title: 'Starts' },
      venue: { type: 'string', title: 'Venue' },
    },
  },
};

/** Zero-based cells in the Members table: member, last active, logins, sessions, messages, approvals, snoozes. */
const MEMBER_APPROVALS_CELL = 5;
const MEMBER_SNOOZES_CELL = 6;

/** The Snoozes stat card's definition tooltip on the user detail panel. */
const SNOOZE_STAT_DEFINITION = 'Queued items this person deferred instead of deciding on';

const RUN_TAG = `snooze-${Date.now().toString(36)}`;
const ITEM_TITLE = `Deferred Listing ${RUN_TAG}`;

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
      // No DATABASE_URL of our own: the script wraps itself in `dotenv -c`, so
      // it reads the same .env.local the app under test reads.
      { stdio: 'pipe' },
    );
  } catch (error) {
    // Expected on a local database that already has the admin — the script
    // exits non-zero rather than overwriting. Any other cause shows up as the
    // sign-in failing below, with this line naming it.
    console.warn(`[snooze spec] user:create made no user: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Whole number in a table cell, with the empty and em-dash renderings read as
 * zero so a first run on a fresh database is not a parse failure.
 * @param text - The cell's rendered text.
 */
function cellNumber(text: string | null): number {
  const trimmed = (text ?? '').trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
}

test('a snooze taken from the review card shows up as a snooze on the adoption screen', async ({ page, baseURL }) => {
  createBootstrapAdmin();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  // This call rides the signed-in session cookie; a panel would send a tenant
  // Bearer token to the same route.
  const api = page.request;

  /**
   * The signed-in reviewer's own Approvals and Snoozes as the Members table
   * renders them, for the default 30-day window.
   */
  async function readMemberCells(): Promise<{ approvals: number; snoozes: number }> {
    await page.goto(`${baseURL}/dashboard/adoption`);
    // The table is client-fetched: wait for the row, not the skeleton.
    const row = page.getByRole('row').filter({ hasText: ADMIN.name }).first();

    await expect(row).toBeVisible();

    const cells = row.getByRole('cell');

    return {
      approvals: cellNumber(await cells.nth(MEMBER_APPROVALS_CELL).textContent()),
      snoozes: cellNumber(await cells.nth(MEMBER_SNOOZES_CELL).textContent()),
    };
  }

  const before = await readMemberCells();

  // ── The workspace's object type ──────────────────────────────────────────
  const typeResponse = await api.post('/api/v1/objects/types', { data: OBJECT_TYPE });

  // Already applied by an earlier run is fine; anything else is not.
  expect([200, 201, 409]).toContain(typeResponse.status());

  // ── Something worth deferring lands in the queue ─────────────────────────
  const proposed = await api.post('/api/v1/reviews/propose', {
    data: {
      actionId: 'objects.propose_candidate',
      input: {
        objectType: 'event_candidate',
        title: ITEM_TITLE,
        fields: { title: ITEM_TITLE, start: '2026-11-04T18:00', venue: 'The Flynn' },
        dedupOn: ['title', 'start', 'venue'],
        sourceUrl: `https://listings.example.org/burlington/events/${RUN_TAG}`,
        summary: 'Worth a look, but not today.',
      },
      agentSlug: AGENT_SLUG,
      confidence: 0.64,
      rationale: 'Date line is clean but the venue is a guess.',
    },
  });

  expect(proposed.ok(), `propose failed: ${await proposed.text()}`).toBeTruthy();

  const { runId, status } = await proposed.json();

  expect(status).toBe('pending');

  // ── Snooze it from the card, the way a reviewer does ─────────────────────
  await page.goto(`${baseURL}/dashboard/review`);
  const focus = page.getByTestId('review-focus');

  await expect(focus.getByText(ITEM_TITLE).first()).toBeVisible();

  await focus.getByRole('button', { name: 'Snooze', exact: true }).click();
  await focus.getByRole('button', { name: 'Tomorrow' }).click();

  // Deferred, not decided: it drops out of the active queue but stays pending.
  // Asserted against the queue itself rather than the DOM — the focus view is
  // free to keep the card on screen until the reviewer moves on.
  await expect(async () => {
    const queue = await api.get('/api/v1/reviews?kind=action&limit=50');
    const queued = (await queue.json()).items as Array<{ id: number }>;

    expect(queued.map(item => item.id)).not.toContain(runId);
  }).toPass();

  const stillQueued = await api.get(`/api/v1/reviews/action/${runId}`);

  expect(stillQueued.ok(), `review detail failed: ${await stillQueued.text()}`).toBeTruthy();
  expect((await stillQueued.json()).status).toBe('pending');

  // ── The number the reviewer's manager reads ──────────────────────────────
  const after = await readMemberCells();

  expect(after.snoozes).toBe(before.snoozes + 1);
  // A deferral is not a decision — the Approvals count must not have moved.
  expect(after.approvals).toBe(before.approvals);

  // ── And the person's own panel agrees with their row ─────────────────────
  await page.getByRole('link', { name: ADMIN.name }).first().click();
  await page.waitForURL(/\/dashboard\/adoption\/users\//);

  // Located by the stat's own definition tooltip — the whole card, so the
  // assertion reads the number and not just the label under it.
  const snoozeStat = page.getByTitle(SNOOZE_STAT_DEFINITION);

  await expect(snoozeStat).toContainText(String(after.snoozes));
  // The timeline names the deferral in the reviewer's own words.
  await expect(page.getByText('Snoozed a review').first()).toBeVisible();
});
