import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * AN APP OPENS ON ITS HOME (founder, 2026-10-30): a person who landed on an
 * empty SEO chat did not know what to do first. The SEO home leads with a
 * greeting and an ask bar, the tiles to start from, what waits on the person
 * (decided right there), and how each client stands, every figure linked and
 * dated. A workspace with nothing yet sees the ask bar and the first tile.
 *
 * Self-seeding like `needs-you`: two admins of their own, and the data filed
 * straight into the database (`support/seed-seo-home.ts`).
 *
 * Run with: npx playwright test --project=app-home
 */

const BUSY = { name: 'Harper Home', account: 'Home Busy E2E Co', email: 'app-home-busy@example.test', password: 'app-home-busy-1' };
const EMPTY = { name: 'Rowan Home', account: 'Home Empty E2E Co', email: 'app-home-empty@example.test', password: 'app-home-empty-1' };
const SEED = 'e2e/app-home/support/seed-seo-home.ts';
const HOME = '/dashboard/apps/seo/home';

function createAdmin(person: typeof BUSY): void {
  try {
    execFileSync('npm', ['run', '--silent', 'user:create:e2e', '--', '--email', person.email, '--name', person.name, '--account', person.account, '--password', person.password, '--role', 'admin'], { stdio: 'pipe' });
  } catch (error) {
    const text = String((error as { stderr?: unknown }).stderr ?? '');
    if (!/already|exists/i.test(text)) {
      throw new Error(`user:create failed: ${text.trim().split('\n').at(-1) ?? error}`);
    }
  }
}

function seed(): void {
  try {
    execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED, '--email', BUSY.email, '--empty-email', EMPTY.email], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const err = error as { stderr?: unknown };
    throw new Error(`${SEED} failed: ${String(err.stderr ?? '').trim().split('\n').at(-1) ?? error}`);
  }
}

async function signIn(page: Page, person: typeof BUSY): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.includes('sign-in'));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  createAdmin(BUSY);
  createAdmin(EMPTY);
  seed();
});

test('the SEO home leads with the greeting, the tiles, what needs you and each client, and decides in place', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await signIn(page, BUSY);
  await page.goto(HOME);

  const home = page.getByTestId('app-home');

  await expect(home.getByRole('heading', { level: 1 })).toHaveText('SEO');
  await expect(page.getByTestId('home-ask-bar').getByRole('textbox')).toHaveAttribute('placeholder', 'Ask the SEO team…');

  // Start something: the six tiles, in the manifest's order.
  const tiles = page.getByTestId('home-start').getByTestId('home-tile');

  await expect(tiles).toHaveCount(6);
  await expect(tiles.first()).toContainText('Plan the next pages');
  await expect(tiles.first()).toHaveAttribute('data-primary', 'true');

  // Each client, every figure linked and dated.
  const client = page.getByTestId('home-project').filter({ hasText: 'Northwind Outfitters' });

  await expect(client).toBeVisible();
  await expect(client.getByTestId('home-measure-live')).toContainText('2');
  await expect(client.getByTestId('home-measure-live')).toContainText('of 8');
  await expect(client.getByTestId('home-measure-live')).toContainText('as of');
  await expect(client.getByTestId('home-measure-findings')).toContainText('High 1 · Medium 3 · Low 2');
  await expect(client.getByTestId('home-measure-goal')).toContainText('2 of 5 milestones done');
  await expect(client.getByTestId('home-measure-ranking')).toContainText('of 2');
  await expect(client.getByTestId('home-measure-prompts')).toContainText('1');
  await expect(page.getByTestId('home-recent')).toContainText('Trail shoes brief');

  // The nav: Home first, then Chat, then the app's own pages.
  const navRows = page.locator('[data-sidebar="menu-button"]');

  await expect(navRows.first()).toContainText('Home');
  await expect(navRows.nth(1)).toContainText('Chat');

  // Needs you: the go-live decision, decided on its card without leaving.
  const needsYou = page.getByTestId('home-needs-you');

  await expect(needsYou).toContainText('Go live with the Trail shoes pages?');

  // The homepage previews a decision; its controls are disclosed intentionally.
  await expect(needsYou.getByTestId('decision-submit')).toBeHidden();

  await needsYou.locator('summary').click();

  // The existing decision form still requires an explicit submit.
  await expect(needsYou.getByTestId('decision-option-live')).toHaveAttribute('aria-selected', 'true');

  await needsYou.getByTestId('decision-submit').click();

  await expect(page.getByTestId('home-decided')).toContainText('Chose Go live');

  await page.reload();

  await expect(page.getByTestId('home-needs-you')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('the ask bar starts a chat in the app, with the words sent', async ({ page, context }) => {
  await signIn(page, BUSY);
  await page.goto(HOME);
  const bar = page.getByTestId('home-ask-bar').getByRole('textbox');
  await bar.fill('Which pages are waiting on me?');
  await bar.press('Enter');

  await page.waitForURL(url => url.pathname.endsWith('/dashboard/chat'));

  await expect(page.getByText('Which pages are waiting on me?').first()).toBeVisible();

  // The turn is said in the SEO app: routing reads this cookie (#1529).
  const cookie = (await context.cookies()).find(c => c.name === 'vocion_nav_app');

  expect(decodeURIComponent(cookie?.value ?? '')).toMatch(/:seo$/);
});

test('a workspace with nothing yet sees the ask bar and the first tile, with one line on what the app does', async ({ page }) => {
  await signIn(page, EMPTY);
  await page.goto(HOME);

  await expect(page.getByTestId('app-home')).toHaveAttribute('data-empty', 'true');
  await expect(page.getByTestId('home-about')).not.toBeEmpty();
  await expect(page.getByTestId('home-tile')).toHaveCount(1);
  await expect(page.getByTestId('home-tile')).toContainText('Onboard your first client');
  await expect(page.getByTestId('home-start')).toHaveCount(0);
  await expect(page.getByTestId('home-ask-bar')).toBeVisible();
});

test('on a phone launch actions stay readable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, BUSY);
  await page.goto(HOME);
  const tiles = page.getByTestId('home-start').getByTestId('home-tile');

  await expect(tiles).toHaveCount(6);

  const [a, b] = await Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox()]);

  expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
  expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
  expect(a!.x + a!.width).toBeLessThanOrEqual(390);
});
