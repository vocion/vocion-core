import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * ALL WORKSPACES ON A PHONE (founder, 2026-10-09: "This isn't a great UI").
 *
 * Seeded by `support/seed-all-workspaces-fixtures.ts`: Northwind (busy, led
 * by Atlas, seven agents), Kestrel Ops (older, one ask of the person's), an
 * empty Bellwater Hall, a placeholder named the way migration 0022 named
 * them, an archived Old Pilot, and the person's Personal.
 */

const SEED_SCRIPT = 'e2e/all-workspaces/support/seed-all-workspaces-fixtures.ts';
const PERSON = { email: 'all-workspaces@e2e.example', password: 'all-workspaces-e2e-pass-1' };
// Visited through Northwind's own address, so Northwind is the current one.
const PAGE = '/w/e2e-allws-northwind/dashboard/workspaces';

test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  page = await browser.newPage();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(PERSON.email);
  await page.getByLabel('Password', { exact: true }).fill(PERSON.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
});

test.afterAll(async () => {
  await page.close();
});

const rows = () => page.getByTestId('workspace-row');

test('Personal first, then by recent use, the placeholder last, never a raw id', async () => {
  await page.goto(PAGE);

  await expect(rows().first()).toBeVisible();

  const names = await rows().evaluateAll(els => els.map(e => e.querySelector('span > span')?.textContent ?? ''));

  expect(names).toEqual(['Personal', 'Northwind', 'Kestrel Ops', 'Bellwater Hall', 'Northwind (placeholder)']);
  await expect(page.getByTestId('workspaces-page')).not.toContainText('proj-');
  await expect(rows().nth(1).getByTestId('workspace-row-line')).toHaveText(/^Atlas · 7 agents · active \d+[smh] ago$/);
  await expect(rows().nth(3).getByTestId('workspace-row-line')).toHaveText('Empty');
  // Where the person is, and what waits on them.
  await expect(rows().nth(1).getByTestId('workspace-row-current')).toBeVisible();
  await expect(rows().nth(2).getByTestId('workspace-row-waiting')).toHaveText('1');
});

test('archived ones wait behind "Show archived"', async () => {
  await expect(page.getByText('Old Pilot')).toHaveCount(0);

  await page.getByTestId('workspaces-show-archived').click();

  await expect(page.getByTestId('workspaces-archived')).toContainText('Old Pilot');
});

test('search filters as you type, by name or lead', async () => {
  await page.getByTestId('workspaces-search').fill('atl');

  await expect(rows()).toHaveCount(1);
  await expect(rows().first()).toContainText('Northwind');

  await page.getByTestId('workspaces-search').fill('kest');

  await expect(rows()).toHaveCount(1);
});

test('keyboard: / focuses search, arrows move, Enter opens', async () => {
  await page.goto(PAGE);

  await expect(rows().first()).toBeVisible();

  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('/');

  await expect(page.getByTestId('workspaces-search')).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');

  await expect(rows().nth(1)).toBeFocused();

  await page.keyboard.press('Enter');
  await page.waitForURL(/\/dashboard\/chat/);
});

test('tapping a row opens that workspace', async () => {
  await page.goto(PAGE);
  await rows().filter({ hasText: 'Kestrel Ops' }).tap();
  await page.waitForURL(/\/dashboard\/chat/);
  await page.goto('/dashboard/workspaces');

  await expect(rows().filter({ hasText: 'Kestrel Ops' }).getByTestId('workspace-row-current')).toBeVisible();
});
