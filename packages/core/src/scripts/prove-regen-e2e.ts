/** Regenerate polling proof: click Regenerate on Founder GTM, expect the
 *  Assembling state, then the fresh brief to land AUTOMATICALLY (no manual
 *  refresh) within 4 minutes. */
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
  await ctx.addCookies([{ name: 'vocion_active_project', value: 'proj-revenue-f8429a692aab3703f82a4f15169b6862'.replace('b6862', 'b8662'), domain: new URL(BASE).hostname, path: '/' }]);
  await page.goto(`${BASE}/en/dashboard/briefings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Founder GTM/i }).first().click();
  await page.waitForTimeout(800);
  const beforeTitle = await page.locator('h2').first().textContent();
  await page.getByRole('button', { name: /Regenerate/i }).click();
  await page.waitForTimeout(1500);
  const assembling = (await page.getByText(/assembling the brief/i).count()) > 0;
  console.warn(`assembling state: ${assembling ? 'YES ✓' : 'NO ✗'} (baseline: "${beforeTitle?.slice(0, 40)}")`);
  let landed = false;
  try {
    await page.getByText(/Fresh brief loaded/i).waitFor({ state: 'visible', timeout: 240_000 });
    landed = true;
  } catch { /* report */ }
  await page.waitForTimeout(1500);
  const afterTitle = await page.locator('h2').first().textContent();
  await page.screenshot({ path: '/Users/chrisfitkin/regen-proof.png', fullPage: true });
  console.warn('\n===== REGEN POLLING PROOF =====');
  console.warn(`assembling shown:      ${assembling ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`fresh brief auto-landed: ${landed ? 'YES ✓' : 'NO ✗'} ("${afterTitle?.slice(0, 40)}")`);
  await browser.close();
  process.exit(assembling && landed ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
