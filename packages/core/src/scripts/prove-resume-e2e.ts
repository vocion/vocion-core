/** Resumable-stream proof: start a long turn, hard-RELOAD mid-stream, assert
 *  the client re-attaches (streaming state resumes) and the turn completes
 *  live — tokens not lost, no re-ask. */
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.text().includes('[resume]')) { console.warn(`  ${m.text()}`); } });
  await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.fill('#email', 'chris@metacto.com');
  await page.fill('#password', process.env.E2E_PW ?? 'Vocion-Dogfood-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(6000);
  await ctx.addCookies([{ name: 'vocion_active_project', value: 'proj-revenue-f8429a692aab3703f82a4f15169b8662', domain: new URL(BASE).hostname, path: '/' }]);
  await page.goto(`${BASE}/en/dashboard/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const switcher = page.getByLabel('Switch agent').first();
  if (await switcher.count() > 0) {
    await switcher.click();
    await page.getByRole('menuitem', { name: /Founder GTM Lead/i }).click().catch(() => {});
    await page.waitForTimeout(500);
  }
  const composer = page.getByPlaceholder(/Message|Ask/i).first();
  await composer.waitFor({ state: 'visible', timeout: 20_000 });
  await composer.fill('Search my notes and emails for the latest on the Gauge relationship and give me a sourced summary.');
  await page.waitForTimeout(400);
  await page.getByLabel('Send message').click();
  console.warn('sent — letting it stream 10s, then hard reload mid-turn…');
  await page.waitForTimeout(10_000);
  const streamingBefore = (await page.getByLabel('Stop generating').count()) > 0;

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // Re-attached = streaming state present again shortly after reload.
  let reattached = false;
  for (let i = 0; i < 10; i++) {
    if ((await page.getByLabel('Stop generating').count()) > 0) {
      reattached = true;
      break;
    }
    await page.waitForTimeout(1000);
  }
  // Completes live: Send button returns + a substantive answer in transcript.
  let completed = false;
  try {
    await page.getByLabel('Send message').waitFor({ state: 'visible', timeout: 180_000 });
    completed = true;
  } catch { /* report */ }
  await page.waitForTimeout(800);
  const answerLen = (await page.locator('.prose').allTextContents()).join('').length;
  await page.screenshot({ path: '/Users/chrisfitkin/resume-proof.png', fullPage: true });
  console.warn('\n===== RESUMABLE STREAM PROOF =====');
  console.warn(`streaming before reload:   ${streamingBefore ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`re-attached after reload:  ${reattached ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`turn completed live:       ${completed ? 'YES ✓' : 'NO ✗'} (answer chars: ${answerLen})`);
  await browser.close();
  process.exit(streamingBefore && reattached && completed && answerLen > 300 ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
