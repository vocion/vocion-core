/**
 * A page as a model reads it, and a ref back to an element — the one shape
 * both of Vocion's browsers use: QA's live check (`services/factory/
 * liveBrowser.ts`) and a person's browser runs (`services/browser`).
 *
 * Playwright's own snapshot for an AI (`_snapshotForAI`, what Playwright MCP
 * serves): each element with its role, name, state (`[disabled]`,
 * `[checked]`, `[expanded]`) and a ref (`e5`) to act on.
 */

import type { Page } from 'playwright';
import { snapshotWindow } from '@/libs/factory/snapshotWindow';

/**
 * The page's address, title and accessibility tree with refs, capped.
 * @param page - The page.
 * @param maxChars - The most characters the answer may hold.
 * @param find - Words on the part of a long page to show, else its top.
 */
export async function pageSnapshot(page: Page, maxChars: number, find?: string | null): Promise<{ url: string; title: string; text: string }> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const p = page as Page & { _snapshotForAI?: (o?: { timeout?: number }) => Promise<{ full: string } | string> };
  let tree: string;
  if (typeof p._snapshotForAI === 'function') {
    const snap = await p._snapshotForAI({ timeout: 10_000 });
    tree = typeof snap === 'string' ? snap : snap.full;
  } else {
    // A Playwright without the AI snapshot: the plain aria snapshot, without refs.
    tree = `${await page.locator('body').ariaSnapshot({ timeout: 10_000 })}\n[this browser gives no refs: act on nothing, read only]`;
  }
  const head = `URL: ${url}\nTitle: ${title}\n`;
  // A page longer than the cap shows its top, or the part around the words asked for (`snapshotWindow`).
  const { text } = snapshotWindow(tree, maxChars - head.length, find);
  return { url, title, text: head + text };
}

/**
 * A ref from the last snapshot, as a locator, or null when it is not one.
 * @param page - The page.
 * @param ref - The ref (`e5`).
 */
export function byRef(page: Page, ref: string) {
  const r = ref.trim().replace(/^\[?ref=/, '').replace(/\]$/, '');
  return /^[a-z]?\d+$|^f\d+e\d+$/i.test(r) ? page.locator(`aria-ref=${r}`) : null;
}
