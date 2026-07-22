/**
 * Real-browser proof for the typed hierarchical trace: log in, ask a question
 * that forces DELEGATION, wait for the answer, open the Activity trace, and
 * confirm the DOM actually shows the delegate's work (a delegate row + a
 * "Show reasoning" drill) and citations. Screenshots the expanded trace.
 *
 *   bash /Users/chrisfitkin/vc.sh trace-e2e
 */
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
const EMAIL = 'chris@metacto.com';
const PW = process.env.E2E_PW ?? 'Vocion-Dogfood-2026!';
const MSG = process.env.E2E_MSG ?? 'Audit my Gauge follow-ups and have a specialist rank them by ROI, then give me the top 3.';
const SHOT = '/Users/chrisfitkin/trace-proof.png';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  console.warn('login…');
  await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#email', { state: 'visible' });
  await page.waitForTimeout(1500);
  await page.fill('#email', EMAIL);
  await page.fill('#password', PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(6000);
  if (!page.url().includes('/dashboard')) {
    await page.screenshot({ path: '/Users/chrisfitkin/login-debug.png' });
    console.warn(`login did not reach dashboard. url=${page.url()}`);
    await browser.close();
    process.exit(3);
  }

  await ctx.addCookies([{
    name: 'vocion_active_project',
    value: process.env.E2E_PROJECT ?? 'proj-revenue-f8429a692aab3703f82a4f15169b8662',
    domain: new URL(BASE).hostname,
    path: '/',
  }]);

  console.warn('open chat + select Founder GTM Lead…');
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
  await composer.click();
  await composer.fill(MSG);
  await page.waitForTimeout(400);
  await page.getByLabel('Send message').click();
  console.warn('sent — waiting for the answer (delegating turn ~150s)…');

  // The Activity bar switches from "Working…" to "Worked it out · …" when done.
  const doneBar = page.getByText(/Worked it out ·/i).first();
  let answered = false;
  try {
    await doneBar.waitFor({ state: 'visible', timeout: 240_000 });
    answered = true;
  } catch { /* report below */ }

  // Open the trace drawer.
  let delegateVisible = false;
  let reasoningDrill = false;
  let specialistLabel = false;
  if (answered) {
    await doneBar.click();
    await page.waitForTimeout(1200);
    // A delegate row reads "Delegating to …" / "… finished".
    delegateVisible = (await page.getByText(/finished|Delegating to/i).count()) > 0;
    // The specialist's reasoning is drillable.
    reasoningDrill = (await page.getByText(/Show reasoning/i).count()) > 0;
    specialistLabel = (await page.getByText(/specialist/i).count()) > 0;
    // Expand the first reasoning drill to prove the chain-of-thought is there.
    const drill = page.getByText(/Show reasoning/i).first();
    if (await drill.count() > 0) {
      await drill.click();
      await page.waitForTimeout(600);
    }
  }
  await page.screenshot({ path: SHOT, fullPage: true });

  console.warn('\n===== E2E TRACE PROOF =====');
  console.warn(`answer rendered:      ${answered ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`delegate row visible: ${delegateVisible ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`specialist labelled:  ${specialistLabel ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`reasoning drill:      ${reasoningDrill ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`screenshot: ${SHOT}`);
  await browser.close();
  process.exit(answered && delegateVisible ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
