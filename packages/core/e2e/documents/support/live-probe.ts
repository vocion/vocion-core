/**
 * The document loop against a LIVE instance and a real model — the probe a
 * person runs before calling a deploy good, and the red team's driver.
 *
 *   PROBE_BASE_URL=https://… PROBE_EMAIL=… PROBE_PASSWORD=… \
 *   npx tsx e2e/documents/support/live-probe.ts <script.json> [outDir]
 *
 * The script is a list of turns: `{ "say": "…", "waitFor": "<text|regex>",
 * "timeoutMs": 300000, "shot": "name", "expandLatest": true }`. Unlike the
 * scripted-model E2E nothing is asserted about the agent's words — a real
 * model answers in its own — so each turn records what came back: the
 * transcript delta, the artifact chips, the open document's state line, and
 * a screenshot. The receipt of a run is a folder a person reads.
 *
 * Not part of `playwright test`; it is a tool.
 */

import type { Page } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

type Turn = {
  say?: string;
  /** Navigate here first (relative). */
  goto?: string;
  /** Text (or /regex/) that must appear in the transcript before the turn counts as answered. */
  waitFor?: string;
  timeoutMs?: number;
  shot?: string;
  /** After the turn, open the newest document beside the conversation. */
  expandLatest?: boolean;
  /** Read the composer and pane state only; no send. */
  observe?: boolean;
  /** Click a button by its accessible name before saying anything (a page's "Draft a document"). */
  click?: string;
  /** Send whatever the click prefilled into the composer, with `say` appended after a space. */
  usePrefill?: boolean;
};

const BASE = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? 'demo@example.com';
const PASSWORD = process.env.PROBE_PASSWORD ?? 'demo123';
const scriptFile = process.argv[2];
if (!scriptFile) {
  console.error('usage: live-probe.ts <script.json> [outDir]');
  process.exit(2);
}
const OUT = process.argv[3] ?? path.join(process.cwd(), '.artifacts', 'live-probe', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(OUT, { recursive: true });
const turns = JSON.parse(readFileSync(scriptFile, 'utf8')) as Turn[];
const log: string[] = [];
const note = (s: string) => {
  log.push(s);
  console.warn(s);
};

function matcher(waitFor: string): RegExp {
  const m = /^\/(.*)\/([a-z]*)$/.exec(waitFor);
  return m ? new RegExp(m[1]!, m[2]) : new RegExp(waitFor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

async function transcript(page: Page): Promise<string> {
  // innerText, deliberately: what a person sees, with hidden text left out.
  // eslint-disable-next-line unicorn/prefer-dom-node-text-content
  return page.locator('main').first().innerText().catch(() => page.locator('body').innerText());
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('console', m => m.type() === 'error' && note(`[console] ${m.text().slice(0, 200)}`));
  page.on('response', r => r.status() >= 500 && note(`[http ${r.status()}] ${r.url()}`));

  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  note(`signed in as ${EMAIL} at ${BASE} → ${page.url()}`);

  let i = 0;
  for (const t of turns) {
    i++;
    const started = Date.now();
    if (t.goto) {
      await page.goto(`${BASE}${t.goto}`);
      await page.waitForLoadState('domcontentloaded');
    }
    if (t.click) {
      await page.getByRole('button', { name: t.click }).first().click();
      note(`clicked "${t.click}"`);
    }
    if (t.say !== undefined || t.usePrefill) {
      const before = await transcript(page);
      const box = page.locator('textarea[data-agent-composer]').last();
      await box.waitFor({ state: 'visible', timeout: 60_000 });
      if (t.usePrefill) {
        await page.waitForFunction(el => (el as HTMLTextAreaElement).value.trim().length > 0, await box.elementHandle(), { timeout: 15_000 });
      }
      await box.click();
      const prefilled = t.usePrefill ? await box.inputValue() : '';
      const line = [prefilled.trim(), (t.say ?? '').trim()].filter(Boolean).join(' ');
      await box.fill(line);
      await page.getByRole('button', { name: 'Send message' }).last().click();
      note(`\n=== turn ${i}: ${line}`);
      const timeout = t.timeoutMs ?? 300_000;
      // The turn is over when the agent stops, not when a word appears: the
      // person's own line is in the transcript too, and would match first.
      const stop = page.getByRole('button', { name: 'Stop generating' });
      await stop.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => note('(no Stop button seen within 60s — the send may not have gone)'));
      await stop.waitFor({ state: 'hidden', timeout });
      const after = await transcript(page);
      const delta = after.startsWith(before) ? after.slice(before.length) : after;
      note(`--- ${Math.round((Date.now() - started) / 1000)}s · transcript delta:\n${delta.trim().slice(0, 4000)}`);
      if (t.waitFor && !matcher(t.waitFor).test(delta)) {
        note(`--- WARNING: expected ${t.waitFor} in the reply and did not find it`);
      }
      const chips = await page.locator('[data-artifact-chip]').allInnerTexts();
      if (chips.length) {
        note(`--- chips: ${chips.slice(-4).map(c => c.replace(/\n/g, ' ')).join(' | ')}`);
      }
    }
    if (t.expandLatest) {
      await page.goto(`${BASE}/dashboard/artifacts`);
      const row = page.locator('a[href*="/dashboard/chat/"][href*="artifact="]', { hasText: /Document · v\d/ }).first();
      await row.waitFor({ timeout: 60_000 });
      const href = await row.getAttribute('href');
      note(`--- newest document: ${href}`);
      await page.goto(`${BASE}${href}`);
      await page.locator('[data-document-frame]').waitFor({ timeout: 120_000 });
    }
    const state = page.locator('[data-document-state]');
    if (await state.count()) {
      note(`--- document state: ${(await state.first().textContent()) ?? ''}`);
      const issues = page.locator('[data-document-issues]');
      if (await issues.count()) {
        note(`--- issues: ${((await issues.first().textContent()) ?? '').slice(0, 2000)}`);
      }
    }
    if (t.shot) {
      const file = path.join(OUT, `${String(i).padStart(2, '0')}-${t.shot}.png`);
      await page.screenshot({ path: file, fullPage: false });
      note(`--- shot: ${file}`);
    }
  }
  writeFileSync(path.join(OUT, 'probe.log'), log.join('\n'));
  await browser.close();
  note(`\nwrote ${OUT}/probe.log`);
}

main().catch((err) => {
  console.error(err);
  writeFileSync(path.join(OUT, 'probe.log'), [...log, `ERROR ${(err as Error).message}`].join('\n'));
  process.exit(1);
});
