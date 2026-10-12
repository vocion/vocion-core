/**
 * A reviewer's field corrections reach the feedback queue, note or no note.
 *
 * Two ways in, both pinned here over real HTTP against the running app:
 *
 * - An approve inside Vocion (`POST /api/v1/reviews/decide`) whose
 *   `editedInput` changed a field queues those corrections, with the record as
 *   the agent proposed it, even when the reviewer typed nothing. An edited
 *   payload that changed nothing a reviewer would call a correction queues
 *   nothing.
 * - An app with its own review screen posts the same corrections to
 *   `POST /api/v1/feedback`, and a malformed list is refused before it queues.
 *
 * What the worker then makes of a correction is a model's call, covered by the
 * unit tests with the model mocked; nothing here calls a model.
 *
 * Self-seeding: run with `npx playwright test --project=learning`.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../../tests/TestUtils';

const ADMIN = {
  name: 'Tove Lindqvist',
  account: 'Larkfield Corrections',
  email: 'tove@larkfield.example',
  password: 'corrections-loop-1',
};

const OBJECT_TYPE = {
  slug: 'gig_listing',
  label: 'Gig listing',
  schema: {
    type: 'object',
    required: ['title', 'start'],
    propertyOrder: ['title', 'start', 'venue', 'categories'],
    properties: {
      title: { type: 'string', title: 'Gig' },
      start: { type: 'string', title: 'Starts' },
      venue: { type: 'string', title: 'Venue' },
      categories: { type: 'array', title: 'Categories', items: { type: 'string' } },
    },
  },
};

/** Every title carries this, so a database with earlier runs' rows means the same thing. */
const RUN_TAG = `run-${Date.now().toString(36)}`;

type FeedbackJob = {
  externalId: string;
  status: string;
  payload: { text?: string; edits?: unknown; quotedText?: string; polarityHint?: string };
};

function createBootstrapAdmin(): void {
  try {
    execFileSync(
      'npm',
      ['run', 'user:create:e2e', '--silent', '--', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.password, '--role', 'admin'],
      { stdio: 'pipe' },
    );
  } catch (error) {
    tolerateExistingUser(error, '[corrections spec]');
  }
}

test.beforeAll(() => {
  createBootstrapAdmin();
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

/**
 * A gig listing as the agent proposed it.
 * @param title - Unique per proposal.
 */
function listing(title: string) {
  return {
    objectType: OBJECT_TYPE.slug,
    title,
    fields: { title, start: '2026-09-12T19:30', venue: 'The Corvina', categories: ['Live Music', 'Jazz Brunch'] },
    dedupOn: ['title', 'start'],
    sourceUrl: `https://listings.example.org/riverton/${encodeURIComponent(title)}`,
  };
}

/**
 * Propose a listing for review and return its run id.
 * @param api - The signed-in request context.
 * @param title - Unique per proposal.
 */
async function propose(api: APIRequestContext, title: string): Promise<number> {
  const res = await api.post('/api/v1/reviews/propose', {
    data: {
      actionId: 'objects.propose_candidate',
      input: listing(title),
      agentSlug: 'listings-agent',
      confidence: 0.8,
      rationale: 'Per-gig page with its own date line.',
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'A public gig with its own date line, and nothing like it is queued.',
    },
  });

  expect(res.ok(), `propose failed: ${await res.text()}`).toBeTruthy();

  return (await res.json()).runId as number;
}

/**
 * Approve a proposal with the reviewer's edited fields and no note.
 * @param api - The signed-in request context.
 * @param runId - The proposal.
 * @param title - The proposal's title.
 * @param fields - Fields the reviewer changed.
 */
async function approveEdited(api: APIRequestContext, runId: number, title: string, fields: Record<string, unknown>): Promise<void> {
  const proposed = listing(title);
  const res = await api.post('/api/v1/reviews/decide', {
    data: { kind: 'action', id: runId, action: 'approve', editedInput: { ...proposed, fields: { ...proposed.fields, ...fields } } },
  });

  expect(res.ok(), `decide failed: ${await res.text()}`).toBeTruthy();
}

/**
 * The org's feedback jobs from one source.
 * @param api - The signed-in request context.
 * @param source - `review` or `api`.
 */
async function feedbackJobs(api: APIRequestContext, source: string): Promise<FeedbackJob[]> {
  const res = await api.get(`/api/v1/feedback?source=${source}&limit=100`);

  expect(res.ok(), `listing feedback jobs failed: ${await res.text()}`).toBeTruthy();

  return (await res.json()).items as FeedbackJob[];
}

test('corrections on an approve queue for learning with no note, and an unchanged edit queues nothing', async ({ page }) => {
  await signIn(page);
  const api = page.request;

  const typeResponse = await api.post('/api/v1/objects/types', { data: OBJECT_TYPE });

  expect([200, 201, 409]).toContain(typeResponse.status());

  // ── The reviewer swaps a category and types nothing ─────────────────────
  const correctedTitle = `Harbor Jazz Brunch ${RUN_TAG}`;
  const correctedRun = await propose(api, correctedTitle);
  await approveEdited(api, correctedRun, correctedTitle, { categories: ['Live Music', 'Food & Drink'] });

  const corrected = (await feedbackJobs(api, 'review')).find(job => job.externalId === `action_run:${correctedRun}:edit`);

  expect(corrected, 'the correction was not queued for learning').toBeTruthy();
  expect(corrected!.status).toBe('queued');
  expect(corrected!.payload.text).toBe('');
  expect(corrected!.payload.polarityHint).toBe('correct');
  expect(corrected!.payload.edits).toEqual([
    { field: 'categories', before: ['Live Music', 'Jazz Brunch'], after: ['Live Music', 'Food & Drink'] },
  ]);
  // The record as the agent proposed it rides along, for the correction to be read against.
  expect(corrected!.payload.quotedText).toContain(`title: "${correctedTitle}"`);
  expect(corrected!.payload.quotedText).toContain('agent rationale: Per-gig page with its own date line.');

  // ── An edit that only reorders the list is not a correction ─────────────
  const reorderedTitle = `Corvina Quartet ${RUN_TAG}`;
  const reorderedRun = await propose(api, reorderedTitle);
  await approveEdited(api, reorderedRun, reorderedTitle, { categories: ['Jazz Brunch', 'Live Music'] });

  const reviewJobs = await feedbackJobs(api, 'review');

  expect(reviewJobs.some(job => job.externalId.startsWith(`action_run:${reorderedRun}:`))).toBe(false);
});

test('an app with its own review screen posts corrections without a note, and a malformed list is refused', async ({ page }) => {
  await signIn(page);
  const api = page.request;
  const externalId = `panel-review:${RUN_TAG}`;

  const accepted = await api.post('/api/v1/feedback', {
    data: {
      externalId,
      payload: {
        text: '',
        edits: [{ field: 'categories', before: ['Live Music'], after: ['Food & Drink'] }],
        targetSlug: 'listing-extraction',
        quotedText: `title: "Harbor Jazz Brunch ${RUN_TAG}"`,
      },
    },
  });

  expect(accepted.ok(), `feedback refused: ${await accepted.text()}`).toBeTruthy();

  const queued = (await feedbackJobs(api, 'api')).find(job => job.externalId === externalId);

  expect(queued?.payload.edits).toEqual([{ field: 'categories', before: ['Live Music'], after: ['Food & Drink'] }]);

  const refused = await api.post('/api/v1/feedback', {
    data: { externalId: `${externalId}:bad`, payload: { text: '', edits: { categories: 'Food & Drink' } } },
  });

  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain('payload.edits must be an array');
  expect((await feedbackJobs(api, 'api')).some(job => job.externalId === `${externalId}:bad`)).toBe(false);
});
