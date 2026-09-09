import { execFileSync, spawnSync } from 'node:child_process';
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
 * was created" or "exactly one row" is read back from the real
 * `vocion_wt257` Postgres database via `psql` in the running docker
 * container, not from the API's own report of itself.
 *
 * Self-seeding: issues its own token against the seeded `wt257` project (see
 * this worktree's environment notes) and registers its own object type, so
 * repeat runs never collide — every slug and title carries a per-run tag.
 *
 * Running it:
 *
 *   npx playwright test --project=queue objects-propose-candidate-dedup-required
 *
 * Point it at a server already running on another port (this worktree serves
 * on :3010, not the config's default :3008):
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3010 npx playwright test --project=queue objects-propose-candidate-dedup-required
 */

const RUN_TAG = `veerio257-${Date.now().toString(36)}`;
// Object type slugs are lowercase snake_case; the run tag itself carries a
// hyphen (fine everywhere else — titles, token names), so swap it here.
const OBJECT_TYPE_SLUG = `dedup_probe_${RUN_TAG.replace(/-/g, '_')}`;
const DATABASE_NAME = 'vocion_wt257';

/**
 * Issue a real tenant Bearer token against the seeded `wt257` project, the
 * same CLI an operator runs to hand a token to an external caller
 * (`npm run tokens:issue`). Returns the plaintext token, which the script
 * prints exactly once.
 */
function issueRealToken(): string {
  // The token prints on stderr (the script logs with console.warn), so
  // stdout alone misses it — capture both streams and search across them.
  const result = spawnSync(
    'npm',
    ['run', 'tokens:issue', '--silent', '--', '--org', 'wt257', '--name', `veerio-257-dedup-e2e-${RUN_TAG}`],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = output.match(/vcn_live_\w+/);
  if (!match) {
    throw new Error(`tokens:issue printed no token; output was:\n${output}`);
  }
  return match[0];
}

/**
 * One row count read straight from the real database via `psql` in the
 * running `vocion-postgres` container — never through the app's own API, so
 * a row the API's report forgot to mention still shows up here.
 * @param sql - A `select count(*) from …` statement.
 */
function countInDatabase(sql: string): number {
  const output = execFileSync(
    'docker',
    ['exec', 'vocion-postgres', 'psql', '-U', 'postgres', '-d', DATABASE_NAME, '-t', '-c', sql],
    { encoding: 'utf8' },
  );
  return Number.parseInt(output.trim(), 10);
}

test.describe('objects.propose_candidate — dedupOn required (VEERIO-257)', () => {
  test.describe.configure({ mode: 'serial' });

  let token: string;

  test.beforeAll(() => {
    token = issueRealToken();
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
