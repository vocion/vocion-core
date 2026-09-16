import type { APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * #320 — querying the review queue by what the AGENT recommended, end to end.
 *
 * Drives `POST /api/v1/reviews/propose` and `GET /api/v1/reviews` with real
 * HTTP against a real running app: no mocked database, no mocked auth, a real
 * tenant API token. The rule itself is unit-tested in
 * `src/services/ReviewService.suggestedDecision.test.ts`; this spec proves the
 * recommendation survives the whole round trip a caller sees — through the
 * route, the write API, the authz gate, jsonb storage and back out as JSON —
 * and that the filter can cut several lanes out of one pending set.
 *
 * Uses Playwright's `request` fixture only — no `page`, no browser launch —
 * since every assertion is on a JSON body and a status code.
 *
 * Run with: npx playwright test --project=reviews-suggested-decision
 * (point PLAYWRIGHT_BASE_URL at the app under test — see playwright.config.ts)
 */

type SeedFixtures = {
  orgId: string;
  token: string;
};

const SEED_SCRIPT = 'e2e/reviews-suggested-decision/support/seed-suggested-decision-fixtures.ts';

function seedFixtures(): SeedFixtures {
  // Through `dotenv -c` so the script sees .env.local, same as every other
  // script here that talks to the database outside the Next process. stdout
  // carries exactly one JSON line; everything else goes to stderr, which is
  // captured so a failure can quote the script's own last line.
  try {
    const output = execFileSync(
      'npx',
      ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const lastLine = output.trim().split('\n').at(-1) ?? '';
    return JSON.parse(lastLine) as SeedFixtures;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr) {
      process.stderr.write(stderr);
    }
    const reason = stderr.trim().split('\n').at(-1) || (error instanceof Error ? error.message : String(error));
    throw new Error(`${SEED_SCRIPT} failed: ${reason}`);
  }
}

let fixtures: SeedFixtures;

/**
 * One candidate, with the agent's recommendation attached. `title` also makes
 * the record distinct, so each fixture dedups as its own item rather than
 * refreshing the previous one.
 * @param title - What to call the candidate; also part of its identity.
 * @param suggestedDecision - What the agent advises. Required by the endpoint.
 * @param suggestedDecisionReason - Why it advises that, in one sentence.
 */
function candidateProposal(title: string, suggestedDecision: string, suggestedDecisionReason: string) {
  const fields = {
    title,
    start: '2026-09-19T19:30',
    venue: 'The Flynn',
    price: 'Free',
  };
  return {
    actionId: 'objects.propose_candidate',
    agentSlug: 'listing-scout',
    confidence: 0.9,
    rationale: 'Listed on the venue\'s own events page with a date and a time.',
    suggestedDecision,
    suggestedDecisionReason,
    input: {
      objectType: 'event_candidate',
      title,
      fields,
      dedupOn: ['title', 'start', 'venue'],
      sourceUrl: `https://example.org/events/${encodeURIComponent(title)}`,
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

/**
 * The queue as a caller sees it, optionally narrowed.
 * @param request - Playwright's request fixture.
 * @param query - Query string to append, without the leading `?`.
 */
async function listQueue(request: APIRequestContext, query = '') {
  const response = await request.get(`/api/v1/reviews${query ? `?${query}` : ''}`, {
    headers: { authorization: `Bearer ${fixtures.token}` },
  });
  const body = await response.json();
  return { status: response.status(), body };
}

test.beforeAll(async ({ request }) => {
  fixtures = seedFixtures();

  // Three items, one lane each. There is no fourth "no view" item any more:
  // the endpoint refuses a proposal that recommends nothing, which is the
  // rule the last describe block below drives directly. Proposed once for the
  // whole file — every assertion reads the same queue, and re-seeding per
  // test would only make the run slower.
  const seeded = await Promise.all([
    propose(request, candidateProposal('Open Mic Night', 'approve', 'Fits the listing rules and nothing like it is already queued.')),
    propose(request, candidateProposal('Closed Rehearsal', 'reject', 'Not open to the public, so it fails the listing rules.')),
    propose(request, candidateProposal('Maybe Later Matinee', 'snooze', 'The venue has not confirmed the date yet.')),
  ]);
  for (const result of seeded) {
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }
});

test.describe('GET /api/v1/reviews?suggestedDecision=', () => {
  test('returns only what the agent wants turned down', async ({ request }) => {
    const { status, body } = await listQueue(request, 'suggestedDecision=reject');

    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].suggestedDecision).toBe('reject');
    // The total narrows with the filter, rather than reporting the whole
    // queue and handing back a filtered page.
    expect(body.total).toBe(1);
  });

  test('returns only what the agent wants approved', async ({ request }) => {
    const { body } = await listQueue(request, 'suggestedDecision=approve');

    expect(body.items).toHaveLength(1);
    expect(body.items[0].suggestedDecision).toBe('approve');
    expect(body.total).toBe(1);
  });

  test('returns only what the agent wants revisited later', async ({ request }) => {
    const { body } = await listQueue(request, 'suggestedDecision=snooze');

    expect(body.items).toHaveLength(1);
    expect(body.items[0].suggestedDecision).toBe('snooze');
    expect(body.total).toBe(1);
  });

  test('the three lanes together are the whole queue, because every item carries a recommendation', async ({ request }) => {
    // The point of the filter: several queues cut from one pending set. And
    // the point of the requirement: nothing sits outside those lanes, so the
    // agreement metric measures the queue rather than a subset of it.
    const unfiltered = await listQueue(request);

    expect(unfiltered.body.total).toBe(3);
    expect(unfiltered.body.items.filter((i: { suggestedDecision?: string }) => !i.suggestedDecision)).toHaveLength(0);
  });

  test('carries the recommendation on the thin row, without a detail fetch', async ({ request }) => {
    const { body } = await listQueue(request);
    const recommendations = body.items
      .map((i: { suggestedDecision?: string }) => i.suggestedDecision)
      .filter(Boolean)
      .sort();

    expect(recommendations).toEqual(['approve', 'reject', 'snooze']);
  });

  test('carries the reason beside the recommendation on the thin row', async ({ request }) => {
    // The pair is what makes a "wants turned down" lane usable: the badge says
    // what the agent advised, the sentence says what a reviewer should check,
    // and neither costs a detail fetch per row.
    const { body } = await listQueue(request, 'suggestedDecision=reject');

    expect(body.items[0].suggestedDecision).toBe('reject');
    expect(body.items[0].suggestedDecisionReason).toBe('Not open to the public, so it fails the listing rules.');
  });

  test('every row carries a reason beside its recommendation', async ({ request }) => {
    // Both fields are required of every caller, so a queue read back over HTTP
    // has no row a reviewer would have to take on faith.
    const { body } = await listQueue(request);
    const bare = body.items.filter((i: { suggestedDecisionReason?: string }) => !i.suggestedDecisionReason);

    expect(bare).toHaveLength(0);
  });

  test('composes with the action-type filter', async ({ request }) => {
    const matching = await listQueue(request, 'suggestedDecision=reject&actionIds=objects.propose_candidate');
    const other = await listQueue(request, 'suggestedDecision=reject&actionIds=hubspot.update');

    expect(matching.body.total).toBe(1);
    // Both filters apply. A type this org has never proposed matches nothing,
    // rather than falling back to every rejected-recommendation item.
    expect(other.body.total).toBe(0);
  });

  test('refuses a value that is not one of the three', async ({ request }) => {
    // `rejected` is the human decision's spelling, and the mistake a caller is
    // most likely to make. It must be a 400 — a dropped filter would hand back
    // the whole queue and read as though every item carried that
    // recommendation.
    const { status, body } = await listQueue(request, 'suggestedDecision=rejected');

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('suggestedDecision');
  });
});

test.describe('the detail view', () => {
  test('carries the recommendation in the proposal envelope', async ({ request }) => {
    const { body: queue } = await listQueue(request, 'suggestedDecision=reject');
    const item = queue.items[0];

    const response = await request.get(`/api/v1/reviews/action/${item.id}`, {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });
    const detail = await response.json();

    expect(response.status()).toBe(200);
    expect(detail.proposal).toMatchObject({ suggestedDecision: 'reject', confidence: 0.9 });
    expect(detail.suggestedDecision).toBe('reject');
  });
});

test.describe('POST /api/v1/reviews/propose', () => {
  test('refuses a recommendation outside the three', async ({ request }) => {
    const { status, body } = await propose(request, candidateProposal('Bad Recommendation Gig', 'rejected', 'Not open to the public.'));

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('suggestedDecision');
  });

  test('refuses a proposal that recommends nothing', async ({ request }) => {
    // The rule the whole feature rests on: a card nobody recommended anything
    // about cannot be compared against the decision a person then takes, so it
    // never reaches the queue in the first place.
    const { suggestedDecision: _dropped, ...noView } = candidateProposal('No Opinion Open Day', 'approve', 'Fits the listing rules.');

    const { status, body } = await propose(request, noView);

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('suggestedDecision');
  });

  test('refuses a recommendation that comes with no reason', async ({ request }) => {
    // A verdict a reviewer cannot check is one they can only take on faith,
    // and whitespace is the same as nothing.
    const { status, body } = await propose(request, candidateProposal('Unexplained Matinee', 'reject', '   '));

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('suggestedDecisionReason');
  });

  test('keeps a recommendation to turn down out of the auto-execute path', async ({ request }) => {
    // Confidence and recommendation answer different questions. A proposal the
    // agent wants declined stays pending for a person whatever its confidence.
    const { status, body } = await propose(request, {
      ...candidateProposal('High Confidence Decline', 'reject', 'Not open to the public, so it fails the listing rules.'),
      confidence: 0.99,
    });

    expect(status).toBe(200);
    expect(body.status).toBe('pending');
  });
});
