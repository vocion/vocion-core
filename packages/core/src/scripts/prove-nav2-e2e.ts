/** Nav v2 + citations-tab proof: bottom workspace row (no top switcher, no
 *  mode toggle), menu carries manage links, nav has only daily items; and the
 *  expanded trace shows Steps/Sources TABS instead of a long Grounded-in. */
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.fill('#email', 'chris@metacto.com');
  await page.fill('#password', process.env.E2E_PW ?? 'Vocion-Dogfood-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(6000);
  await ctx.addCookies([{ name: 'vocion_active_project', value: 'proj-revenue-f8429a692aab3703f82a4f15169b8662', domain: new URL(BASE).hostname, path: '/' }]);
  await page.goto(`${BASE}/en/dashboard/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const nav = page.locator('[data-sidebar="sidebar"]').first();
  const noToggle = (await nav.getByRole('button', { name: /^Configure$/ }).count()) === 0;
  const dailyOnly = (await nav.getByText('Chat', { exact: true }).count()) > 0 && (await nav.getByText('Sources', { exact: true }).count()) === 0;
  const wsRow = page.getByLabel('Workspace and settings');
  const hasRow = (await wsRow.count()) > 0;
  await page.screenshot({ path: '/Users/chrisfitkin/nav2-work.png' });
  let menuHasManage = false;
  if (hasRow) {
    await wsRow.click();
    await page.waitForTimeout(700);
    const items = await page.getByRole('menuitem').count();
    const hasManage = (await page.getByRole('menuitem', { name: /Manage workspace/i }).count()) > 0;
    // Manage swaps the SIDEBAR into config nav (Sources lives there, not here).
    await page.getByRole('menuitem', { name: /Manage workspace/i }).click();
    await page.waitForTimeout(800);
    const sidebarHasSources = (await nav.getByText('Sources', { exact: true }).count()) > 0;
    const canGoBack = (await nav.getByText(/Back to work/i).count()) > 0;
    menuHasManage = hasManage && items <= 6 && sidebarHasSources && canGoBack;
    console.warn(`  menu items: ${items} (tiny ✓ if <=6) · sidebar Sources: ${sidebarHasSources} · back: ${canGoBack}`);
    await page.screenshot({ path: '/Users/chrisfitkin/nav2-menu.png' });
    await page.keyboard.press('Escape');
  }

  // Citations tab: ask something that searches, expand the trace.
  const composer = page.getByPlaceholder(/Message|Ask/i).first();
  await composer.fill('Search my notes for the latest on Gauge and give me a sourced summary.');
  await page.waitForTimeout(400);
  await page.getByLabel('Send message').click();
  await page.getByText(/Worked it out ·/i).first().waitFor({ state: 'visible', timeout: 240_000 });
  await page.getByText(/Worked it out ·/i).first().click();
  await page.waitForTimeout(1000);
  const hasTabs = (await page.getByRole('button', { name: /^Steps/ }).count()) > 0 && (await page.getByRole('button', { name: /^Sources \(/ }).count()) > 0;
  const groundedGone = (await page.getByText(/^GROUNDED IN$/i).count()) === 0;
  await page.getByRole('button', { name: /^Sources \(/ }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/Users/chrisfitkin/nav2-citetab.png', fullPage: true });

  console.warn('\n===== NAV v2 + CITATIONS TAB =====');
  console.warn(`no mode toggle in nav:      ${noToggle ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`nav = daily items only:     ${dailyOnly ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`bottom workspace row:       ${hasRow ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`menu carries manage links:  ${menuHasManage ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`trace has Steps/Sources tabs: ${hasTabs ? 'YES ✓' : 'NO ✗'} · long Grounded-in gone: ${groundedGone ? 'YES ✓' : 'NO ✗'}`);
  await browser.close();
  process.exit(noToggle && dailyOnly && hasRow && menuHasManage && hasTabs ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
