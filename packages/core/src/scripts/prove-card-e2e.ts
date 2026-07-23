/**
 * Real-browser proof: log in, ask the Founder GTM Lead to draft the owed email
 * follow-ups, and confirm a RecommendedActionCard actually RENDERS in the DOM
 * (not just that the agent emitted the event). Screenshots the result.
 *
 *   bash /Users/chrisfitkin/vc.sh e2e
 */
import process from 'node:process';
import { chromium } from '@playwright/test';

// Must match AUTH_URL's origin — the session cookie is scoped to it, so a
// localhost run would bounce back to sign-in.
const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
const EMAIL = 'chris@metacto.com';
const PW = process.env.E2E_PW ?? 'Vocion-Dogfood-2026!';
const MSG = process.env.E2E_MSG ?? 'Draft the email follow-ups I owe Eric Bloomfield and Kyle Getson.';
const SHOT = '/Users/chrisfitkin/card-proof.png';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  console.warn('login…');
  await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#email', { state: 'visible' });
  await page.waitForTimeout(1500); // let React hydrate so onSubmit binds (else a native reload clears the form)
  await page.fill('#email', EMAIL);
  await page.fill('#password', PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(6000);
  const afterLoginUrl = page.url();
  if (!afterLoginUrl.includes('/dashboard')) {
    const err = await page.locator('.text-destructive').first().textContent().catch(() => null);
    await page.screenshot({ path: '/Users/chrisfitkin/login-debug.png' });
    console.warn(`login did not reach dashboard. url=${afterLoginUrl} error=${err ?? '(none shown)'}`);
    await browser.close();
    process.exit(3);
  }

  // Land on the REVENUE project (8 agents) the legitimate way — the same
  // active-project cookie the in-app project switcher sets. Without this a
  // fresh session falls to the empty "Default project" → no agents → no card.
  await ctx.addCookies([{
    name: 'vocion_active_project',
    value: process.env.E2E_PROJECT ?? 'proj-revenue-f8429a692aab3703f82a4f15169b8662',
    domain: new URL(BASE).hostname,
    path: '/',
  }]);

  console.warn('open chat + select Founder GTM Lead…');
  await page.goto(`${BASE}/en/dashboard/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Pick the agent via the switcher (the ?agent query doesn't survive the
  // locale redirect, so the UI is the reliable path).
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
  await page.waitForTimeout(400); // let React register the value so send enables
  await page.getByLabel('Send message').click();
  console.warn('sent — waiting for a recommended-action card (drafting turn ~90s)…');

  const card = page.getByTestId('recommended-action-card').first();
  let rendered = false;
  try {
    await card.waitFor({ state: 'visible', timeout: 180_000 });
    rendered = true;
  } catch {
    /* fall through — report absent */
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOT, fullPage: true });
  const count = await page.getByTestId('recommended-action-card').count();

  console.warn('\n===== E2E CARD PROOF =====');
  console.warn(`CARD RENDERED IN BROWSER: ${rendered ? 'YES ✓' : 'NO ✗'} (count=${count})`);
  console.warn(`screenshot: ${SHOT}`);
  await browser.close();
  process.exit(rendered ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
