import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ADMIN, seedOnboardingWorkspace } from './support/seed';

/**
 * First-run workspace setup (#1028), against the scripted model.
 *
 * The opening message is written by the server, not the model, so the first
 * visit needs no script line; the one scripted turn
 * (`e2e/onboarding/scripts/onboarding.json`) runs `workspace_setup` and then
 * `offer_connection`. Start the server with `npm run e2e:onboarding`.
 */

test.beforeAll(() => {
  seedOnboardingWorkspace();
});

/**
 * Sign in and land on the dashboard.
 * @param page - The browser page.
 */
async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test('first admin visit opens setup once; the connect card goes to Sources with a way back', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/chat');
  await page.waitForURL(/conversation=\d+/);

  await expect(page.getByText('I\'ll set it up with you')).toBeVisible();

  const setupUrl = page.url();

  // A second visit is ordinary chat: setup opens once per workspace.
  await page.goto('/dashboard/chat');

  await expect(page.getByText('I\'ll set it up with you')).toHaveCount(0);

  await page.goto(setupUrl);
  await page.locator('textarea').last().fill('This is for Northwind engineering: ship the customer portal.');
  await page.getByRole('button', { name: 'Send message' }).last().click();
  const connect = page.getByTestId('recommended-action-open');

  await expect(connect).toHaveText('Connect GitHub');
  await expect(connect).toHaveAttribute('href', /\/dashboard\/connectors\?add=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D\d+/);

  await connect.click();
  await page.waitForURL(/\/dashboard\/connectors/);

  // The add-source form opens inline as a card headed "Add GitHub source", not as a dialog.
  await expect(page.getByRole('heading', { name: 'Add GitHub source' })).toBeVisible();
});
