/**
 * The deck renderer — the same shared Chromium documents render in
 * (`libs/documents/render.ts`'s `sharedBrowser`), at 1920×1080.
 *
 * `openDeckPage` loads a deck's render page (`page.ts`) and waits for the
 * element runtime, and hands back the live Playwright page: the audit,
 * the screenshots and the PDF are read from it here, and the PPTX layout pass
 * reads computed geometry from the very same page, so what is exported is what
 * was verified.
 *
 * Network: fonts and the well-known style CDNs only, as for a document; an
 * `asset:<id>` resolves to `https://asset.vocion.invalid/<id>`, which never
 * leaves the process — the caller's `loadAsset` answers it from the file
 * store. Anything else is aborted, so an outside image fails the asset audit
 * instead of rendering from someone else's server.
 */

import type { Buffer } from 'node:buffer';
import type { Page } from 'playwright';
import type { MeasuredSlideDom } from './audit';
import type { DeckSpec } from '@/libs/cards/specs';
import { Buffer as NodeBuffer } from 'node:buffer';
import { ALLOWED_HOSTS, countPdfPages, sharedBrowser } from '@/libs/documents/render';
import { MEASURE_SLIDES } from './audit';
import { buildDeckPage, SLIDE_HEIGHT, SLIDE_WIDTH } from './page';

/** The host an `asset:<id>` resolves to inside the renderer. Reserved (RFC 6761), so it can never be a real one. */
export const RENDER_ASSET_ORIGIN = 'https://asset.vocion.invalid';

export type AssetLoader = (id: string) => Promise<{ body: Buffer; contentType: string } | null>;

export type DeckRenderProgress
  = | { phase: 'measured'; slides: number }
    | { phase: 'screenshot'; slide: number; slides: number }
    | { phase: 'pdf'; slides: number };

/**
 * A render stage as a phrase for the running step line — `slide 7 of 12`.
 * @param p - What the renderer reported.
 */
export function deckRenderNote(p: DeckRenderProgress): string {
  switch (p.phase) {
    case 'measured':
      return `measuring ${p.slides} ${p.slides === 1 ? 'slide' : 'slides'}`;
    case 'screenshot':
      return `slide ${p.slide} of ${p.slides}`;
    case 'pdf':
      return 'printing the PDF';
  }
}

export type OpenDeckPageOptions = {
  /** Bytes for an `asset:<id>`, or null when there are none (the image then fails to load and the audit names it). */
  loadAsset?: AssetLoader;
  timeoutMs?: number;
  /** Device pixels per CSS px for screenshots (the PPTX pass rasterises at 2). Default 1. */
  deviceScaleFactor?: number;
};

export type OpenDeckPage = {
  page: Page;
  /** URLs the page tried to reach and was refused. */
  blocked: string[];
  /** Close the context (never the shared browser). */
  close: () => Promise<void>;
};

/**
 * Load a deck in the shared Chromium with the runtime applied, fonts loaded
 * and layout settled. The caller MUST call `close()`.
 * @param spec - The deck.
 * @param opts - Assets, timeout and pixel ratio.
 */
export async function openDeckPage(spec: Pick<DeckSpec, 'title' | 'order' | 'slides' | 'faces' | 'assets'>, opts: OpenDeckPageOptions = {}): Promise<OpenDeckPage> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const browser = await sharedBrowser();
  const context = await browser.newContext({ viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT }, deviceScaleFactor: opts.deviceScaleFactor ?? 1, javaScriptEnabled: true });
  const close = () => context.close().catch(() => {});
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const blocked: string[] = [];
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:')) {
        return route.continue();
      }
      if (url.startsWith(`${RENDER_ASSET_ORIGIN}/`)) {
        const id = decodeURIComponent(url.slice(RENDER_ASSET_ORIGIN.length + 1));
        const found = opts.loadAsset ? await opts.loadAsset(id).catch(() => null) : null;
        if (found) {
          return route.fulfill({ status: 200, body: found.body, contentType: found.contentType });
        }
        blocked.push(`asset:${id}`);
        return route.fulfill({ status: 404, body: '' });
      }
      try {
        if (ALLOWED_HOSTS.test(new URL(url).hostname)) {
          return route.continue();
        }
      } catch {
        // fall through to abort
      }
      blocked.push(url.slice(0, 200));
      return route.abort();
    });
    const html = buildDeckPage(spec, { assetUrl: id => (spec.assets?.[id] ? `${RENDER_ASSET_ORIGIN}/${encodeURIComponent(id)}` : null), gap: 0 });
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-vocion-runtime') === 'ready', undefined, { timeout: timeoutMs });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))));
    return { page, blocked, close };
  } catch (err) {
    await close();
    throw err;
  }
}

export type DeckRenderResult = {
  slides: Array<MeasuredSlideDom & { png?: Buffer }>;
  pdf?: Buffer;
  pdfPages: number | null;
  ms: number;
};

/**
 * Render, measure, screenshot and print a deck. Never throws for a deck
 * problem — an overflowing slide is a measurement. Throws only when the
 * browser cannot be used.
 * @param spec - The deck.
 * @param opts - What to produce, and how assets load.
 * @param opts.screenshots
 * @param opts.pdf
 * @param opts.onProgress
 */
export async function renderDeck(spec: Pick<DeckSpec, 'title' | 'order' | 'slides' | 'faces' | 'assets'>, opts: OpenDeckPageOptions & { screenshots?: boolean; pdf?: boolean; onProgress?: (p: DeckRenderProgress) => void } = {}): Promise<DeckRenderResult> {
  const started = Date.now();
  const report = (p: DeckRenderProgress) => {
    try {
      opts.onProgress?.(p);
    } catch {
      // Telling someone what is happening may never break the thing happening.
    }
  };
  const { page, close } = await openDeckPage(spec, opts);
  try {
    const measured = await page.evaluate(MEASURE_SLIDES) as MeasuredSlideDom[];
    report({ phase: 'measured', slides: measured.length });
    const slides: DeckRenderResult['slides'] = [];
    const frames = opts.screenshots === false ? [] : await page.$$('.vocion-slide');
    for (let i = 0; i < measured.length; i++) {
      const m = measured[i]!;
      let png: Buffer | undefined;
      const frame = frames[i];
      if (frame) {
        report({ phase: 'screenshot', slide: m.n, slides: measured.length });
        try {
          png = NodeBuffer.from(await frame.screenshot({ type: 'png' }));
        } catch (err) {
          console.warn('[decks/render] slide screenshot failed', m.n, (err as Error).message);
        }
      }
      slides.push({ ...m, ...(png ? { png } : {}) });
    }
    let pdf: Buffer | undefined;
    let pdfPages: number | null = null;
    if (opts.pdf !== false) {
      report({ phase: 'pdf', slides: measured.length });
      try {
        pdf = NodeBuffer.from(await page.pdf({ width: `${SLIDE_WIDTH}px`, height: `${SLIDE_HEIGHT}px`, printBackground: true, preferCSSPageSize: true }));
        pdfPages = await countPdfPages(pdf);
      } catch (err) {
        console.warn('[decks/render] pdf failed', (err as Error).message);
      }
    }
    return { slides, ...(pdf ? { pdf } : {}), pdfPages, ms: Date.now() - started };
  } finally {
    await close();
  }
}
