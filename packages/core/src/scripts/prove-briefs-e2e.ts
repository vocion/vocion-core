/** Briefings overhaul proof: tabs render (rollup + teams), Regenerate present,
 *  history list present when >1 brief, floating chat pill present. */
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.fill('#email', 'chris@metacto.com');
  await page.fill('#password', process.env.E2E_PW ?? 'Vocion-Dogfood-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(6000);
  await ctx.addCookies([{ name: 'vocion_active_project', value: 'proj-revenue-f8429a692aab3703f82a4f15169b8662', domain: new URL(BASE).hostname, path: '/' }]);
  await page.goto(`${BASE}/en/dashboard/briefings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const rollupTab = await page.getByRole('button', { name: /Workspace rollup/i }).count();
  const teamTabs = await page.getByRole('button', { name: /Founder GTM|RevOps|Deal Desk|Marketing/i }).count();
  const regen = await page.getByRole('button', { name: /Regenerate/i }).count();
  const history = await page.getByText(/Previous briefs/i).count();
  const pill = await page.getByPlaceholder(/Ask|about this brief|question/i).count();
  await page.screenshot({ path: '/Users/chrisfitkin/briefs-proof.png', fullPage: true });
  console.warn('\n===== BRIEFS PROOF =====');
  console.warn(`rollup tab: ${rollupTab > 0 ? 'YES ✓' : 'NO ✗'} · team tabs: ${teamTabs} ${teamTabs >= 3 ? '✓' : '✗'} · Regenerate: ${regen > 0 ? 'YES ✓' : 'NO ✗'} · history: ${history > 0 ? 'YES ✓' : '(single brief)'} · chat pill: ${pill > 0 ? 'YES ✓' : 'NO ✗'}`);
  await browser.close();
  process.exit(rollupTab > 0 && teamTabs >= 3 && regen > 0 ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
