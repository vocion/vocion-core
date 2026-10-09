import { test } from '@playwright/test';

const OUT = process.env.SHOTS_DIR!;
const LABEL = process.env.SHOTS_LABEL!;

test.skip(!OUT, 'screenshots only on demand');

for (const scheme of ['light', 'dark'] as const) {
  test(`shot ${scheme}`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    // next-themes reads `theme` from localStorage; the colour scheme alone is not enough (default is light).
    await context.addInitScript(t => localStorage.setItem('theme', t), scheme);
    const page = await context.newPage();
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('all-workspaces@e2e.example');
    await page.getByLabel('Password', { exact: true }).fill('all-workspaces-e2e-pass-1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto('/w/e2e-allws-northwind/dashboard/workspaces');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/${LABEL}-${scheme}.png`, fullPage: true });
    await context.close();
  });
}
