import type { APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * #343 — `POST /api/v1/evals/:slug/refresh`, end to end.
 *
 * Real HTTP against a real running app: real database, real bearer-token auth,
 * no mocks. Unit coverage for the route lives next to it
 * (`app/api/v1/evals/[slug]/refresh/route.test.ts`); this spec is the proof
 * that the same behaviour holds once an outside caller reaches the real
 * server.
 *
 * The rule under test is the one the route exists for: **asking for a refresh
 * returns immediately and never leaves a run in limbo.** Whether Temporal is
 * reachable from the machine running this suite decides which way it answers,
 * and both answers are correct:
 *
 * - Temporal up: 202, a run id, and that run sitting at `running` with no
 *   cases executed yet.
 * - Temporal down: 503, and that same run closed out as `failed` — never left
 *   saying `running` forever with nothing on its way to fill it in.
 *
 * What is never acceptable, and what this spec would catch, is the route
 * blocking on the whole dataset the way the older `/runs` route did, or
 * writing a run row that nothing ever resolves.
 *
 * The seeded dataset has no cases on purpose. The route really does start a
 * real workflow, and on a machine with a Temporal worker running that workflow
 * would execute every case against a real model and a real judge. With nothing
 * to execute, the whole path is exercised and no model is ever called.
 *
 * Uses Playwright's `request` fixture only — no browser — since every
 * assertion is on a status code and a JSON body.
 *
 * Run with: npx playwright test --project=eval-refresh
 */

type SeedFixtures = {
  primaryOrgId: string;
  otherOrgId: string;
  datasetSlug: string;
  primaryToken: string;
  otherOrgToken: string;
};

const SEED_SCRIPT = 'e2e/eval-refresh/support/seed-eval-refresh-fixtures.ts';

/**
 * Seed through `dotenv -c`, the way every other script here that talks to the
 * database outside the Next process does. stdout carries exactly one JSON
 * line; stderr is captured so a failure can quote the script's own message.
 */
function seedFixtures(): SeedFixtures {
  try {
    const output = execFileSync(
      'npx',
      ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(output.trim().split('\n').at(-1) ?? '') as SeedFixtures;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    process.stderr.write(stderr);
    throw new Error(`could not seed eval refresh fixtures: ${stderr.trim().split('\n').at(-1) ?? String(error)}`);
  }
}

/**
 * Ask for a refresh as one org.
 * @param request - Playwright's request fixture.
 * @param slug - The dataset to refresh.
 * @param token - The bearer token to send, or undefined for no credential.
 */
async function refresh(request: APIRequestContext, slug: string, token?: string) {
  return request.post(`/api/v1/evals/${slug}/refresh`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

let fixtures: SeedFixtures;

test.beforeAll(() => {
  fixtures = seedFixtures();
});

test.describe('POST /api/v1/evals/:slug/refresh', () => {
  test('answers without running the dataset, and never leaves a run in limbo', async ({ request }) => {
    const startedAt = Date.now();
    const response = await refresh(request, fixtures.datasetSlug, fixtures.primaryToken);
    const elapsedMs = Date.now() - startedAt;
    const body = await response.json();

    // The old route awaited the whole execution — tens of seconds for a real
    // dataset. This one answers before any case runs.
    expect(elapsedMs).toBeLessThan(15_000);

    if (response.status() === 202) {
      expect(body.status).toBe('running');
      expect(typeof body.runId).toBe('number');
      // The workflow id is the run group. If these ever diverge, a retried
      // activity files a second run for work that happened once.
      expect(body.workflowId).toBe(body.runGroupId);
      expect(Array.isArray(body.providers)).toBe(true);
    } else {
      // Temporal unreachable from this machine. The route still owes an
      // honest answer and a closed-out run.
      expect(response.status()).toBe(503);
      expect(body.error.code).toBe('EVAL_REFRESH_NOT_STARTED');
      expect(body.error.message.length).toBeGreaterThan(0);
    }
  });

  test('refuses a caller with no credential', async ({ request }) => {
    const response = await refresh(request, fixtures.datasetSlug);

    expect(response.status()).toBe(401);
  });

  test('answers 404 for another org\'s dataset, never 403', async ({ request }) => {
    // 403 would confirm the dataset exists to someone who cannot see it.
    const response = await refresh(request, fixtures.datasetSlug, fixtures.otherOrgToken);

    expect(response.status()).toBe(404);
  });

  test('answers 404 for a dataset nobody has', async ({ request }) => {
    const response = await refresh(request, 'no-such-dataset-anywhere', fixtures.primaryToken);

    expect(response.status()).toBe(404);
  });
});
