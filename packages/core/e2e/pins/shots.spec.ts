import { execFileSync } from 'node:child_process';
import { devices, test } from '@playwright/test';

/**
 * Screenshots of the Pinned section, desktop and phone, for a pull request.
 * Only on demand: SHOTS_DIR=… SHOTS_LABEL=… npx playwright test --project=pins shots
 */

const OUT = process.env.SHOTS_DIR!;
const LABEL = process.env.SHOTS_LABEL ?? 'pins';

test.skip(!OUT, 'screenshots only on demand');

const NORTHWIND = '/w/e2e-pins-northwind/dashboard';

test('shots', async ({ browser }) => {
  const ids = JSON.parse(execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', 'e2e/pins/support/seed-pins-fixtures.ts'], { encoding: 'utf8' }).trim().split('\n').pop()!);
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 14'];
  for (const [name, options] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', iphone]] as const) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('pins@e2e.example');
    await page.getByLabel('Password', { exact: true }).fill('pins-e2e-pass-1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);
    if (name === 'desktop') {
      for (const path of [`artifacts/${ids.artifact}`, `rooms/${ids.room}`, `chat/${ids.conversation}`]) {
        await page.goto(`${NORTHWIND}/${path}`);
        const saved = page.waitForResponse(r => r.url().includes('/rpc/nav/pin'));
        await page.waitForTimeout(1500);
        if (path.startsWith('chat')) {
          await page.keyboard.press('ControlOrMeta+Shift+KeyP');
        } else {
          await page.getByTestId('pin-toggle').click();
        }
        await saved;
      }
      await page.goto(`${NORTHWIND}/rooms/${ids.room}`);
      await page.waitForTimeout(2500);
      await page.locator('[data-pin-key]').nth(1).hover();
      await page.screenshot({ path: `${OUT}/${LABEL}-desktop.png` });
    } else {
      await page.goto(`${NORTHWIND}/chat`);
      await page.waitForTimeout(2000);
      await page.getByRole('button', { name: /toggle sidebar/i }).first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${OUT}/${LABEL}-phone.png` });
    }
    await context.close();
  }
});
