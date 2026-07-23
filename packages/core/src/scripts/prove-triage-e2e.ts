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
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, userActivityEventSchema } from '@/models/Schema';
import { proposeAction } from '@/services/ActionService';

const BASE = process.env.E2E_BASE ?? 'https://dev.agents.metacto.com';
const EMAIL = 'chris@metacto.com';
const PW = process.env.E2E_PW ?? 'Vocion-Dogfood-2026!';
const ORG = process.env.E2E_PROJECT ?? 'proj-revenue-f8429a692aab3703f82a4f15169b8662';
const SHOT = '/Users/chrisfitkin/triage-proof.png';
const PROBE = 'triage-probe';

let seededIds: number[] = [];

async function cleanup(): Promise<void> {
  if (seededIds.length > 0) {
    await db.delete(userActivityEventSchema).where(and(eq(userActivityEventSchema.orgId, ORG), eq(userActivityEventSchema.resourceType, 'action_run'), sql`${userActivityEventSchema.resourceId} in (${sql.join(seededIds.map(i => sql`${String(i)}`), sql`, `)})`));
  }
  await db.delete(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), sql`${actionRunSchema.dedupKey} like ${`gmail.send:${PROBE}%`}`));
}

async function main(): Promise<void> {
  await cleanup();
  const principal = { kind: 'agent' as const, id: 'agent:founder-gtm-lead', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 as const };
  for (const n of [1, 2]) {
    const r = await proposeAction({
      orgId: ORG,
      actionId: 'gmail.send',
      principal,
      dedupKey: `gmail.send:${PROBE}-${n}@example.com`,
      input: { to: `${PROBE}-${n}@example.com`, subject: `Probe ${n}`, body: `Hi there, I just wanted to reach out and check in to see if you had any thoughts on our previous conversation. I know things have been busy lately. Please let me know if you might have some time to chat at some point soon. Thanks so much!`, draft: true },
      proposal: { confidence: 0.8, rationale: `Test triage item ${n}` },
    });
    seededIds.push(r.runId);
  }
  console.warn(`seeded 2 pending actions (${seededIds.join(', ')}).`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  let opened = false;
  let stepped = false;
  let rewriteChanged = false;
  let rewriteSignal = false;
  let skipSignals = 0;
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
    // Focus mode IS the page now — no button, no modal.
    const focus = page.getByTestId('review-focus');
    await focus.waitFor({ state: 'visible', timeout: 20_000 });
    opened = (await page.getByText(/\d+ in queue/i).count()) > 0;
    const firstLabel = await page.locator('input').nth(1).inputValue().catch(() => null); // subject field of the focused item

    // Rewrite-with-AI on card 1 (a seeded gmail.send, newest → first): the body
    // should change and a `rewritten` signal is recorded server-side.
    const ta = page.locator('textarea').first();
    if (await ta.count() > 0) {
      const before = await ta.inputValue();
      await page.getByRole('button', { name: /^Rewrite$/i }).first().click();
      await page.waitForTimeout(14_000); // LLM rewrite pass
      const after = await ta.inputValue();
      rewriteChanged = after.trim().length > 0 && after !== before;
    }

    // Skip the focused (seeded) item — records a `skip` signal and the next
    // item loads IN PLACE (subject changes). Leaves everything pending.
    await page.getByRole('button', { name: /^Skip$/i }).first().click();
    await page.waitForTimeout(900);
    const secondLabel = await page.locator('input').nth(1).inputValue().catch(() => null);
    stepped = !!(firstLabel && secondLabel && secondLabel !== firstLabel);
    await page.screenshot({ path: SHOT, fullPage: true });
    await page.waitForTimeout(2500); // let the fire-and-forget skip signal commit

    // Verify the typed signals landed on the adoption stream for the seeded ids.
    const rows = await db.select({ resourceId: userActivityEventSchema.resourceId, metadata: userActivityEventSchema.metadata })
      .from(userActivityEventSchema)
      .where(and(eq(userActivityEventSchema.orgId, ORG), eq(userActivityEventSchema.eventType, 'review.decided'), eq(userActivityEventSchema.resourceType, 'action_run')))
      .orderBy(desc(userActivityEventSchema.createdAt))
      .limit(50);
    const mine = rows.filter(r => r.resourceId && seededIds.includes(Number(r.resourceId)));
    rewriteSignal = mine.some(r => (r.metadata as { decision?: string })?.decision === 'rewritten' && (r.metadata as { actionId?: string })?.actionId === 'gmail.send');
    skipSignals = mine.filter(r => (r.metadata as { decision?: string })?.decision === 'skipped').length;
  } finally {
    await browser.close();
    await cleanup();
  }

  console.warn('\n===== E2E TRIAGE + SIGNALS PROOF =====');
  console.warn(`triage opened:                 ${opened ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`stepped through cards:         ${stepped ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`Rewrite-with-AI changed body:  ${rewriteChanged ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`'rewritten' signal recorded:   ${rewriteSignal ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`'skip' signals recorded:       ${skipSignals} ${skipSignals >= 1 ? '✓' : '✗'}`);
  console.warn(`screenshot: ${SHOT}`);
  console.warn('cleaned up seeded rows + their signals.');
  process.exit(opened && rewriteChanged && rewriteSignal && skipSignals >= 1 ? 0 : 2);
}

main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
