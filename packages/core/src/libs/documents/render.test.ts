import { Buffer } from 'node:buffer';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateDocument } from './audit';
import { closeRenderer, countPdfPagesByStructure, renderAvailable, renderDocument, renderNote } from './render';

/**
 * Real Chromium. The framework's whole point is that the print CSS and the
 * pinned footer behave the way Chrome prints them, so the measurement is
 * taken in Chrome, not simulated. Skips itself when no Chromium can launch
 * (a CI image without `npx playwright install chromium`).
 */

const CSS = `
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#e9e9e4;font:13px/1.6 -apple-system,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:Letter portrait;margin:0}
.sheet{position:relative;width:8.5in;height:11in;overflow:hidden;padding:0.7in 0.78in 0.5in;background:#FBFAF6;display:flex;flex-direction:column;page-break-after:always;margin:0 auto}
.sheet:last-child{page-break-after:auto}
.body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding-bottom:44px}
.foot{position:absolute;left:0.78in;right:0.78in;bottom:0.5in;margin:0;padding-top:12px}
.foot::before{content:"";display:block;height:2px;width:100%;background:linear-gradient(90deg,#1C6D69 45%,#F18700 80%)}
.pnum{text-align:right;font-size:10px}
.flowed .foot{position:static;margin-top:auto}.flowed .body{min-height:auto}
`;

const para = (n: number) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}. The record has to exist before anything can read it.</p>`).join('');

function doc(opts: { overflowSheet?: boolean; flowedFooter?: boolean; brokenImage?: boolean } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Meridian - Proposal (Metacto) v1.0</title><style>${CSS}</style></head><body>
<article class="sheet"><div class="strip"><span class="l">Cover</span></div><div class="body"><h1>Meridian starts here.</h1>${para(3)}${opts.brokenImage ? '<img src="assets/logo.png" alt="logo">' : ''}</div><div class="foot"><div class="pnum">1 / 3</div></div></article>
<article class="sheet${opts.flowedFooter ? ' flowed' : ''}"><div class="strip"><span class="l">How it works</span></div><div class="body"><h2>What we build</h2>${para(opts.overflowSheet ? 40 : 4)}</div><div class="foot"><div class="pnum">2 / 3</div></div></article>
<article class="sheet"><div class="strip"><span class="l">Investment</span></div><div class="body"><h2>Investment</h2>${para(4)}</div><div class="foot"><div class="pnum">3 / 3</div></div></article>
</body></html>`;
}

const available = await renderAvailable();

describe.skipIf(!available.ok)('renderDocument (real Chromium)', () => {
  afterAll(() => closeRenderer());

  it('measures a healthy document: equal footers, no overflow, PDF pages = sheets, one PNG per sheet', async () => {
    const r = await renderDocument(doc());

    expect(r.title).toBe('Meridian - Proposal (Metacto) v1.0');
    expect(r.sheets).toHaveLength(3);
    expect(r.sheets.map(s => s.label)).toEqual(['Cover', 'How it works', 'Investment']);

    const ys = r.sheets.map(s => s.footerY);

    expect(ys.every(y => y !== null && Math.abs(y - ys[0]!) <= 1)).toBe(true);
    expect(r.sheets.every(s => s.overflowPx === 0)).toBe(true);
    expect(r.sheets.every(s => s.png && s.png.byteLength > 1000)).toBe(true);
    // 8.5in at 96dpi
    expect(Math.round(r.sheets[0]!.width)).toBe(816);
    expect(Math.round(r.sheets[0]!.height)).toBe(1056);
    expect(r.pdfPages).toBe(3);
    expect(evaluateDocument({ sheets: r.sheets, pdfPages: r.pdfPages, unresolvedAssets: r.unresolvedAssets }).ok).toBe(true);
  }, 60_000);

  it('the page count is readable off the PDF structure without a parser', async () => {
    const r = await renderDocument(doc(), { screenshots: false, pdf: true });

    expect(r.pdf).toBeDefined();
    expect(countPdfPagesByStructure(r.pdf!)).toBe(3);
    expect(countPdfPagesByStructure(Buffer.from('%PDF-1.7 nothing here'))).toBeNull();
  }, 60_000);

  it('a pinned footer stays put while the body overflows, and the overflow is measured', async () => {
    const r = await renderDocument(doc({ overflowSheet: true }), { screenshots: false, pdf: false });
    const [a, b] = [r.sheets[0]!, r.sheets[1]!];

    expect(Math.abs((a.footerY ?? 0) - (b.footerY ?? 0))).toBeLessThanOrEqual(1);
    expect(b.overflowPx).toBeGreaterThan(100);
    expect(b.clipped.length).toBeGreaterThan(0);

    const v = evaluateDocument({ sheets: r.sheets, pdfPages: null, unresolvedAssets: [] });

    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.includes('Sheet 2 (How it works) overflows by'))).toBe(true);
  }, 60_000);

  it('a flowed footer is pushed by overflow — the failure the pin rule exists for — and the audit names the sheet', async () => {
    const r = await renderDocument(doc({ overflowSheet: true, flowedFooter: true }), { screenshots: false, pdf: false });
    const v = evaluateDocument({ sheets: r.sheets, pdfPages: null, unresolvedAssets: [] });

    expect(v.footerAligned).toBe(false);
    expect(v.issues.some(i => i.startsWith('Sheet 2 (How it works): footer rule at'))).toBe(true);
  }, 60_000);

  it('a relative image path is reported as unresolved rather than rendered blank in silence', async () => {
    const r = await renderDocument(doc({ brokenImage: true }), { screenshots: false, pdf: false });

    expect(r.unresolvedAssets).toContain('assets/logo.png');
  }, 60_000);
});

describe('what the render reports while it runs', () => {
  /**
   * Only the stages that really happen. Chromium lays the whole document out
   * in one pass, so there is nothing per-sheet to report before `measured`;
   * the screenshots after it are a real loop, one call per sheet, and the PDF
   * print is one more pass. A note is a fact about the work, not an animation.
   */
  it('names each stage in words a person reads', () => {
    expect(renderNote({ phase: 'measured', sheets: 12 })).toBe('measuring 12 sheets');
    expect(renderNote({ phase: 'measured', sheets: 1 })).toBe('measuring 1 sheet');
    expect(renderNote({ phase: 'screenshot', sheet: 7, sheets: 12 })).toBe('sheet 7 of 12');
    expect(renderNote({ phase: 'pdf', sheets: 12 })).toBe('printing the PDF');
  });
});

describe.skipIf(!available.ok)('a real render reports its real stages', () => {
  afterAll(() => closeRenderer());

  it('reports one note per sheet as it screenshots, then the PDF', async () => {
    const notes: string[] = [];
    await renderDocument(doc(), { screenshots: true, pdf: true, onProgress: p => notes.push(renderNote(p)) });

    expect(notes[0]).toBe('measuring 3 sheets');
    expect(notes).toEqual(expect.arrayContaining(['sheet 1 of 3', 'sheet 2 of 3', 'sheet 3 of 3']));
    expect(notes.at(-1)).toBe('printing the PDF');
  }, 60_000);

  it('a throwing reporter never breaks the render', async () => {
    const r = await renderDocument(doc(), { screenshots: false, pdf: false, onProgress: () => {
      throw new Error('the person closed the tab');
    } });

    expect(r.sheets).toHaveLength(3);
  }, 60_000);
});
