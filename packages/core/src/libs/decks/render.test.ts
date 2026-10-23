import type { DeckSpec } from '@/libs/cards/specs';
import { Buffer } from 'node:buffer';
import { afterAll, describe, expect, it } from 'vitest';
import { closeRenderer, renderAvailable } from '@/libs/documents/render';
import { evaluateDeck, mergeSlideFacts, staticSlideFacts } from './audit';
import { openDeckPage, renderDeck } from './render';

/**
 * Real Chromium, like the document renderer's test: the audit is DOM facts,
 * so it is measured in the browser that prints the PDF. Skips itself when no
 * Chromium can launch.
 */

// A 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const FOOT = '<div style="position:absolute;left:120px;right:120px;top:1000px;height:40px;font-size:24px;color:#556">Northwind · Kestrel Capital</div>';

const deck: DeckSpec = {
  format: 'vocion-deck/1',
  title: 'Northwind — one record',
  order: ['cover', 'crowded', 'parts'],
  slides: {
    cover: `<section id="cover" style="background:#0b1f2a;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;justify-content:center;padding:120px;gap:32px"><h1 style="font-size:96px;margin:0">One record</h1><p style="font-size:36px;margin:0">Every order in one place.</p><img src="asset:logo" style="width:120px;height:120px">${FOOT}<aside>From the 2026-09-12 discovery call.</aside></section>`,
    crowded: `<section id="crowded" style="background:#fff;font-family:sans-serif;padding:120px"><h2 style="font-size:64px">Too much</h2><p style="font-size:14px">fine print nobody reads</p><div style="position:absolute;left:1700px;top:200px;width:400px;height:100px;background:#c00">wide</div><p style="margin:640px 0 0;font-size:30px">late line</p><img src="asset:missing"></section>`,
    parts: `<section id="parts" style="background:#fafafa;font-family:sans-serif;padding:120px;color:#123"><x-icon name="Lock" style="width:96px;height:96px;color:#1c6d69"></x-icon><x-icon name="Unicorn"></x-icon><x-shape kind="arrow-right" style="width:300px;height:120px;background:#f18700;border:4px solid #123"><span style="font-size:28px">Next</span></x-shape><x-shape kind="hexagon" style="width:100px;height:100px"></x-shape><div style="margin-left:400px"><x-connector x1="200" y1="700" x2="900" y2="900" route="hv" head="both" style="color:#1c6d69;border-width:6px;border-style:dashed"></x-connector></div><aside>Diagram from the Larkfield Systems workshop.</aside></section>`,
  },
  assets: { logo: { url: '/api/artifacts/org-x/org-x-logo.png', contentType: 'image/png' } },
};

const loadAsset = async (id: string) => (id === 'logo' ? { body: PNG, contentType: 'image/png' } : null);

const available = await renderAvailable();

describe.skipIf(!available.ok)('renderDeck (real Chromium)', () => {
  afterAll(() => closeRenderer());

  it('renders, measures and prints one 1920×1080 page per slide', async () => {
    const r = await renderDeck(deck, { loadAsset });

    expect(r.slides.map(s => s.id)).toEqual(['cover', 'crowded', 'parts']);
    expect(r.slides.every(s => s.png && s.png.byteLength > 1000)).toBe(true);
    expect(r.pdfPages).toBe(3);

    const [cover, crowded, parts] = r.slides;

    // A clean slide: the footer band (pinned, top ≥ 920, ≤ 80 tall) is not "below the line".
    expect(cover).toMatchObject({ overflowPx: 0, clipped: [], smallText: [], belowFooter: [], unknownElements: [], brokenImages: [] });
    expect(crowded!.overflowPx).toBeGreaterThanOrEqual(180);
    expect(crowded!.clipped[0]).toMatch(/^div "wide"/);
    expect(crowded!.smallText[0]).toMatch(/fine print.*\(14px\)/);
    expect(crowded!.belowFooter[0]).toMatch(/late line/);
    expect(crowded!.brokenImages).toEqual(['asset:missing']);
    expect(parts!.unknownElements.sort()).toEqual(['icon:Unicorn', 'shape:hexagon']);

    const v = evaluateDeck({ slides: staticSlideFacts(deck).map((f, i) => mergeSlideFacts(f, r.slides[i])), pdfPages: r.pdfPages });

    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.startsWith('Slide 1'))).toBe(false);
    expect(v.issues.join('\n')).toMatch(/Slide 3 .*icon:Unicorn/);
  }, 90_000);

  it('hands the PPTX pass a live page with the runtime applied', async () => {
    const { page, close } = await openDeckPage(deck, { loadAsset });
    try {
      const facts = await page.evaluate(() => ({
        icon: document.querySelector('x-icon[name="Lock"] svg')?.getAttribute('viewBox'),
        shape: document.querySelector('x-shape[kind="arrow-right"] > svg path')?.getAttribute('d')?.startsWith('M'),
        label: (document.querySelector('x-shape[kind="arrow-right"] span') as HTMLElement | null)?.style.zIndex,
        connector: document.querySelector('x-connector svg > path')?.getAttribute('d'),
        marker: Boolean(document.querySelector('x-connector svg > path')?.getAttribute('marker-start')),
        // The connector is drawn in SLIDE coordinates whatever box it sits in.
        offset: (() => {
          const c = document.querySelector('x-connector')!.getBoundingClientRect();
          const s = document.querySelector('section#parts')!.getBoundingClientRect();
          return [Math.round(c.left - s.left), Math.round(c.top - s.top)];
        })(),
        logoLoaded: (document.querySelector('img[src*="logo"]') as HTMLImageElement | null)?.naturalWidth,
      }));

      expect(facts).toEqual({ icon: '0 0 24 24', shape: true, label: '1', connector: 'M200 700 H900 V900', marker: true, offset: [0, 0], logoLoaded: 1 });
    } finally {
      await close();
    }
  }, 60_000);
});
