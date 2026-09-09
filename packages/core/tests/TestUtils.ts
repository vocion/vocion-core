import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
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
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', script, ...args], { stdio: 'inherit' });
};

/**
 * Create the E2E admin, its tenant account and its default project.
 *
 * Tolerates "already exists": `create-local-user.ts` refuses to overwrite a
 * user and exits non-zero, which is the normal case on a database that has
 * already run the suite (`db-server:file`, or a reused dev server). Every
 * spec signs in rather than signs up, so that run is still valid — and a real
 * failure here surfaces as the sign-in failing, with this line naming it.
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
    console.warn(`[e2e setup] create-local-user made no user: ${error instanceof Error ? error.message : String(error)}`);
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
