import type { APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * VEERIO-262 — what a proposal actually did, end to end.
 *
 * Drives `POST /api/v1/reviews/propose` and `POST /api/v1/reviews/decide`
 * with real HTTP requests against a real running app: no mocked database, no
 * mocked auth, a real tenant API token. Unit coverage for the rule itself
 * lives in `src/services/ActionService.test.ts`; this spec is the proof that
 * the outcome survives the whole round trip a caller sees — through the
 * route, the write API, the authz gate and the database — and comes back in
 * the JSON body.
 *
 * The rule under test: a repeat proposal carrying the same identity collapses
 * into the run that already exists. A pending one is refreshed; one a person
 * already decided blocks a second card entirely. Before this, both answered
 * `{ runId, status: 'pending' }` and a caller re-posting a listing page could
 * not tell a new review item from a refresh, let alone from an event a
 * moderator had already thrown out.
 *
 * Fixtures come from `support/seed-propose-fixtures.ts`, which seeds against
 * whatever `DATABASE_URL` the running app itself uses (no separate test
 * database): its own project, the `candidate-intake` demo workspace applied
 * to it so the `event_candidate` object type exists, and an owner-role token.
 *
 * Uses Playwright's `request` fixture only — no `page`, no browser launch —
 * since every assertion is on a JSON response body and a status code.
 *
 * Run with: npx playwright test --project=reviews-propose
 * (point PLAYWRIGHT_BASE_URL at the app under test — see playwright.config.ts)
 */

type SeedFixtures = {
  orgId: string;
  token: string;
};

function seedFixtures(): SeedFixtures {
  // Through `dotenv -c` so the script sees .env.local, same as every other
  // script here that talks to the database outside the Next process. stdout
  // carries exactly one JSON line; everything else goes to stderr.
  const output = execFileSync(
    'npx',
    ['dotenv', '-c', '--', 'npx', 'tsx', 'e2e/reviews-propose/support/seed-propose-fixtures.ts'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const lastLine = output.trim().split('\n').at(-1) ?? '';
  return JSON.parse(lastLine) as SeedFixtures;
}

let fixtures: SeedFixtures;

test.beforeAll(() => {
  fixtures = seedFixtures();
});

/**
 * One event, shaped the way the candidate-extraction playbook shapes it.
 * `dedupOn` names the fields that make this event this event, so a test that
 * wants a different event changes one of those.
 *
 * The record's top-level `title` tracks `fields.title`: that is what the
 * stored candidate row and the review card are labelled with, and fixtures
 * that all read "Open Mic Night" would hide any mix-up between records.
 * @param over - Field overrides, to make a different event or a changed one.
 */
function eventProposal(over: Record<string, unknown> = {}) {
  const fields = {
    title: 'Open Mic Night',
    start: '2026-09-19T19:30',
    venue: 'The Flynn',
    price: 'Free',
    ...over,
  };
  return {
    actionId: 'objects.propose_candidate',
    agentSlug: 'listing-scout',
    confidence: 0.9,
    rationale: 'Listed on the venue\'s own events page with a date and a time.',
    input: {
      objectType: 'event_candidate',
      title: fields.title,
      fields,
      dedupOn: ['title', 'start', 'venue'],
      sourceUrl: 'https://example.org/events/open-mic-night',
      sourceListingUrl: 'https://example.org/events',
      summary: 'Weekly open mic, sign-up from 7pm.',
    },
  };
}

async function propose(request: APIRequestContext, body: Record<string, unknown>) {
  const response = await request.post('/api/v1/reviews/propose', {
    headers: { authorization: `Bearer ${fixtures.token}` },
    data: body,
  });
  return { status: response.status(), body: await response.json() };
}

async function decide(request: APIRequestContext, runId: number, action: 'approve' | 'reject', reason?: string) {
  const response = await request.post('/api/v1/reviews/decide', {
    headers: { authorization: `Bearer ${fixtures.token}` },
    data: { kind: 'action', id: runId, action, reason },
  });
  return { status: response.status(), body: await response.json() };
}

async function pendingCount(request: APIRequestContext): Promise<number> {
  const response = await request.get('/api/v1/reviews', {
    headers: { authorization: `Bearer ${fixtures.token}` },
  });
  const body = await response.json();
  // Read `items` outright rather than falling back to an empty list. A
  // fallback would turn a changed response shape into a count of zero, and
  // every "the queue did not grow" assertion below would pass on nothing.
  return (body.items as unknown[]).length;
}

test.describe('POST /api/v1/reviews/propose', () => {
  test('says `created` for a record nobody has seen, and puts one item in the queue', async ({ request }) => {
    const before = await pendingCount(request);

    const { status, body } = await propose(request, eventProposal({ title: 'Season Launch', start: '2026-10-02T19:00' }));

    expect(status).toBe(200);
    expect(body.outcome).toBe('created');
    expect(body.status).toBe('pending');
    expect(typeof body.runId).toBe('number');
    expect(await pendingCount(request)).toBe(before + 1);
  });

  test('says `refreshed` when the same record is posted again, and adds no second item', async ({ request }) => {
    const first = await propose(request, eventProposal({ title: 'Poetry Slam', start: '2026-10-09T19:00' }));
    const queued = await pendingCount(request);

    // The same page read again, with one field changed the way a listing
    // that gains a price would change.
    const second = await propose(request, eventProposal({ title: 'Poetry Slam', start: '2026-10-09T19:00', price: '$5 suggested' }));

    expect(second.body.outcome).toBe('refreshed');
    expect(second.body.runId).toBe(first.body.runId);
    expect(second.body.status).toBe('pending');
    expect(await pendingCount(request)).toBe(queued);
  });

  test('says `already_decided` for a record the reviewer rejected, and queues nothing', async ({ request }) => {
    const first = await propose(request, eventProposal({ title: 'Craft Fair', start: '2026-10-16T11:00' }));
    const rejected = await decide(request, first.body.runId, 'reject', 'not our kind of event');

    expect(rejected.status).toBe(200);

    const queued = await pendingCount(request);
    // Next week's sweep re-reads the same listing page, event still on it.
    const again = await propose(request, eventProposal({ title: 'Craft Fair', start: '2026-10-16T11:00' }));

    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe('already_decided');
    // The body names the earlier decision, so the caller can say which one.
    expect(again.body.runId).toBe(first.body.runId);
    expect(again.body.status).toBe('rejected');
    expect(again.body.decidedAt).toBeTruthy();
    expect(await pendingCount(request)).toBe(queued);
  });

  test('says `already_decided` for a record the reviewer approved', async ({ request }) => {
    const first = await propose(request, eventProposal({ title: 'Harvest Market', start: '2026-10-23T09:00' }));
    const approved = await decide(request, first.body.runId, 'approve');

    expect(approved.status).toBe(200);

    const again = await propose(request, eventProposal({ title: 'Harvest Market', start: '2026-10-23T09:00' }));

    expect(again.body.outcome).toBe('already_decided');
    expect(again.body.runId).toBe(first.body.runId);
    expect(again.body.status).toBe('done');
  });

  test('still queues a genuinely new event found on the same page', async ({ request }) => {
    const first = await propose(request, eventProposal({ title: 'Winter Ceilidh', start: '2026-11-06T19:30' }));
    await decide(request, first.body.runId, 'reject', 'too far out');
    const queued = await pendingCount(request);

    // Blocking the decided one must not blunt the pipeline: the new event on
    // that same listing page still has to reach a moderator.
    const fresh = await propose(request, eventProposal({ title: 'Winter Ceilidh', start: '2026-11-13T19:30' }));

    expect(fresh.body.outcome).toBe('created');
    expect(fresh.body.runId).not.toBe(first.body.runId);
    expect(await pendingCount(request)).toBe(queued + 1);
  });
});
