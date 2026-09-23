import process from 'node:process';
import { chromium } from '@playwright/test';

const SP = process.env.SP!;
async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 760, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('https://agents.metacto.com/en/sign-in', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('#email', { state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.fill('#email', 'chris@metacto.com');
  await page.fill('#password', process.env.E2E_PW ?? 'Vocion-Dogfood-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(9000);
  await page.goto('https://agents.metacto.com/w/squatch-factory/dashboard/p/feature/121', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(7000);
  const m = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    sections: [...document.querySelectorAll('[data-section]')].map(e => e.getAttribute('data-section')),
    lifecycle: document.querySelector('ol[aria-label]')?.textContent?.trim() ?? null,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }));
  console.warn(JSON.stringify(m));
  await page.screenshot({ path: `${SP}/prod-final.png`, fullPage: true });
  await browser.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
