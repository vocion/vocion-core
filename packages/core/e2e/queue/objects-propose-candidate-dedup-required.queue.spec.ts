import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * VEERIO-257 — `objects.propose_candidate` must refuse a missing/empty
 * `dedupOn` and a `dedupOn` nested inside `fields`, and the caller must see a
 * plain-text sentence rather than a raw `ZodError` issues dump. Two identical
 * proposals with a valid `dedupOn` must still collapse into one pending row.
 *
 * End to end, through the running app, driven by a real tenant Bearer token
 * (`vcn_live_…`) exactly as an ingestion agent's panel would call it — not a
 * unit test against the action in isolation. Every assertion about "no row
 * was created" or "exactly one row" is read back from the database the app
 * is running against, through the app's own database client
 * (`support/seed-dedup-fixtures.ts --count`), not from the API's own report
 * of itself.
 *
 * Self-seeding: `support/seed-dedup-fixtures.ts` creates the spec's own
 * account + project and mints its token, and the spec registers its own
 * object type, so it runs against an empty database (CI) as well as a
 * developer's, and repeat runs never collide: every slug and title carries
 * a per-run tag.
 *
 * Running it:
 *
 *   npx playwright test --project=queue objects-propose-candidate-dedup-required
 *
 * Point it at a server already running on another port:
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3010 npx playwright test --project=queue objects-propose-candidate-dedup-required
 */

const RUN_TAG = `veerio257-${Date.now().toString(36)}`;
// Object type slugs are lowercase snake_case; the run tag itself carries a
// hyphen (fine everywhere else — titles, token names), so swap it here.
const OBJECT_TYPE_SLUG = `dedup_probe_${RUN_TAG.replace(/-/g, '_')}`;
const SEED_SCRIPT = 'e2e/queue/support/seed-dedup-fixtures.ts';

type SeedFixtures = {
  orgId: string;
  token: string;
};

/**
 * Run the support script the way the rest of the E2E tree does: outside the
 * Next process, through `dotenv -c` so it reads the same `.env.local` the app
 * under test reads and therefore reaches the same database. Returns the last
 * stdout line. A failure names the script's own last stderr line, so the
 * Playwright annotation says what went wrong rather than "Command failed".
 * @param args - Arguments after the script path.
 */
function runSeedScript(args: string[] = []): string {
  try {
    const output = execFileSync(
      'npx',
      ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return output.trim().split('\n').at(-1) ?? '';
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim().split('\n').at(-1) ?? '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${SEED_SCRIPT} ${args.join(' ')} failed: ${stderr || message}`);
  }
}

function seedFixtures(): SeedFixtures {
  return JSON.parse(runSeedScript()) as SeedFixtures;
}

/**
 * One row count read straight from the database through the app's own
 * client, never through the app's API, so a row the API's report forgot to
 * mention still shows up here.
 * @param sql - A `select count(*) from …` statement.
 */
function countInDatabase(sql: string): number {
  return Number.parseInt(runSeedScript(['--count', sql]), 10);
}

test.describe('objects.propose_candidate — dedupOn required (VEERIO-257)', () => {
  test.describe.configure({ mode: 'serial' });

  let token: string;

  test.beforeAll(() => {
    token = seedFixtures().token;
  });

  test('registers the probe object type', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/v1/objects/types`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        slug: OBJECT_TYPE_SLUG,
        label: 'Dedup probe',
        schema: {
          type: 'object',
          required: ['title'],
          properties: { title: { type: 'string' } },
        },
      },
    });

    expect(response.status(), await response.text()).toBe(201);
  });

  test('a missing dedupOn is refused with a plain-text message and stores nothing', async ({ request, baseURL }) => {
    const title = `probe-missing-${RUN_TAG}`;
    const response = await request.post(`${baseURL}/api/v1/reviews/propose`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        actionId: 'objects.propose_candidate',
        input: { objectType: OBJECT_TYPE_SLUG, title, fields: { title } },
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error.code).toBe('VALIDATION_FAILED');

    // A plain sentence, not a serialised ZodError: no JSON-array leak of raw
    // issue objects, and the exact wording the fix's `superRefine` writes.
    expect(body.error.message).toContain('dedupOn must list at least one field');
    expect(body.error.message).not.toMatch(/^\s*\[/);
    expect(body.error.message).not.toContain('"code":"custom"');

    expect(countInDatabase(
      `select count(*) from action_run where action_id='objects.propose_candidate' and input->>'title'='${title}'`,
    )).toBe(0);
    expect(countInDatabase(
      `select count(*) from business_object where title='${title}'`,
    )).toBe(0);
  });

  test('a dedupOn nested inside fields is refused with a plain-text message and stores nothing', async ({ request, baseURL }) => {
    const title = `probe-nested-${RUN_TAG}`;
    const response = await request.post(`${baseURL}/api/v1/reviews/propose`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        actionId: 'objects.propose_candidate',
        input: { objectType: OBJECT_TYPE_SLUG, title, fields: { title, dedupOn: ['title'] } },
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error.code).toBe('VALIDATION_FAILED');

    expect(body.error.message).toContain('dedupOn found inside fields');
    expect(body.error.message).not.toMatch(/^\s*\[/);
    expect(body.error.message).not.toContain('"code":"custom"');

    expect(countInDatabase(
      `select count(*) from action_run where action_id='objects.propose_candidate' and input->>'title'='${title}'`,
    )).toBe(0);
    expect(countInDatabase(
      `select count(*) from business_object where title='${title}'`,
    )).toBe(0);
  });

  test('two identical proposals with a valid dedupOn leave exactly one pending row', async ({ request, baseURL }) => {
    const title = `probe-valid-${RUN_TAG}`;
    const proposeOnce = () => request.post(`${baseURL}/api/v1/reviews/propose`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        actionId: 'objects.propose_candidate',
        input: { objectType: OBJECT_TYPE_SLUG, title, fields: { title }, dedupOn: ['title'] },
      },
    });

    const first = await proposeOnce();

    expect(first.status(), await first.text()).toBe(200);

    const firstBody = await first.json();

    expect(firstBody.status).toBe('pending');

    const second = await proposeOnce();

    expect(second.status(), await second.text()).toBe(200);

    const secondBody = await second.json();

    expect(secondBody.status).toBe('pending');

    // Same run refreshed, never a second one.
    expect(secondBody.runId).toBe(firstBody.runId);

    expect(countInDatabase(
      `select count(*) from action_run where action_id='objects.propose_candidate' and input->>'title'='${title}'`,
    )).toBe(1);
    expect(countInDatabase(
      `select count(*) from business_object where title='${title}'`,
    )).toBe(1);
    expect(countInDatabase(
      `select count(*) from action_run where id=${firstBody.runId} and status='pending' and dedup_key is not null`,
    )).toBe(1);
  });
});
