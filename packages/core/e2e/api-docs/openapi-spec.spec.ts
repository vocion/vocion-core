import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../../tests/TestUtils';

/**
 * #396 — the published API description, end to end.
 *
 * A spec is only worth anything if it matches the server, so this does not
 * stop at "the endpoint returns JSON". It reads the document from the running
 * app, then calls endpoints the document describes and checks the app answers
 * the way the document said it would: the same auth, the same status, the same
 * error envelope. A generated spec that had drifted from the code would fail
 * here rather than in a client's integration.
 *
 * Uses Playwright's `request` fixture for the API, and one browser check that
 * the reference page is behind the login like the rest of the dashboard.
 *
 * Run with: npx playwright test --project=api-docs
 */

type SeedFixtures = { orgId: string; token: string };

const SEED_SCRIPT = 'e2e/api-docs/support/seed-api-docs-fixtures.ts';

/** Seed a tenant with one API token, the way the other API specs do. */
function seedFixtures(): SeedFixtures {
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

/**
 * Endpoints this spec describes but never calls.
 *
 * `/api/v1/vision/model` reports the configured vision model by asking the
 * vendor — a live Rekognition call on a deployment that has AWS credentials.
 * Tests do not call out to a paid third-party service, so this one is checked
 * for its auth gate and left alone. Everything else in the sweep answers from
 * the database.
 */
const OUTWARD_CALLING_PATHS = new Set(['/api/v1/vision/model']);

let fixtures: SeedFixtures;

test.beforeAll(() => {
  fixtures = seedFixtures();
});

test.describe('GET /api/v1/openapi', () => {
  test('refuses an anonymous caller with the shared error envelope', async ({ request }) => {
    const response = await request.get('/api/v1/openapi');

    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: expect.any(String), details: null },
    });
  });

  test('serves the OpenAPI document to a token holder', async ({ request }) => {
    const response = await request.get('/api/v1/openapi', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    });

    expect(response.status()).toBe(200);

    const document = await response.json();

    expect(document.openapi).toBe('3.0.3');
    expect(document.info.title).toBe('Vocion API');
    expect(document.components.securitySchemes.bearerToken.scheme).toBe('bearer');
    expect(Object.keys(document.paths).length).toBeGreaterThan(20);
  });

  test('describes endpoints that really exist, with the auth it says they need', async ({ request }) => {
    const document = await (await request.get('/api/v1/openapi', {
      headers: { authorization: `Bearer ${fixtures.token}` },
    })).json();

    // A GET with no path parameters is one the spec claims can be called as
    // written — so call it, both ways, and hold the app to the document.
    const paths: string[] = Object.entries(document.paths as Record<string, Record<string, unknown>>)
      .filter(([path, methods]) => 'get' in methods && !path.includes('{'))
      .map(([path]) => path);

    expect(paths.length).toBeGreaterThan(5);

    // Every one of them, not a sample: the endpoints this would have skipped
    // are exactly the ones nobody checks by hand either.
    for (const path of paths) {
      const anonymous = await request.get(path);

      expect(anonymous.status(), `${path} without a token`).toBe(401);

      if (OUTWARD_CALLING_PATHS.has(path)) {
        // The auth gate is the part worth proving here; calling it for real
        // would spend a vendor's API on a test run.
        continue;
      }

      const authenticated = await request.get(path, {
        headers: { authorization: `Bearer ${fixtures.token}` },
      });

      expect(authenticated.status(), `${path} with a token`).not.toBe(404);

      const operation = document.paths[path].get;
      const status = authenticated.status();
      if ((operation.description ?? '').includes('shared error mapper')) {
        // The document says out loud that this endpoint can answer beyond the
        // statuses it lists — its failures come from a service and carry their
        // own status, which no reading of the handler can predict. So hold it
        // to the part that is promised: the shared error envelope.
        if (status >= 400) {
          expect(await authenticated.json(), `${path} keeps the error envelope`).toHaveProperty('error.code');
        }
        continue;
      }

      expect(
        Object.keys(operation.responses),
        `${path} documents the status it answered with`,
      ).toContain(String(status));
    }
  });
});

/**
 * The admin this spec signs in as. A fresh database has no users and
 * the signup route is invite-only, so the spec bootstraps its own the way the
 * credentials spec does.
 */
const ADMIN = {
  name: 'API Docs Reader',
  account: 'API Docs Co',
  email: 'api-docs@example.test',
  password: 'api-docs-e2e-1',
};

/** Create the admin, tolerating the rerun where it already exists. */
function createBootstrapAdmin(): void {
  try {
    execFileSync(
      'npx',
      [
        'dotenv',
        '-c',
        '--',
        'npx',
        'tsx',
        'src/scripts/create-local-user.ts',
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
      { stdio: ['ignore', 'inherit', 'pipe'] },
    );
  } catch (error) {
    tolerateExistingUser(error, '[api-docs spec]');
  }
}

test.describe('the API reference page', () => {
  test('is behind the login, like the rest of the app', async ({ page }) => {
    await page.goto('/api-docs');

    await expect(page).toHaveURL(/sign-in/);
  });

  test('renders the generated document as Swagger UI for a signed-in reader', async ({ page }) => {
    createBootstrapAdmin();

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard**');

    // The reference is reachable from the app rather than only by URL: the
    // sidebar's manage view carries one "Swagger Docs" row under Organization,
    // and it is how a reader gets there without being told the path.
    await page.getByTestId('manage-workspace-row').click();

    const navLink = page.getByRole('link', { name: 'Swagger Docs' });

    await expect(navLink).toBeVisible();

    await navLink.click();
    await page.waitForURL('**/api-docs**');

    // Swagger UI itself, on its own page: no dashboard sidebar around it.
    await expect(page.locator('.swagger-ui')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);

    // The operations come from the generated document, so this is the real
    // spec reaching the real page — not a fixture shaped like one.
    await expect(page.locator('.opblock').first()).toBeVisible();
    await expect(page.locator('.opblock-summary-path').filter({ hasText: '/api/v1/agents' }).first()).toBeVisible();

    // The Authorize button is how a reader pastes a tenant token before
    // trying an endpoint; no button means the security scheme did not survive.
    await expect(page.getByRole('button', { name: /authorize/i }).first()).toBeVisible();

    // "Try it out" is read-only here: an Execute runs against this deployment
    // with the reader's own session, so a POST offering that button would be
    // a real write started by someone who opened the page to read.
    const firstGet = page.locator('.opblock-get').first();
    await firstGet.locator('.opblock-summary').click();

    // An expanded operation must actually resolve. Swagger UI renders a
    // spinner while it resolves the document and shows no error if the resolve
    // throws — which is exactly what a 3.1 document did here, leaving every
    // operation spinning forever. The Responses table is the proof it finished.
    await expect(firstGet.locator('.responses-table')).toBeVisible();
    await expect(firstGet.locator('.opblock-loading-animation')).toHaveCount(0);

    // `tryItOutEnabled` puts an expanded operation straight into try-out mode,
    // so the control to look for is Execute itself.
    await expect(firstGet.getByRole('button', { name: 'Execute' })).toBeVisible();

    // Authorize with a real tenant token and run a read-only call, which is
    // the whole point of the page: a reader who cannot try an endpoint from
    // here has only a document they could have read as JSON. Executing proves
    // the security scheme, the server URL and the request Swagger UI builds
    // all line up with what the API accepts.
    await page.getByRole('button', { name: /authorize/i }).first().click();
    await page.locator('.modal-ux input[type="text"]').first().fill(fixtures.token);
    await page.locator('.modal-ux .auth-btn-wrapper button.authorize').click();
    await page.locator('.modal-ux .btn-done').click();

    // `firstGet` is `GET /api/v1/agents` and is already open, so run it there
    // rather than expanding a second operation.
    await expect(firstGet.locator('.opblock-summary-path')).toContainText('/api/v1/agents');

    await firstGet.getByRole('button', { name: 'Execute' }).click();

    const liveResponse = firstGet.locator('.live-responses-table');

    await expect(liveResponse).toBeVisible();
    // The table's first `.response-col_status` is its "Code" header, so read
    // the body row instead.
    await expect(liveResponse.locator('tbody .response-col_status').first()).toHaveText('200');
    await expect(firstGet.locator('.curl')).toContainText(`Bearer ${fixtures.token}`);
    // The body the API really returned, not the documented example: the token
    // belongs to a workspace seeded with no agents, so `agents` is the key the
    // list endpoint answers with.
    await expect(liveResponse.locator('tbody .response-col_description')).toContainText('"agents"');

    const firstPost = page.locator('.opblock-post').first();
    await firstPost.locator('.opblock-summary').click();

    await expect(firstPost.locator('.opblock-body')).toBeVisible();
    await expect(firstPost.getByRole('button', { name: 'Execute' })).toHaveCount(0);
  });
});
