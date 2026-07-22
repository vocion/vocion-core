/**
 * Real-browser proof for the Action Queue catch-up triage: seed 2 pending
 * gmail.send drafts, open /dashboard/review, click "Catch up", step through
 * (Skip → Save) to the "All caught up" summary. Self-cleaning; gmail.send
 * stays pending so nothing sends.
 *
 *   bash /Users/chrisfitkin/vc.sh triage-e2e
 */
import process from 'node:process';
import { chromium } from '@playwright/test';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';
import { proposeAction } from '@/services/ActionService';

const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
const EMAIL = 'chris@metacto.com';
const PW = process.env.E2E_PW ?? 'Vocion-Dogfood-2026!';
const ORG = process.env.E2E_PROJECT ?? 'proj-revenue-f8429a692aab3703f82a4f15169b8662';
const SHOT = '/Users/chrisfitkin/triage-proof.png';
const PROBE = 'triage-probe';

async function cleanup(): Promise<void> {
  await db.delete(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), sql`${actionRunSchema.dedupKey} like ${`gmail.send:${PROBE}%`}`));
}

async function main(): Promise<void> {
  await cleanup();
  const principal = { kind: 'agent' as const, id: 'agent:founder-gtm-lead', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 as const };
  for (const n of [1, 2]) {
    await proposeAction({
      orgId: ORG,
      actionId: 'gmail.send',
      principal,
      dedupKey: `gmail.send:${PROBE}-${n}@example.com`,
      input: { to: `${PROBE}-${n}@example.com`, subject: `Probe ${n}`, body: `Body ${n}`, draft: true },
      proposal: { confidence: 0.8, rationale: `Test triage item ${n}` },
    });
  }
  console.warn('seeded 2 pending actions.');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  let opened = false;
  let stepped = false;
  let caughtUp = false;
  try {
    await page.goto(`${BASE}/en/sign-in`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#email', { state: 'visible' });
    await page.waitForTimeout(1500);
    await page.fill('#email', EMAIL);
    await page.fill('#password', PW);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForTimeout(6000);
    await ctx.addCookies([{ name: 'vocion_active_project', value: ORG, domain: new URL(BASE).hostname, path: '/' }]);

    await page.goto(`${BASE}/en/dashboard/review`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const catchUp = page.getByRole('button', { name: /Catch up/i }).first();
    await catchUp.waitFor({ state: 'visible', timeout: 20_000 });
    await catchUp.click();
    await page.waitForTimeout(800);
    // Count-agnostic: the queue may hold other real pending items too.
    opened = (await page.getByText(/\d+ of \d+/i).count()) > 0;
    const firstLabel = await page.getByText(/\d+ of \d+/i).first().textContent();
    // Step through with Skip only (leaves every item PENDING — decides nothing)
    // until the "All caught up" summary. Bounded loop.
    for (let i = 0; i < 15; i++) {
      const skip = page.getByRole('button', { name: /^Skip$/i }).first();
      if (await skip.count() === 0) {
        break;
      }
      await skip.click();
      await page.waitForTimeout(400);
      const secondLabel = await page.getByText(/\d+ of \d+/i).first().textContent().catch(() => null);
      if (secondLabel && firstLabel && secondLabel !== firstLabel) {
        stepped = true;
      }
      if ((await page.getByText(/All caught up/i).count()) > 0) {
        break;
      }
    }
    caughtUp = (await page.getByText(/All caught up/i).count()) > 0;
    await page.screenshot({ path: SHOT, fullPage: true });
  } finally {
    await browser.close();
    await cleanup();
  }

  console.warn('\n===== E2E TRIAGE PROOF =====');
  console.warn(`triage opened (1 of 2):   ${opened ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`stepped (Skip → 2 of 2):  ${stepped ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`reached "All caught up":   ${caughtUp ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`screenshot: ${SHOT}`);
  console.warn('cleaned up seeded rows.');
  process.exit(opened && stepped && caughtUp ? 0 : 2);
}

main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
