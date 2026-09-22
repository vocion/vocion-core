import type { APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * LARK-261 — prompt-cache token counts, end to end over real HTTP.
 *
 * An external worker (`packages/agent-runtime`) runs the agent loop on someone
 * else's machine and reports what it spent back through
 * `POST /api/v1/worker-runs/:id/heartbeat`. Now that the runtime caches its
 * prompt prefix, that report carries two more numbers — `cacheReadTokens` and
 * `cacheWriteTokens` — and the whole saving is invisible unless the route
 * reads them and pricing charges them at their own rates.
 *
 * Unit tests cover the pricing arithmetic and the service. This spec covers
 * the part unit tests cannot: that a real JSON body, over real HTTP, against
 * the real route and the real database, ends up on the budget row the
 * dashboard reads. The regression it guards is small and silent — a route that
 * simply does not copy `cacheWriteTokens` out of the body looks fine, returns
 * 200, and undercharges every cold turn by about 25%.
 *
 * Every test invents its own agent slugs, so every comparison is between two
 * budget rows that test created. Nothing here depends on file order, and
 * running one test with `--grep` gives the same answer as running all of them.
 *
 * The three shapes compared, always against each other within one test:
 *   - a turn that WROTE its prefix (billed at 1.25x input)
 *   - a turn that READ its prefix back (billed at 0.1x)
 *   - the same tokens with nothing cached
 *
 * Uses Playwright's `request` fixture only — no `page`, no browser launch —
 * since every assertion is on a JSON response body.
 *
 * The server must have `VOCION_EXTERNAL_WORKERS=1`; without it every
 * worker-run route answers 501 and this spec fails on the first request.
 *
 * Run with: npx playwright test --project=worker-run-usage
 * (point PLAYWRIGHT_BASE_URL at the app under test — see playwright.config.ts)
 */

type SeedFixtures = {
  orgId: string;
  token: string;
};

const SEED_SCRIPT = 'e2e/worker-run-usage/support/seed-worker-run-usage-fixtures.ts';

/** A model that `libs/pricing.ts` prices, so a charge is non-zero. */
const MODEL = 'us.anthropic.claude-sonnet-4-6';

/**
 * The same token shape for all three agents: 10,000 input tokens of which
 * 8,000 are the prefix, and 500 out. Only which bucket the 8,000 lands in
 * changes between the three runs, so any difference in cost is the cache
 * accounting and nothing else.
 */
const INPUT_TOKENS = 10_000;
const PREFIX_TOKENS = 8_000;
const OUTPUT_TOKENS = 500;

/**
 * Each test invents its own agent slugs, so each gets its own budget rows and
 * no test depends on what another test charged. Running one spec with
 * `--grep`, or reordering the file, has to give the same answer as running the
 * whole project.
 */
let slugCounter = 0;
function freshAgentSlug(what: string): string {
  slugCounter += 1;
  return `e2e-cache-${what}-${slugCounter}`;
}

function seedFixtures(): SeedFixtures {
  // Through `dotenv -c` so the script sees .env.local, same as every other
  // script in this repo that talks to the database outside the Next process.
  // stdout carries exactly one JSON line (everything else goes to stderr, see
  // the script's own header). stderr is captured so a failure can quote the
  // script's last line instead of "Command failed: npx ...".
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

test.beforeAll(() => {
  fixtures = seedFixtures();
});

function authHeader(): { authorization: string } {
  return { authorization: `Bearer ${fixtures.token}` };
}

/**
 * Queue a run, take its lease, and report one turn's usage — the three calls a
 * real external worker makes, in that order.
 * @param request - Playwright's request fixture.
 * @param agentSlug - Which agent the run belongs to, and so which budget row.
 * @param usage - The cache split to report for this turn.
 * @param usage.cacheReadTokens - Prefix tokens served from the vendor's cache.
 * @param usage.cacheWriteTokens - Prefix tokens written into the vendor's cache.
 * @param via - Which of the two reporting routes to use.
 */
async function runOneTurn(
  request: APIRequestContext,
  agentSlug: string,
  usage: { cacheReadTokens?: number; cacheWriteTokens?: number },
  via: 'heartbeat' | 'checkpoint' = 'heartbeat',
): Promise<{ runId: number }> {
  const created = await request.post('/api/v1/worker-runs', {
    headers: authHeader(),
    data: { agentSlug, input: { message: 'go' } },
  });

  expect(created.status(), await created.text()).toBe(201);

  const { run } = await created.json();

  const claimed = await request.post(`/api/v1/worker-runs/${run.id}/claim`, {
    headers: authHeader(),
    data: { workerId: 'e2e-worker' },
  });

  expect(claimed.status(), await claimed.text()).toBe(200);

  const beat = await request.post(`/api/v1/worker-runs/${run.id}/${via}`, {
    headers: authHeader(),
    data: {
      workerId: 'e2e-worker',
      // The checkpoint route requires a cursor; the heartbeat route ignores
      // one. Sending it on both keeps the two calls otherwise identical, which
      // is what makes them comparable.
      cursor: 'page-1',
      usage: { model: MODEL, inputTokens: INPUT_TOKENS, outputTokens: OUTPUT_TOKENS, ...usage },
    },
  });

  expect(beat.status(), await beat.text()).toBe(200);

  return { runId: run.id };
}

/**
 * Micro-cents one turn of the given shape costs, on an agent of its own.
 * @param request - Playwright's request fixture.
 * @param what - Short label, so the generated agent slug says what it was.
 * @param usage - The cache split to report for the turn.
 * @param usage.cacheReadTokens - Prefix tokens served from the vendor's cache.
 * @param usage.cacheWriteTokens - Prefix tokens written into the vendor's cache.
 * @param via - Which of the two reporting routes to use.
 */
async function costOfOneTurn(
  request: APIRequestContext,
  what: string,
  usage: { cacheReadTokens?: number; cacheWriteTokens?: number },
  via: 'heartbeat' | 'checkpoint' = 'heartbeat',
): Promise<number> {
  const agentSlug = freshAgentSlug(what);
  await runOneTurn(request, agentSlug, usage, via);
  return chargedMicroCents(request, agentSlug);
}

/**
 * The token count recorded against one run.
 *
 * Read back through `GET /api/v1/worker-runs/:id` rather than taken from the
 * heartbeat reply: the reply carries the control signals a worker acts on
 * (stop, lease, cap remaining), not the counters, so this is the only place
 * the stored number is observable to a caller.
 * @param request - Playwright's request fixture.
 * @param runId - The run to read.
 */
async function recordedTokens(request: APIRequestContext, runId: number): Promise<number> {
  const response = await request.get(`/api/v1/worker-runs/${runId}`, { headers: authHeader() });

  expect(response.status(), await response.text()).toBe(200);

  const { run } = await response.json();
  return run.tokens;
}

/**
 * Micro-cents charged to one agent in the current period.
 * @param request - Playwright's request fixture.
 * @param agentSlug - The agent whose budget row to read.
 */
async function chargedMicroCents(request: APIRequestContext, agentSlug: string): Promise<number> {
  const response = await request.get('/api/v1/budgets', { headers: authHeader() });

  expect(response.status(), await response.text()).toBe(200);

  const { budgets } = await response.json();
  const row = (budgets as Array<{ agentSlug: string; currentMicroCents: number }>)
    .find(b => b.agentSlug === agentSlug);

  expect(row, `no budget row for ${agentSlug} — was the heartbeat charged at all?`).toBeTruthy();

  return row!.currentMicroCents;
}

test.describe('prompt-cache token counts reported by an external worker', () => {
  test('a turn that wrote its prefix costs more than one that cached nothing', async ({ request }) => {
    const cold = await costOfOneTurn(request, 'cold', { cacheWriteTokens: PREFIX_TOKENS });
    const plain = await costOfOneTurn(request, 'plain', {});

    // A cache write is billed at 1.25x input. If the route dropped
    // `cacheWriteTokens`, these two would be equal.
    expect(cold).toBeGreaterThan(plain);
  });

  test('a turn that read its prefix back costs a fraction of one that cached nothing', async ({ request }) => {
    const warm = await costOfOneTurn(request, 'warm', { cacheReadTokens: PREFIX_TOKENS });
    const plain = await costOfOneTurn(request, 'plain', {});

    expect(warm).toBeLessThan(plain);
  });

  test('the checkpoint route charges a cache write the same way the heartbeat route does', async ({ request }) => {
    // Same body, the other route. The two read the usage object with separate
    // copies of the same code, so a field added to one and missed on the other
    // is exactly the mistake this catches.
    const cold = await costOfOneTurn(request, 'cold-checkpoint', { cacheWriteTokens: PREFIX_TOKENS }, 'checkpoint');
    const plain = await costOfOneTurn(request, 'plain-checkpoint', {}, 'checkpoint');

    expect(cold).toBeGreaterThan(plain);
  });

  test('cached tokens still count against the token cap', async ({ request }) => {
    // Money changes when a prefix is cached; the token count does not. A
    // cached token is still a token the model read, and the simpler token cap
    // has to keep binding.
    const { runId } = await runOneTurn(request, freshAgentSlug('cap'), { cacheReadTokens: PREFIX_TOKENS });

    expect(await recordedTokens(request, runId)).toBe(INPUT_TOKENS + OUTPUT_TOKENS);
  });

  test('a body with no cache counts at all is still accepted', async ({ request }) => {
    // Older workers, and the in-process loop, report the two fields they
    // always did. The route must not start requiring the new ones.
    const { runId } = await runOneTurn(request, freshAgentSlug('legacy'), {});

    expect(await recordedTokens(request, runId)).toBe(INPUT_TOKENS + OUTPUT_TOKENS);
  });
});
