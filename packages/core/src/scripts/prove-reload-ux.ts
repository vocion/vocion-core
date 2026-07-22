/**
 * Real-browser proof for the reload UX: create a conversation, RELOAD, and
 * confirm the page does NOT flash the empty-state suggestion chips on the way
 * to the transcript (the old 4-state flash). We sample the DOM every 120ms
 * across the reload and record whether chips ever appeared before the
 * transcript.
 *
 *   bash /Users/chrisfitkin/vc.sh reload-ux
 */
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
const EMAIL = 'chris@metacto.com';
const PW = process.env.E2E_PW ?? 'Vocion-Dogfood-2026!';
const SHOT = '/Users/chrisfitkin/reload-proof.png';

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

  console.warn('create a conversation (short turn)…');
  await page.goto(`${BASE}/en/dashboard/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const composer = page.getByPlaceholder(/Message|Ask/i).first();
  await composer.waitFor({ state: 'visible', timeout: 20_000 });
  await composer.fill('Say hi in one short sentence.');
  await page.waitForTimeout(300);
  await page.getByLabel('Send message').click();
  // Wait until the user's message is on screen (conversation now persisted).
  await page.getByText('Say hi in one short sentence.').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(3000);

  console.warn('RELOAD — sampling the DOM for a chip flash…');
  await page.reload({ waitUntil: 'commit' });
  let sawChipsBeforeTranscript = false;
  let sawTranscript = false;
  const isChip = 'button[data-suggestion], [data-testid="suggestion-chip"]';
  for (let i = 0; i < 40; i++) {
    const transcript = await page.getByText('Say hi in one short sentence.').count();
    if (transcript > 0) {
      sawTranscript = true;
      break;
    }
    // A suggestion chip visible while the transcript is NOT yet shown = a flash.
    const chips = await page.locator(isChip).count().catch(() => 0);
    const greetingCta = await page.getByRole('button', { name: /Draft|Review|What|How|Show me/i }).count().catch(() => 0);
    if (chips > 0 || greetingCta > 0) {
      sawChipsBeforeTranscript = true;
    }
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: SHOT, fullPage: true });

  console.warn('\n===== E2E RELOAD UX PROOF =====');
  console.warn(`transcript restored:        ${sawTranscript ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`empty-state chips flashed:  ${sawChipsBeforeTranscript ? 'YES ✗ (flash)' : 'NO ✓ (clean)'}`);
  console.warn(`screenshot: ${SHOT}`);
  await browser.close();
  process.exit(sawTranscript && !sawChipsBeforeTranscript ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
