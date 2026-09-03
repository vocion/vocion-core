import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * objects.propose_candidate end to end — the path an ingestion agent and an
 * admin panel actually walk, through the running app rather than in isolation:
 *
 *   propose → PENDING queue item + a `candidate` business object
 *   propose the same thing again → the SAME item and the SAME object, refreshed
 *   propose a second record off the same source → a second item
 *   fetch the detail → the card, labelled from the workspace's object type
 *   approve with the published record's id → object approved AND linked
 *   list the objects → the panel can page them, filtered, counted server-side
 *
 * Self-seeding, like the `tour` project: the sign-up route is invite-only, so
 * the bootstrap admin is created straight in the database. The object type is
 * created over the API the same way a workspace apply would.
 *
 * No model key and no agent runtime: proposing is an HTTP call and approval
 * writes nothing outside, so nothing here needs an LLM.
 *
 * Running it:
 *
 *   npx playwright test --project=queue
 *
 * If the checkout serves the app on its own hostname (AUTH_URL in .env.local
 * pointing at something other than localhost, which worktrees do so their
 * session cookies stay apart), name that host or every sign-in fails the host
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

/**
 * The object type a workspace applies. Every domain word in this spec lives
 * here — the action under test never sees one.
 */
const OBJECT_TYPE = {
  slug: 'event_candidate',
  label: 'Event candidate',
  schema: {
    type: 'object',
    required: ['title', 'start'],
    // jsonb does not keep key order, so the card order is stated explicitly.
    propertyOrder: ['title', 'start', 'venue'],
    properties: {
      title: { type: 'string', title: 'Event' },
      start: { type: 'string', title: 'Starts' },
      venue: { type: 'string', title: 'Venue' },
    },
  },
};

const LISTING_URL = 'https://listings.example.org/burlington/events';

/**
 * Every title this run creates carries this tag, and every count is filtered
 * by it. A local database keeps earlier runs' rows, and the spec has to mean
 * the same thing on the first run and the tenth.
 */
const RUN_TAG = `run-${Date.now().toString(36)}`;
const OPEN_MIC_TITLE = `Open Mic Night ${RUN_TAG}`;
const POETRY_TITLE = `Poetry Slam ${RUN_TAG}`;
/**
 * Stands in for the id the panel's own store returns. Unique per run: one
 * business object per external record is a unique index, so reusing a literal
 * id across runs is a genuine conflict, not a test artefact.
 */
const PUBLISHED_RECORD_ID = `strapi-${RUN_TAG}`;

function openMic(over: Record<string, unknown> = {}) {
  return {
    objectType: OBJECT_TYPE.slug,
    title: OPEN_MIC_TITLE,
    fields: { title: OPEN_MIC_TITLE, start: '2026-09-12T19:30', venue: 'The Flynn' },
    dedupOn: ['title', 'start', 'venue'],
    sourceUrl: 'https://listings.example.org/burlington/events/open-mic-night',
    sourceListingUrl: LISTING_URL,
    summary: 'Sign-ups at 7, music at 7:30.',
    ...over,
  };
}

/**
 * Creates the account, its default project and the admin user directly in the
 * database — the same command an operator runs on a real box. Re-running the
 * spec against a database that already has the user is fine: the script exits
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
      // it reads the same .env.local the app under test reads. Naming a
      // database here would seed the admin into one database while the server
      // signs in against another.
      { stdio: 'pipe' },
    );
  } catch (error) {
    // Expected on a local database that already has the admin — the script
    // exits non-zero rather than overwriting. Any other cause shows up as the
    // sign-in failing below, with this line naming it. Only the message is
    // logged: the stack is child-process plumbing, not information.
    console.warn(`[queue spec] user:create made no user: ${error instanceof Error ? error.message : String(error)}`);
  }
}

test('one record, one review item: propose, re-propose, decide, and link what the panel published', async ({ page, baseURL }) => {
  createBootstrapAdmin();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  // These calls ride the signed-in session cookie; a panel would send a tenant
  // Bearer token to the same routes.
  const api = page.request;

  // ── The workspace's object type ─────────────────────────────────────────
  const typeResponse = await api.post('/api/v1/objects/types', { data: OBJECT_TYPE });

  // Already applied by an earlier run is fine; anything else is not.
  expect([200, 201, 409]).toContain(typeResponse.status());

  // ── Propose ─────────────────────────────────────────────────────────────
  const first = await api.post('/api/v1/reviews/propose', {
    data: {
      actionId: 'objects.propose_candidate',
      input: openMic(),
      agentSlug: 'ingestion-lead',
      confidence: 0.86,
      rationale: 'Per-record page with a clean date line.',
    },
  });

  expect(first.ok(), `propose failed: ${await first.text()}`).toBeTruthy();

  const firstBody = await first.json();

  // Pending, never executed: external, and on the never-auto list.
  expect(firstBody.status).toBe('pending');

  // The candidate is a real record from this moment, tied to nothing outside.
  const afterPropose = await api.get(`/api/v1/objects?type=${OBJECT_TYPE.slug}&status=candidate&search=${RUN_TAG}`);

  expect(afterPropose.ok()).toBeTruthy();

  const proposedPage = await afterPropose.json();

  expect(proposedPage.total).toBe(1);
  expect(proposedPage.items[0]).toMatchObject({
    title: OPEN_MIC_TITLE,
    status: 'candidate',
    externalId: null,
    reviewActionRunId: firstBody.runId,
  });

  // ── Propose the same record again ───────────────────────────────────────
  const repeat = await api.post('/api/v1/reviews/propose', {
    data: {
      actionId: 'objects.propose_candidate',
      input: openMic({ summary: 'Sign-ups at 7, music at 7:30. Free.' }),
      agentSlug: 'ingestion-lead',
      confidence: 0.91,
    },
  });

  expect(repeat.ok()).toBeTruthy();
  expect((await repeat.json()).runId).toBe(firstBody.runId);

  // One item AND one object — a second walk of the source forks neither.
  const afterRepeat = await api.get(`/api/v1/objects?type=${OBJECT_TYPE.slug}&status=candidate&search=${RUN_TAG}`);

  expect((await afterRepeat.json()).total).toBe(1);

  // ── A second record off the SAME source is a second item ────────────────
  const poetry = await api.post('/api/v1/reviews/propose', {
    data: {
      actionId: 'objects.propose_candidate',
      input: openMic({
        title: POETRY_TITLE,
        fields: { title: POETRY_TITLE, start: '2026-09-12T19:30', venue: 'The Flynn' },
        sourceUrl: 'https://listings.example.org/burlington/events/poetry-slam',
      }),
      agentSlug: 'ingestion-lead',
      confidence: 0.72,
    },
  });

  expect(poetry.ok()).toBeTruthy();

  const poetryRunId = (await poetry.json()).runId;

  expect(poetryRunId).not.toBe(firstBody.runId);

  const queue = await api.get('/api/v1/reviews?kind=action&limit=50');
  const queued = (await queue.json()).items as Array<{ kind: string; id: number; title: string }>;
  const queuedIds = queued.map(item => item.id);

  // Two candidates off one listing: two items, never one digest. Checked by
  // containment because a local database keeps earlier runs' items around.
  expect(queuedIds).toContain(firstBody.runId);
  expect(queuedIds).toContain(poetryRunId);

  // ── The card, labelled by the workspace, not by core ─────────────────────
  const detail = await api.get(`/api/v1/reviews/action/${firstBody.runId}`);

  expect(detail.ok()).toBeTruthy();

  const { card, proposal } = await detail.json();
  const labels = (card.fields as Array<{ label: string; value: string }>).map(field => field.label);

  expect(card.title).toBe(OPEN_MIC_TITLE);
  expect(card.system).toBe('Event candidate');
  expect(labels.slice(0, 3)).toEqual(['Event', 'Starts', 'Venue']);
  // The re-propose refreshed the stored payload and the confidence.
  expect(card.summary).toMatch(/Free\.$/);
  expect(proposal.confidence).toBeCloseTo(0.91);

  // ── The moderator's own surface ─────────────────────────────────────────
  await page.goto(`${baseURL}/dashboard/review`);

  await expect(page.getByTestId('review-focus')).toBeVisible();
  await expect(page.getByText(OPEN_MIC_TITLE).first()).toBeVisible();

  // ── Approve, naming the record the panel just published ─────────────────
  const decided = await api.post('/api/v1/reviews/decide', {
    data: {
      kind: 'action',
      id: firstBody.runId,
      action: 'approve',
      externalRef: { system: 'strapi', id: PUBLISHED_RECORD_ID },
    },
  });

  expect(decided.ok(), `decide failed: ${await decided.text()}`).toBeTruthy();

  const approved = await api.get(`/api/v1/objects?type=${OBJECT_TYPE.slug}&status=approved&search=${RUN_TAG}`);
  const approvedPage = await approved.json();

  expect(approvedPage.total).toBe(1);
  expect(approvedPage.items[0]).toMatchObject({
    title: OPEN_MIC_TITLE,
    status: 'approved',
    externalSystem: 'strapi',
    externalId: PUBLISHED_RECORD_ID,
  });

  // The unpublished-work filter the panel pages on: approved but unlinked.
  const unlinked = await api.get(`/api/v1/objects?status=approved&linked=false&search=${RUN_TAG}`);

  expect((await unlinked.json()).total).toBe(0);
});
