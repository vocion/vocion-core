import type { APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * LARK-267 — who approved an action run, end to end.
 *
 * Drives `POST /api/v1/reviews/propose`, `POST /api/v1/reviews/decide` and the
 * queue reads with real HTTP against a real running app: no mocked database, no
 * mocked auth, a real tenant API token. The write rules are unit-tested in
 * `src/services/ActionService.approvedByAgent.test.ts`; this spec proves the
 * three states survive the whole round trip a caller sees — through the route,
 * the write API, the authz gate, the column and back out as JSON.
 *
 * The three states are the point. `null` means nobody has decided, `false`
 * means a person did, `true` means the trust ladder did. A client that cannot
 * tell the first from the second reports every untouched item as
 * human-approved, which is the failure this whole feature exists to prevent.
 *
 * Uses Playwright's `request` fixture only — no `page`, no browser launch —
 * since every assertion is on a JSON body and a status code.
 *
 * Run with: npx playwright test --project=reviews-approved-by-agent
 * (point PLAYWRIGHT_BASE_URL at the app under test — see playwright.config.ts)
 */

type SeedFixtures = {
  orgId: string;
  token: string;
};

const SEED_SCRIPT = 'e2e/reviews-approved-by-agent/support/seed-approved-by-agent-fixtures.ts';
/** Matches the trust rule the seed script enables. */
const TRUSTED_ACTION_ID = 'qc.hold';

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
 * One proposal on the trusted action. `inspection_id` makes each fixture
 * distinct, so they dedup as their own runs rather than refreshing each other.
 * @param inspectionId - Identity of the kit being held.
 * @param confidence - How sure the agent is; what the trust rule is compared against.
 */
function holdProposal(inspectionId: number, confidence: number) {
  return {
    actionId: TRUSTED_ACTION_ID,
    agentSlug: 'qc-screener',
    confidence,
    rationale: 'Seal photo shows a gap on the left edge.',
    suggestedDecision: 'approve',
    suggestedDecisionReason: 'The seal gap is visible in the photo, so the kit should be held.',
    input: {
      inspection_id: inspectionId,
      reason: 'Seal gap on the left edge',
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

async function getDetail(request: APIRequestContext, id: number) {
  const response = await request.get(`/api/v1/reviews/action/${id}`, {
    headers: { authorization: `Bearer ${fixtures.token}` },
  });
  return { status: response.status(), body: await response.json() };
}

async function decide(request: APIRequestContext, id: number, action: 'approve' | 'reject') {
  const response = await request.post('/api/v1/reviews/decide', {
    headers: { authorization: `Bearer ${fixtures.token}` },
    data: { kind: 'action', id, action, ...(action === 'reject' ? { reason: 'not a real defect' } : {}) },
  });
  return { status: response.status(), body: await response.json() };
}

test.beforeAll(async () => {
  fixtures = seedFixtures();
});

test.describe('a proposal nobody has decided', () => {
  test('comes back null, not false, so it can never read as human-approved', async ({ request }) => {
    // Below the trust threshold, so the ladder leaves it for a person.
    const proposed = await propose(request, holdProposal(9001, 0.2));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    expect(proposed.body.status).toBe('pending');

    const detail = await getDetail(request, proposed.body.runId);

    expect(detail.status).toBe(200);
    expect(detail.body.approvedByAgent).toBeNull();
  });

  test('carries the field on the queue row too, without a detail fetch', async ({ request }) => {
    const proposed = await propose(request, holdProposal(9002, 0.2));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);

    const response = await request.get('/api/v1/reviews', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });
    const body = await response.json();
    const row = body.items.find((i: { id: number }) => i.id === proposed.body.runId);

    expect(row).toBeDefined();
    expect(row.approvedByAgent).toBeNull();
  });
});

test.describe('a proposal the trust ladder released', () => {
  test('comes back true, naming the agent and when it decided', async ({ request }) => {
    // Above the seeded threshold, so the ladder executes it without a person.
    const proposed = await propose(request, holdProposal(9100, 0.95));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    // It never waits in the queue — the ladder decided at propose time.
    expect(proposed.body.status).not.toBe('pending');

    const detail = await getDetail(request, proposed.body.runId);

    expect(detail.body.approvedByAgent).toBe(true);
    // The decision is stamped even though this fixture's execution has no
    // inspection row to act on: the approval happened whatever the outcome,
    // and an unstamped run would be indistinguishable from an untouched one.
    expect(detail.body.record.decidedBy).toBe('agent:qc-screener');
    expect(detail.body.record.decidedAt).not.toBeNull();
  });

  test('shows up on the auto-executed audit list', async ({ request }) => {
    const proposed = await propose(request, holdProposal(9101, 0.95));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);

    const response = await request.get('/api/v1/reviews/auto-executed', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });
    const body = await response.json();

    expect(body.items.some((i: { id: number }) => i.id === proposed.body.runId)).toBe(true);
  });
});

test.describe('a proposal a person decided', () => {
  test('comes back false after a human approve, not null', async ({ request }) => {
    const proposed = await propose(request, holdProposal(9200, 0.2));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);

    const decided = await decide(request, proposed.body.runId, 'approve');

    expect(decided.status, JSON.stringify(decided.body)).toBe(200);

    const detail = await getDetail(request, proposed.body.runId);

    expect(detail.body.approvedByAgent).toBe(false);
  });

  test('comes back false after a human reject — a rejection is a decision', async ({ request }) => {
    const proposed = await propose(request, holdProposal(9201, 0.2));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);

    const decided = await decide(request, proposed.body.runId, 'reject');

    expect(decided.status, JSON.stringify(decided.body)).toBe(200);

    const detail = await getDetail(request, proposed.body.runId);

    expect(detail.body.approvedByAgent).toBe(false);
  });

  test('stays off the auto-executed list', async ({ request }) => {
    const proposed = await propose(request, holdProposal(9202, 0.2));
    await decide(request, proposed.body.runId, 'approve');

    const response = await request.get('/api/v1/reviews/auto-executed', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });
    const body = await response.json();

    expect(body.items.some((i: { id: number }) => i.id === proposed.body.runId)).toBe(false);
  });
});

test.describe('a caller that knows nothing about the new field', () => {
  test('reads the queue exactly as before', async ({ request }) => {
    // The whole contract is additive. An existing consumer asks the same
    // question and gets the same shape, with one more key it can ignore.
    const response = await request.get('/api/v1/reviews', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');

    for (const item of body.items) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('kind');
      expect(item).toHaveProperty('status');
    }
  });
});

test.describe('filtering the queue by who approved', () => {
  test('asking for the undecided rows returns them, rather than nothing', async ({ request }) => {
    const proposed = await propose(request, holdProposal(9300, 0.2));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);

    const response = await request.get('/api/v1/reviews?approvedByAgent=null', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });
    const body = await response.json();

    expect(response.status()).toBe(200);
    // `approved_by_agent = NULL` is never true in SQL, so an empty queue here
    // is the failure this asserts against.
    expect(body.items.some((i: { id: number }) => i.id === proposed.body.runId)).toBe(true);

    for (const item of body.items) {
      expect(item.approvedByAgent).toBeNull();
    }
  });

  test('asking for the agent-approved rows excludes one nobody has decided', async ({ request }) => {
    const proposed = await propose(request, holdProposal(9301, 0.2));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);

    const response = await request.get('/api/v1/reviews?approvedByAgent=true', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });
    const body = await response.json();

    expect(response.status()).toBe(200);
    // A filter that was quietly dropped would return the whole queue, this run
    // included, while the client believed every row had been agent-approved.
    expect(body.items.some((i: { id: number }) => i.id === proposed.body.runId)).toBe(false);

    for (const item of body.items) {
      expect(item.approvedByAgent).toBe(true);
    }
  });

  test('composes with the action-type filter instead of replacing it', async ({ request }) => {
    const proposed = await propose(request, holdProposal(9302, 0.2));

    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);

    const both = await request.get(
      `/api/v1/reviews?approvedByAgent=null&actionIds=${TRUSTED_ACTION_ID}`,
      { headers: { authorization: `Bearer ${fixtures.token}` } },
    );
    const body = await both.json();

    expect(both.status()).toBe(200);
    expect(body.items.some((i: { id: number }) => i.id === proposed.body.runId)).toBe(true);

    for (const item of body.items) {
      expect(item.approvedByAgent).toBeNull();
    }
  });

  test('refuses a value it does not recognise, rather than reading the whole queue', async ({ request }) => {
    const response = await request.get('/api/v1/reviews?approvedByAgent=1', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });

    expect(response.status()).toBe(400);
  });
});
