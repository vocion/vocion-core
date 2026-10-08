import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { totpCode, totpStep } from '../../src/libs/identity/totp';

/**
 * Sign-in, end to end, through the real Auth.js cookie. Two-step: set it up
 * from the profile page (password first, then the first code), then sign in
 * again with the password and a code and land on the dashboard. The unit
 * tests stand Auth.js's `unstable_update` in with a mock; this is the one
 * place the reissued cookie is the real thing. Reset: a link whose token
 * rides in the fragment sets a new password and is spent.
 *
 * Needs the server's `VOCION_RATE_LIMIT=off` (set in playwright.config.ts) and
 * a credential vault key, which the config also sets.
 */

const SEED_SCRIPT = 'e2e/two-step/support/seed-two-step-fixtures.ts';
// Must match the seed script.
const PERSON = { email: 'two-step-person@e2e.test', password: 'two-step-e2e-pass-1' };
const RESETTER = { email: 'reset-person@e2e.test', newPassword: 'reset-e2e-new-pass-2' };
const RESET_TOKEN = 'e2e-two-step-reset-token-not-a-secret';

function seedFixtures(): void {
  try {
    execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr) {
      process.stderr.write(stderr);
    }
    throw new Error(`${SEED_SCRIPT} failed: ${stderr.trim().split('\n').at(-1) || String(error)}`);
  }
}

async function signInWithPassword(page: Page, login: { email: string; password: string } = PERSON): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(login.email);
  await page.getByLabel('Password', { exact: true }).fill(login.password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test.beforeAll(() => {
  seedFixtures();
});

test('set up two-step sign-in, then sign in with a password and a code', async ({ page }) => {
  await signInWithPassword(page);

  await expect(page).toHaveURL(/\/(?:w\/[^/]+\/)?dashboard/);

  await page.goto('/dashboard/profile');
  await page.getByRole('button', { name: 'Set up' }).click();

  // From the profile, the password comes first: a session alone cannot put
  // an authenticator in front of the owner's next sign-in.
  await page.getByLabel('Your password').fill(PERSON.password);
  await page.getByRole('button', { name: 'Continue' }).click();

  const key = page.locator('code').filter({ hasText: /^[A-Z2-7 ]{16,}$/ });

  await expect(key).toBeVisible();

  const secret = (await key.textContent() ?? '').replace(/\s/g, '');

  await page.getByLabel('Code from the app').fill(totpCode(secret, totpStep(new Date())));
  await page.getByRole('button', { name: 'Turn on' }).click();

  await expect(page.getByText('Save your recovery codes')).toBeVisible();

  await page.getByRole('button', { name: /I saved them/ }).click();

  await expect(page.getByText('Two-step sign-in is on.')).toBeVisible();

  // Turning it on ended every other session but kept this one.
  await page.reload();

  await expect(page.getByText(/On since/)).toBeVisible();

  // Sign in again from scratch: the password, then a code, then the dashboard.
  await page.context().clearCookies();
  await signInWithPassword(page);

  await expect(page.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();

  // The step the enrolment used is spent; the next one verifies within the drift window.
  await page.getByLabel('Code', { exact: true }).fill(totpCode(secret, totpStep(new Date()) + 1));
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page).toHaveURL(/\/(?:w\/[^/]+\/)?dashboard/);
  await expect(page.getByRole('button', { name: 'Switch workspace' }).filter({ visible: true })).toBeVisible();
});

test('a reset link carries its token in the fragment, drops it from the address bar, and sets the password', async ({ page }) => {
  // The fragment never reaches the server, so no access log holds the link.
  await page.goto(`/reset-password#token=${RESET_TOKEN}`);

  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');

  await page.getByLabel('New password', { exact: true }).fill(RESETTER.newPassword);
  await page.getByLabel('Confirm new password').fill(RESETTER.newPassword);
  await page.getByRole('button', { name: 'Set password' }).click();

  await expect(page.getByText('Password changed')).toBeVisible();

  await signInWithPassword(page, { email: RESETTER.email, password: RESETTER.newPassword });

  await expect(page).toHaveURL(/\/(?:w\/[^/]+\/)?dashboard/);

  // Spent: the same link now says so before anything is typed.
  await page.goto(`/reset-password#token=${RESET_TOKEN}`);

  await expect(page.getByText('This link has expired')).toBeVisible();
});
