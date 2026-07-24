/** Nav toggle proof: Use view shows daily links only; Configure swaps to
 *  admin sections; choice persists across reload. */
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
  await page.waitForTimeout(2500);

  const nav = page.locator('[data-sidebar="sidebar"]').first();
  const useHasChat = (await nav.getByText('Chat', { exact: true }).count()) > 0;
  const useHidesTeams = (await nav.getByText('Teams', { exact: true }).count()) === 0;
  await page.screenshot({ path: '/Users/chrisfitkin/nav-use.png' });

  await page.getByRole('button', { name: /Configure/i }).click();
  await page.waitForTimeout(600);
  const cfgHasTeams = (await nav.getByText('Teams', { exact: true }).count()) > 0;
  const cfgHasSources = (await nav.getByText('Sources', { exact: true }).count()) > 0;
  const cfgHidesChat = (await nav.getByText('Chat', { exact: true }).count()) === 0;
  await page.screenshot({ path: '/Users/chrisfitkin/nav-configure.png' });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const persisted = (await nav.getByText('Teams', { exact: true }).count()) > 0;

  console.warn('\n===== NAV TOGGLE PROOF =====');
  console.warn(`USE: chat shown ${useHasChat ? '✓' : '✗'} · teams hidden ${useHidesTeams ? '✓' : '✗'}`);
  console.warn(`CONFIGURE: teams ${cfgHasTeams ? '✓' : '✗'} · sources ${cfgHasSources ? '✓' : '✗'} · chat hidden ${cfgHidesChat ? '✓' : '✗'}`);
  console.warn(`persists across reload: ${persisted ? 'YES ✓' : 'NO ✗'}`);
  await browser.close();
  process.exit(useHasChat && useHidesTeams && cfgHasTeams && cfgHasSources && cfgHidesChat && persisted ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
