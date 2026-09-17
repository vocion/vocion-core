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

    expect(document.openapi).toBe('3.1.0');
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

    for (const path of paths.slice(0, 5)) {
      const anonymous = await request.get(path);

      expect(anonymous.status(), `${path} without a token`).toBe(401);

      const authenticated = await request.get(path, {
        headers: { authorization: `Bearer ${fixtures.token}` },
      });

      expect(authenticated.status(), `${path} with a token`).not.toBe(404);
      expect(
        Object.keys(document.paths[path].get.responses),
        `${path} documents the status it answered with`,
      ).toContain(String(authenticated.status()));
    }
  });
});

/**
 * The admin this spec signs in as. A fresh PGlite database has no users and
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
  test('is behind the login, like the rest of the dashboard', async ({ page }) => {
    await page.goto('/dashboard/api-reference');

    await expect(page).toHaveURL(/sign-in/);
  });

  test('renders the generated document for a signed-in reader, and searches it', async ({ page }) => {
    createBootstrapAdmin();

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard**');

    await page.goto('/dashboard/api-reference');

    // The count comes from the generated document, so this is the real spec
    // reaching the real page — not a fixture shaped like one.
    await expect(page.getByTestId('endpoint-count')).toContainText('endpoints');
    await expect(page.getByText('/api/v1/agents', { exact: true })).toBeVisible();

    await page.getByLabel('Search endpoints').fill('post worker-runs');

    await expect(page.getByTestId('endpoint-count')).toContainText('of');
    await expect(page.getByText('/api/v1/worker-runs/{id}/claim', { exact: true })).toBeVisible();
    await expect(page.getByText('/api/v1/agents', { exact: true })).toHaveCount(0);
  });
});
