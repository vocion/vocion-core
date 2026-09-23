import process from 'node:process';
import { chromium } from '@playwright/test';

const SP = process.env.SP!;
async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name, url] of [['app', 'https://app.stampsend.com/'], ['site', 'https://stampsend.com/']] as const) {
    const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
    await page.waitForTimeout(4000);
    const m = await page.evaluate(() => ({
      title: document.title.slice(0, 70),
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 60) ?? null,
      buttons: [...document.querySelectorAll('button, a')].map(e => e.textContent?.trim()).filter(t => t && t.length < 30).slice(0, 12),
    }));
    console.warn(name, r?.status(), JSON.stringify(m));
    await page.screenshot({ path: `${SP}/stamp-${name}.png` });
  }
  await browser.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
