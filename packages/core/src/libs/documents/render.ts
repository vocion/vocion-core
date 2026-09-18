/**
 * The renderer — real Chromium, because the print CSS and the fonts have to
 * come out the way the client's own Chrome will print them.
 *
 * One call renders a document at the screen width the house framework was
 * tuned at (850px), measures every `.sheet` in the DOM, screenshots each one,
 * and prints the PDF with background graphics forced on. The measurements
 * are DOM facts (`getBoundingClientRect`, `scrollHeight`), not pixel scans:
 * a footer at 984px is a footer at 984px whatever the palette does.
 *
 * Playwright's bundled Chromium is the browser. In development that is the
 * same install the E2E suite uses; a deployment needs `npx playwright install
 * chromium` (or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing at a Chrome)
 * in its image — `renderAvailable()` says whether either is true so a tool can
 * report plainly instead of crashing the turn.
 *
 * External requests are allowed only for fonts and stylesheets on well-known
 * hosts; everything else is aborted. A document that leans on a relative
 * `src` therefore fails the asset check rather than silently rendering blank,
 * which is the truthful outcome — that image will not print for the client
 * either.
 */

import type { Browser, Page } from 'playwright';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { chromium } from 'playwright';

export const SHEET_RENDER_WIDTH = 850;

export type MeasuredSheetDom = {
  n: number;
  label: string;
  /** Sheet box in page coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  footerY: number | null;
  overflowPx: number;
  clipped: string[];
};

export type RenderResult = {
  title: string | null;
  sheets: Array<MeasuredSheetDom & { png?: Buffer }>;
  pdf?: Buffer;
  pdfPages: number | null;
  unresolvedAssets: string[];
  /** Wall time in ms, for the receipt and the tool_call row. */
  ms: number;
};

export type RenderOptions = {
  screenshots?: boolean;
  pdf?: boolean;
  /** Hard cap on the whole render, ms. */
  timeoutMs?: number;
  /** Which sheets to screenshot (1-based). Default all. */
  onlySheets?: number[];
};

const ALLOWED_HOSTS = /(?:^|\.)(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|rsms\.me)$/;

let browserPromise: Promise<Browser> | null = null;

/** One browser per process, launched on first use and reused. */
async function browser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    browserPromise = chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      // A system Chromium inside a container has no sandbox to use (no user
      // namespaces); the document is our own HTML, network is allow-listed.
      ...(executablePath ? { args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] } : {}),
    }).then((b) => {
      b.on('disconnected', () => {
        browserPromise = null;
      });
      return b;
    }, (err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/** Whether a Chromium this process can launch exists — checked once, cached. */
let availability: Promise<{ ok: true } | { ok: false; reason: string }> | null = null;
export function renderAvailable(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!availability) {
    availability = (async () => {
      try {
        const b = await browser();
        return b.isConnected() ? { ok: true as const } : { ok: false as const, reason: 'Chromium launched but disconnected' };
      } catch (err) {
        return { ok: false as const, reason: (err as Error).message.split('\n')[0] ?? 'could not launch Chromium' };
      }
    })();
  }
  return availability;
}

/** Close the shared browser — tests and graceful shutdown. */
export async function closeRenderer(): Promise<void> {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  availability = null;
  await b?.close().catch(() => {});
}

/**
 * Measure every `.sheet` in the loaded page. Runs in the browser.
 */
const MEASURE = `(() => {
  const sheets = Array.from(document.querySelectorAll('.sheet'));
  const text = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  return sheets.map((sheet, i) => {
    const r = sheet.getBoundingClientRect();
    const top = r.top + window.scrollY;
    const left = r.left + window.scrollX;
    const foot = sheet.querySelector('.foot');
    const body = sheet.querySelector('.body');
    const footerY = foot ? Math.round((foot.getBoundingClientRect().top + window.scrollY - top) * 10) / 10 : null;
    let overflowPx = 0;
    if (body) {
      overflowPx = Math.max(0, body.scrollHeight - body.clientHeight);
    }
    const clipped = [];
    const scope = body ?? sheet;
    const els = Array.from(scope.querySelectorAll('*'));
    for (const el of els) {
      if (clipped.length >= 12) break;
      if (el.closest('.foot')) continue;
      const er = el.getBoundingClientRect();
      if (er.width === 0 && er.height === 0) continue;
      const eb = er.bottom + window.scrollY;
      const erx = er.right + window.scrollX;
      if (eb > top + r.height + 1 || erx > left + r.width + 1) {
        const tag = el.tagName.toLowerCase();
        const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
        const t = text(el);
        clipped.push(tag + cls + (t ? ' "' + t.slice(0, 60) + '"' : '') + ' (+' + Math.round(Math.max(eb - (top + r.height), erx - (left + r.width))) + 'px)');
      }
    }
    const strip = sheet.querySelector('.strip .l');
    const heading = sheet.querySelector('h1, h2, h3');
    return {
      n: i + 1,
      label: text(strip) || text(heading),
      x: left, y: top, width: r.width, height: r.height,
      footerY, overflowPx: Math.round(overflowPx * 10) / 10,
      clipped,
    };
  });
})()`;

const BROKEN_IMAGES = `Array.from(document.images).filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src') || '').filter(Boolean).slice(0, 20)`;

/**
 * Render one document. Never throws for a document problem — a broken image
 * or an overflowing sheet is a measurement, not an error. Throws only when
 * the browser itself cannot be used.
 * @param html
 * @param opts
 */
export async function renderDocument(html: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const b = await browser();
  const context = await b.newContext({
    viewport: { width: SHEET_RENDER_WIDTH, height: 1100 },
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
  });
  const page: Page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  const blocked: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:')) {
      return route.continue();
    }
    try {
      const host = new URL(url).hostname;
      if (ALLOWED_HOSTS.test(host)) {
        return route.continue();
      }
    } catch {
      // fall through to abort
    }
    blocked.push(url);
    return route.abort();
  });
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve()).catch(() => {});
    // One frame so layout settles after fonts swap in.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))));
    const measured = await page.evaluate(MEASURE) as MeasuredSheetDom[];
    const brokenImages = await page.evaluate(BROKEN_IMAGES) as string[];
    const title = await page.title().then(t => t.trim() || null).catch(() => null);

    const sheets: RenderResult['sheets'] = [];
    const want = opts.onlySheets ? new Set(opts.onlySheets) : null;
    const handles = opts.screenshots === false ? [] : await page.$$('.sheet');
    for (let i = 0; i < measured.length; i++) {
      const m = measured[i]!;
      let png: Buffer | undefined;
      const handle = handles[i];
      if (handle && (!want || want.has(m.n))) {
        try {
          png = Buffer.from(await handle.screenshot({ type: 'png', timeout: timeoutMs }));
        } catch (err) {
          console.warn('[documents/render] sheet screenshot failed', m.n, (err as Error).message);
        }
      }
      sheets.push({ ...m, ...(png ? { png } : {}) });
    }

    let pdf: Buffer | undefined;
    let pdfPages: number | null = null;
    if (opts.pdf !== false) {
      try {
        pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
        pdfPages = await countPdfPages(pdf);
      } catch (err) {
        console.warn('[documents/render] pdf failed', (err as Error).message);
      }
    }

    // Relative paths never reach the network (Chromium resolves them against
    // about:blank and fails), so they show as broken images, not as blocked
    // requests. Blocked hosts are the other class. Both are unresolved.
    const unresolved = [...new Set([...brokenImages, ...blocked.map(u => u.slice(0, 200))])].slice(0, 20);
    return { title, sheets, ...(pdf ? { pdf } : {}), pdfPages, unresolvedAssets: unresolved, ms: Date.now() - started };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * How many pages a PDF has, or null when it cannot be read.
 * @param pdf
 */
export async function countPdfPages(pdf: Buffer): Promise<number | null> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    try {
      const info = await parser.getInfo();
      return typeof info.total === 'number' ? info.total : null;
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch {
    return null;
  }
}
