import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { test } from '@playwright/test';

/**
 * The screenshots in `docs/guides/goals.md`, on demand only:
 *   SHOTS_DIR=../../docs/guides/images/goals npx playwright test --project=goals shots
 * A phone (390×844) and a desktop (1440×900) of the workspace list, a goal's
 * page and "Your goals" in Personal. Seeded by `support/seed-goals-fixtures.ts`
 * (fictional: Northwind Trading).
 */

const OUT = process.env.SHOTS_DIR;
const PERSON = { email: 'goals@e2e.example', password: 'goals-e2e-pass-1' };

test.skip(!OUT, 'screenshots only on demand');

const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
] as const;

let personalSlug = '';

test.beforeAll(() => {
  const out = execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', 'e2e/goals/support/seed-goals-fixtures.ts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  personalSlug = (JSON.parse(out.trim().split('\n').at(-1)!) as { personalSlug: string }).personalSlug;
});

for (const size of SIZES) {
  test(`goals on a ${size.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: size.deviceScaleFactor, isMobile: size.isMobile, hasTouch: size.hasTouch, colorScheme: 'light' });
    await context.addInitScript(() => localStorage.setItem('theme', 'light'));
    const page = await context.newPage();
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(PERSON.email);
    await page.getByLabel('Password', { exact: true }).fill(PERSON.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);

    const settle = async () => {
      // Never networkidle: the shell polls for live updates and never goes idle.
      await page.waitForTimeout(1500);
    };
    await page.goto('/w/e2e-goals-gtm/dashboard/goals');
    const everyone = page.getByRole('button', { name: /Everyone/ }).first();
    if (await everyone.isVisible().catch(() => false)) {
      await everyone.click();
    }
    await settle();
    await page.screenshot({ path: `${OUT}/goals-list-${size.name}.png` });

    await page.getByTestId('goal-row').filter({ hasText: 'Northwind Expo' }).click();
    await page.getByTestId('goal-page').waitFor();
    await settle();
    await page.screenshot({ path: `${OUT}/goal-page-${size.name}.png`, fullPage: size.name === 'phone' });

    await page.goto('/w/e2e-goals-gtm/dashboard/goals');
    await page.getByTestId('goal-row').filter({ hasText: 'Expand vertical GTM strategy' }).click();
    await page.getByTestId('goal-page').waitFor();
    await settle();
    await page.screenshot({ path: `${OUT}/goal-milestones-${size.name}.png`, fullPage: size.name === 'phone' });

    await page.goto(`/w/${personalSlug}/dashboard/goals`);
    await settle();
    await page.screenshot({ path: `${OUT}/your-goals-${size.name}.png` });
    await context.close();
  });
}
