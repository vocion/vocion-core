import type { APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * VEERIO-252 — mission-run reports, end to end.
 *
 * Drives `GET /api/v1/missions/:slug/runs` and `GET /api/v1/mission-runs/:id`
 * with real HTTP requests against a real running app (no mocked DB, no
 * mocked auth), the way an outside caller — the Veerio source registry, for
 * one — actually reaches them. Unit coverage for these two routes already
 * lives next to the route files (`route.test.ts`); this spec is the proof
 * that the same behavior holds once a browser-less client hits the real
 * server, the real database and the real bearer-token auth path.
 *
 * Fixtures come from `support/seed-mission-run-fixtures.ts`, which seeds
 * against whatever `DATABASE_URL` the running app itself uses (no separate
 * test database) and mints its tokens through the same `issueToken` the
 * dashboard's "Create token" button and `npm run tokens:issue` call. See
 * that file for exactly what it creates: a mission with three runs (two
 * completed with a populated `plan.tasks[0].output`, one with a literal
 * `null` plan) plus a second org with its own token for the cross-tenant
 * checks below.
 *
 * Uses Playwright's `request` fixture only — no `page`, no browser launch —
 * since every assertion here is on a JSON response body and a status code.
 *
 * Run with: npx playwright test --project=mission-runs
 * (point PLAYWRIGHT_BASE_URL at the app under test — see playwright.config.ts)
 */

type SeedFixtures = {
  primaryOrgId: string;
  otherOrgId: string;
  missionSlug: string;
  runIdWithOutput: number;
  runIdFailedWithOutput: number;
  runIdNullPlan: number;
  primaryToken: string;
  otherOrgToken: string;
};

const SEED_SCRIPT = 'e2e/mission-runs/support/seed-mission-run-fixtures.ts';

function seedFixtures(): SeedFixtures {
  // Through `dotenv -c` so the script sees .env.local, same as every other
  // script in this repo that talks to the database outside the Next
  // process. stdout carries exactly one JSON line (everything else the
  // script prints goes to stderr, see the script's own header comment).
  // stderr is captured so a failure can quote the script's own last line
  // instead of "Command failed: npx ...", and echoed so the run log keeps it.
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

function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function getJson(request: APIRequestContext, url: string, headers?: Record<string, string>) {
  const response = await request.get(url, { headers });
  return { status: response.status(), body: await response.json() };
}

test.describe('GET /api/v1/missions/:slug/runs', () => {
  test('returns real mission-run reports, newest first, with plan.tasks[].output', async ({ request }) => {
    const { status, body } = await getJson(
      request,
      `/api/v1/missions/${fixtures.missionSlug}/runs`,
      authHeader(fixtures.primaryToken),
    );

    expect(status).toBe(200);
    expect(body.runs).toHaveLength(3);

    // Newest first: the null-plan run was inserted last.
    expect(body.runs[0].id).toBe(fixtures.runIdNullPlan);
    expect(body.runs[1].id).toBe(fixtures.runIdFailedWithOutput);
    expect(body.runs[2].id).toBe(fixtures.runIdWithOutput);

    const completedRun = body.runs.find((run: any) => run.id === fixtures.runIdWithOutput);

    expect(completedRun.status).toBe('completed');
    expect(completedRun.missionSlug).toBe(fixtures.missionSlug);
    expect(completedRun.plan.tasks[0].output).toBe('found 3, refreshed 3, failed 0');

    // The run-level status/error can read completed/null while the task
    // underneath actually failed — real proof of the doc comment on
    // MissionService.toMissionRunReport, not just a unit-test assertion.
    const failedTaskRun = body.runs.find((run: any) => run.id === fixtures.runIdFailedWithOutput);

    expect(failedTaskRun.status).toBe('completed');
    expect(failedTaskRun.error).toBeNull();
    expect(failedTaskRun.plan.tasks[0].status).toBe('failed');
    expect(failedTaskRun.plan.tasks[0].output).toBe('0 proposals — every source returned empty');
  });

  test('limit= caps how many runs come back, keeping the newest', async ({ request }) => {
    const { status, body } = await getJson(
      request,
      `/api/v1/missions/${fixtures.missionSlug}/runs?limit=1`,
      authHeader(fixtures.primaryToken),
    );

    expect(status).toBe(200);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe(fixtures.runIdNullPlan);
  });

  test('rejects a request with no credential at all', async ({ request }) => {
    const { status, body } = await getJson(request, `/api/v1/missions/${fixtures.missionSlug}/runs`);

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('a token from a different org gets 404, not the other org\'s data or a 403', async ({ request }) => {
    const { status, body } = await getJson(
      request,
      `/api/v1/missions/${fixtures.missionSlug}/runs`,
      authHeader(fixtures.otherOrgToken),
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(body)).not.toContain('found 3, refreshed 3, failed 0');
  });
});

test.describe('GET /api/v1/mission-runs/:id', () => {
  test('returns the full report for one run, including plan.tasks[].output', async ({ request }) => {
    const { status, body } = await getJson(
      request,
      `/api/v1/mission-runs/${fixtures.runIdWithOutput}`,
      authHeader(fixtures.primaryToken),
    );

    expect(status).toBe(200);
    expect(body.id).toBe(fixtures.runIdWithOutput);
    expect(body.missionSlug).toBe(fixtures.missionSlug);
    expect(body.plan.tasks).toHaveLength(1);
    expect(body.plan.tasks[0].output).toBe('found 3, refreshed 3, failed 0');
  });

  test('a run with a null plan column comes back as an empty task list, not a 500', async ({ request }) => {
    const { status, body } = await getJson(
      request,
      `/api/v1/mission-runs/${fixtures.runIdNullPlan}`,
      authHeader(fixtures.primaryToken),
    );

    expect(status).toBe(200);
    expect(body.id).toBe(fixtures.runIdNullPlan);
    expect(body.plan).toEqual({ tasks: [] });
  });

  test('rejects a request with no credential at all', async ({ request }) => {
    const { status, body } = await getJson(request, `/api/v1/mission-runs/${fixtures.runIdWithOutput}`);

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('a token from a different org gets 404, not the other org\'s data or a 403', async ({ request }) => {
    const { status, body } = await getJson(
      request,
      `/api/v1/mission-runs/${fixtures.runIdWithOutput}`,
      authHeader(fixtures.otherOrgToken),
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(body)).not.toContain('found 3, refreshed 3, failed 0');
  });
});
