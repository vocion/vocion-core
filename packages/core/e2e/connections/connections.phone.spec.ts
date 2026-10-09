import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../../tests/TestUtils';

/**
 * The Connectors page on a phone, end to end (founder, 2026-10-09: "clear,
 * concise, simple, easy to use"). Three paths a person actually takes:
 *
 * 1. connect — find a connector in All connectors, paste its key, and see it
 *    Working at the top of the page;
 * 2. broken, then reconnect — the key is revoked, the row says so in plain
 *    words with Reconnect on it, and Reconnect puts it back to Working;
 * 3. disconnect with Undo — the row goes at once, Undo brings it back, and a
 *    disconnect left alone is deleted.
 *
 * Apollo is the connector because it never syncs: no vendor is ever called,
 * so nothing here depends on the network. Every key is a well-shaped fake.
 * Self-seeding, like the credentials spec. Run with:
 *
 *   npx playwright test --project=connections
 */

const ADMIN = {
  name: 'Dana Okafor',
  account: 'Northwind Connections',
  email: 'connections-e2e@northwind.example',
  secret: 'connections-e2e-secret-1',
};

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Run one of the repo's scripts the way the other e2e seeders do.
 * @param args - Arguments after `tsx`, starting with the script path.
 */
function run(args: string[]): void {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'], env: process.env });
}

test.describe.configure({ mode: 'serial' });

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeAll(() => {
  try {
    run(['tests/support/create-e2e-user.ts', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.secret, '--role', 'admin']);
  } catch (error) {
    tolerateExistingUser(error, '[connections spec]');
  }
  run(['e2e/connections/support/fixtures.ts', '--email', ADMIN.email, '--mode', 'fixtures']);
  // A disconnect keeps the stored key (it belongs to the vendor login, not the
  // row), so a database this spec ran on before would offer it back. Start clean.
  run(['e2e/connections/support/fixtures.ts', '--email', ADMIN.email, '--mode', 'revoke', '--platform', 'apollo']);
});

async function openConnectors(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard**');
  await page.goto('/dashboard/connectors');

  await expect(page.getByTestId('connector-list')).toBeVisible();
}

const apolloRow = (page: Page) => page.locator('[data-connector-row="apollo"]');

test('the page leads with what needs a person, says whose connections these are, and fits the phone', async ({ page }) => {
  await openConnectors(page);

  await expect(page.getByTestId('connectors-scope-line')).toContainText('Shared systems your team\'s agents use, connected by an admin.');
  // The connection that needs someone sorts first, its reason in words and its one fix beside it.
  await expect(page.locator('[data-connection]').first()).toHaveAttribute('data-status', 'attention');
  await expect(page.getByText('Needs attention: not signed in yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Jira' })).toBeVisible();
  await expect(page.locator('[data-status="paused"]')).toContainText('Paused');
  await expect(page.getByTestId('recommended-section')).toContainText('Software Factory needs it');

  // No sideways scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  expect(overflow).toBeLessThanOrEqual(0);
});

test('two kinds, one name each: Team connectors links to Personal connectors and back', async ({ page }) => {
  await openConnectors(page);

  await expect(page.getByText('Team connectors', { exact: true })).toBeVisible();
  await expect(page.getByTestId('connectors-scope-line')).toContainText('Shared systems your team\'s agents use');

  await page.getByRole('link', { name: 'Your own Gmail and calendar live in Personal connectors →' }).click();

  await expect(page.getByText('Personal connectors', { exact: true })).toBeVisible();
  await expect(page.getByTestId('connectors-scope-line')).toContainText('Yours only: read by your personal assistant and nobody else.');

  await page.getByRole('link', { name: 'Shared systems your team\'s agents use are in Team connectors →' }).click();

  await expect(page.getByText('Team connectors', { exact: true })).toBeVisible();
});

test('connect: find it, paste its key, and it is Working', async ({ page }) => {
  await openConnectors(page);

  await page.getByRole('searchbox', { name: 'Search connectors' }).fill('apollo');
  await page.getByRole('button', { name: 'Connect Apollo' }).click();

  await expect(page.getByText('Connect Apollo', { exact: true })).toBeVisible();

  await page.getByLabel('API key', { exact: true }).fill('apollo-e2e-key-0001');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await expect(apolloRow(page).getByTestId('connection-status')).toHaveText('Working');
});

test('broken, then reconnect: a revoked key says so in words, and Reconnect puts it back', async ({ page }) => {
  run(['e2e/connections/support/fixtures.ts', '--email', ADMIN.email, '--mode', 'revoke', '--platform', 'apollo']);
  await openConnectors(page);

  await expect(apolloRow(page).getByTestId('connection-status')).toHaveText('Needs attention: access was revoked');

  await page.getByRole('button', { name: 'Reconnect Apollo' }).click();

  await expect(page.getByText('Connect Apollo', { exact: true })).toBeVisible();

  await page.getByLabel('API key', { exact: true }).fill('apollo-e2e-key-0002');
  await page.getByRole('button', { name: 'Save credential' }).click();

  await expect(apolloRow(page).getByTestId('connection-status')).toHaveText('Working');
});

test('disconnect with Undo: it goes at once, Undo brings it back, and left alone it is deleted', async ({ page }) => {
  await openConnectors(page);
  const disconnect = async () => {
    await page.getByRole('button', { name: 'More for Apollo' }).click();
    await page.getByRole('menuitem', { name: 'Disconnect' }).click();
  };

  await disconnect();

  await expect(apolloRow(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(apolloRow(page)).toHaveCount(1);

  const deleted = page.waitForResponse(res => res.request().method() === 'DELETE' && /\/rpc\/sources\/\d+$/.test(res.url()), { timeout: 20_000 });
  await disconnect();

  expect((await deleted).ok()).toBe(true);

  await page.reload();

  await expect(page.getByTestId('connector-list')).toBeVisible();
  await expect(apolloRow(page)).toHaveCount(0);
});
