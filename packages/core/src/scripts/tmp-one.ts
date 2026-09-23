import process from 'node:process';
import { chromium } from '@playwright/test';

const SP = process.env.SP!;
async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('https://agents.metacto.com/en/sign-in', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('#email', { state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.fill('#email', 'chris@metacto.com');
  await page.fill('#password', process.env.E2E_PW ?? 'Vocion-Dogfood-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(8000);
  await page.goto(process.env.TARGET!, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(6000);
  const m = await page.evaluate(() => ({
    state: document.querySelector('#report-state')?.textContent?.trim().slice(0, 120) ?? null,
    sticky: !!document.querySelector('[data-testid="report-sticky-action"]'),
    technical: !!document.querySelector('#report-technical'),
    images: document.querySelectorAll('#report-visuals img').length,
    figures: document.querySelectorAll('#report-visuals figure').length,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    docScroll: document.documentElement.scrollHeight,
  }));
  console.warn(JSON.stringify(m, null, 1));
  await page.screenshot({ path: `${SP}/${process.env.NAME}.png`, fullPage: true });
  await browser.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
