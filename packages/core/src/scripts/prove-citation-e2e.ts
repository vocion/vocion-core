/**
 * Real-browser proof for inline citations: ask a question that forces search,
 * wait for the answer to render, confirm tappable [n] superscripts exist, tap
 * one, and confirm the Sources drawer opens focused on that source.
 *
 *   bash /Users/chrisfitkin/vc.sh cite-e2e
 */
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
const EMAIL = 'chris@metacto.com';
const PW = process.env.E2E_PW ?? 'Vocion-Dogfood-2026!';
const MSG = process.env.E2E_MSG ?? 'Search my notes and emails for the latest on the Gauge relationship and give me a sourced summary.';
const SHOT = '/Users/chrisfitkin/citation-proof.png';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#email', { state: 'visible' });
  await page.waitForTimeout(1500);
  await page.fill('#email', EMAIL);
  await page.fill('#password', PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(6000);
  if (!page.url().includes('/dashboard')) {
    console.warn(`login failed url=${page.url()}`);
    await browser.close();
    process.exit(3);
  }
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
  await composer.fill(MSG);
  await page.waitForTimeout(400);
  await page.getByLabel('Send message').click();
  console.warn('sent — waiting for the answer + inline citations (~80s)…');

  // Wait for the answer to finish (a citation superscript button appears).
  const cite = page.locator('button[aria-label^="Open source"]').first();
  let hasCites = false;
  try {
    await cite.waitFor({ state: 'visible', timeout: 200_000 });
    hasCites = true;
  } catch { /* report below */ }

  let citeCount = 0;
  let drawerOpened = false;
  let focused = false;
  let detailOpened = false;
  let backWorked = false;
  if (hasCites) {
    citeCount = await page.locator('button[aria-label^="Open source"]').count();
    await cite.scrollIntoViewIfNeeded();
    await cite.click();
    await page.waitForTimeout(1200);
    drawerOpened = (await page.getByText(/\d+ document/i).count()) > 0;
    focused = (await page.locator('[class*="ring-brand-amber"]').count()) > 0;

    // Deeper UX: tap a source card → detail slide-over ("Open in …" + back).
    const card = page.getByRole('button', { name: /Details/i }).first();
    if (await card.count() > 0) {
      await card.click({ force: true });
      await page.waitForTimeout(700);
      // Detail pane always shows a "Back to sources" control; "Open in" only
      // when the source has an external link (many internal docs don't).
      const back = page.getByRole('button', { name: /Back to sources/i }).first();
      detailOpened = (await back.count()) > 0;
      await page.screenshot({ path: SHOT, fullPage: true });
      if (await back.count() > 0) {
        await back.click();
        await page.waitForTimeout(500);
        backWorked = (await page.getByText(/\d+ document/i).count()) > 0 && (await page.getByRole('link', { name: /Open in/i }).count()) === 0;
      }
    }
  }
  await page.waitForTimeout(400);

  console.warn('\n===== E2E CITATION PROOF =====');
  console.warn(`inline [n] superscripts rendered: ${hasCites ? `YES ✓ (${citeCount})` : 'NO ✗'}`);
  console.warn(`tap opened Sources drawer:        ${drawerOpened ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`drawer focused the tapped source: ${focused ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`card → detail slide-over:         ${detailOpened ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`back → list:                      ${backWorked ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`screenshot: ${SHOT}`);
  await browser.close();
  process.exit(hasCites && drawerOpened && detailOpened ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
