import type { Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { expect } from '@playwright/test';

/**
 * The Auth.js E2E identity and the two things you can do with it: put it in
 * the database, and sign it in through the real sign-in form.
 *
 * This replaces a harness built for a hosted auth provider this app does not
 * use. `libs/Auth.ts` is auth.js (next-auth v5) with a Credentials provider
 * over bcrypt hashes and `@auth/drizzle-adapter`, and `routers/AuthGuards.ts`
 * reads that session. There is no hosted sign-up widget to drive, no test
 * email subaddressing and no canned verification code, so the fixture drives
 * what does exist:
 *
 *   seedAdminUser() — writes the user, tenant account and default project
 *                     straight to the database via
 *                     `src/scripts/create-local-user.ts`. The web `/api/signup`
 *                     route is invite-only, so this is the only way to make a
 *                     first admin, and it is how the `tour`, `queue`,
 *                     `learning` and `credentials` projects already do it.
 *   signIn()        — fills `/sign-in` and waits for `/dashboard`. That posts
 *                     to the Credentials provider, so the browser ends up
 *                     holding the same `authjs.session-token` cookie a real
 *                     user gets, and `auth()` resolves the same tenancy
 *                     (accountId / projectId / role) for it. No token is
 *                     forged: the session is issued by the app under test.
 *   deleteAdminUser() — removes the seeded user again (see
 *                     `tests/support/delete-e2e-user.ts`).
 */
export const E2E_ADMIN = {
  name: 'E2E Admin',
  account: 'E2E Test Co',
  email: 'e2e-admin@example.test',
  password: 'e2e-admin-1',
};

/**
 * Run a test-support script the way the rest of the E2E tree does: outside the
 * Next process, through `dotenv -c` so it reads the same `.env.local` the app
 * under test reads and therefore reaches the same database.
 * @param script - Path to the script, relative to `packages/core`.
 * @param args - Arguments passed through to the script.
 */
const runSupportScript = (script: string, args: string[]) => {
  // stderr is captured rather than inherited so a failure can be classified
  // (see `tolerateExistingUser`), then echoed so the run log still shows what
  // the script printed.
  const result = spawnSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'pipe'],
  });
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    const error = new Error(`${script} exited with ${result.status ?? result.signal}`) as Error & { stderr: string };
    error.stderr = result.stderr ?? '';
    throw error;
  }
};

/**
 * Decide what a failed `user:create` / `create-local-user` run means.
 *
 * `create-local-user.ts` refuses to overwrite a user and exits non-zero saying
 * `user already exists`, which is the normal case on a database that has
 * already run the suite (`db-server:file`, or a reused dev server). Every spec
 * signs in rather than signs up, so that run is still valid and the caller
 * only logs it. Any other failure (no database, a migration missing, a typo
 * in the arguments) used to be swallowed the same way and only showed up
 * minutes later as a sign-in timeout; now it is rethrown with the script's
 * own last stderr line, so the Playwright annotation names the real cause.
 * Works with `stdio: 'pipe'` (stderr captured on the error) and with
 * `stdio: 'inherit'` (stderr already on the console, only the message left).
 * @param error - What `execFileSync` threw.
 * @param label - The spec's log prefix, e.g. `[queue spec]`.
 */
export const tolerateExistingUser = (error: unknown, label: string): void => {
  // `stderr` is a Buffer under `stdio: 'pipe'` and a string under `encoding: 'utf8'`.
  const stderr = (error as { stderr?: { toString: () => string } }).stderr?.toString() ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (`${message}\n${stderr}`.includes('already exists')) {
    console.warn(`${label} user:create made no user: it already exists`);
    return;
  }
  const lastLine = stderr.trim().split('\n').at(-1) || message;
  throw new Error(`${label} user:create failed: ${lastLine}`);
};

/**
 * Create the E2E admin, its tenant account and its default project.
 * "Already exists" is tolerated, anything else fails the setup project; see
 * `tolerateExistingUser`.
 */
export const seedAdminUser = () => {
  try {
    runSupportScript('src/scripts/create-local-user.ts', [
      '--email',
      E2E_ADMIN.email,
      '--name',
      E2E_ADMIN.name,
      '--account',
      E2E_ADMIN.account,
      '--password',
      E2E_ADMIN.password,
      '--role',
      'admin',
    ]);
  } catch (error) {
    tolerateExistingUser(error, '[e2e setup]');
  }
};

/**
 * Sign the E2E admin in through the app's own sign-in form, leaving `page`
 * holding a genuine auth.js session cookie.
 *
 * `getByLabel('Password', { exact: true })` on purpose: the form also carries
 * a "Show password" / "Hide password" toggle, and a loose match hits both.
 * @param page - The Playwright page to sign in.
 */
export const signIn = async (page: Page) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(E2E_ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  await expect(page).toHaveURL(/\/dashboard/);
};

/**
 * Remove the seeded E2E admin. Deleting the `user` row cascades its
 * `account_membership`, `session` and `auth_account` rows (all
 * `onDelete: 'cascade'` in `models/Schema.ts`), so the identity is gone;
 * the tenant account and project are named constants and are left in place
 * for the next run to reuse.
 *
 * A CI run uses `db-server:memory`, so nothing survives the run anyway — this
 * exists so a local `db-server:file` database stays repeatable.
 */
export const deleteAdminUser = () => {
  runSupportScript('tests/support/delete-e2e-user.ts', ['--email', E2E_ADMIN.email]);
};
