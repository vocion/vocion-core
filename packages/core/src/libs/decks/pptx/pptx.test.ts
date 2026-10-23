import type { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { closeRenderer, renderAvailable, sharedBrowser } from '../../documents/render';
import { deckToPptx } from './export';
import { FIXTURE_DECK, fixturePage } from './fixture';
import { pptxToDeck } from './import';
import { measureSlideLayouts } from './layout';

const available = await renderAvailable();

async function editPptx(buf: Buffer, file: string, fn: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  zip.file(file, fn(await zip.file(file)!.async('string')));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function pipeline() {
  const browser = await sharedBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.setContent(fixturePage());
    const layouts = await measureSlideLayouts(page, FIXTURE_DECK.order);
    const pptx = await deckToPptx({ deck: FIXTURE_DECK, layouts });
    return { layouts, pptx };
  } finally {
    await ctx.close();
  }
}

describe.skipIf(!available.ok)('PPTX adapter (real Chromium)', () => {
  afterAll(() => closeRenderer());

  it('measures native objects, rasters and notes from a rendered deck', async () => {
    const { layouts } = await pipeline();
    const cover = layouts[0]!;

    expect(cover.notes).toBe('Open with the headline number.\nPause for questions.');
    expect('color' in cover.background && cover.background.color).toBe('0F1B2D');

    const names = cover.objects.map(o => o.name);

    expect(names).toContain('vocion:cover:0');
    expect(names).toContain('vocion:cover:1');

    const title = cover.objects.find(o => o.name === 'vocion:cover:0');

    expect(title?.kind).toBe('text');

    if (title?.kind === 'text') {
      expect(title.runs[0]).toMatchObject({ text: 'Northwind quarterly review', sizePx: 96, weight: 700, color: 'FFFFFF' });
      expect(title.lineHeightPx).toBe(110);
    }
    const para = cover.objects.find(o => o.name === 'vocion:cover:1');

    expect(para?.kind === 'text' && para.runs.map(r => [r.text, r.weight])).toEqual([['Prepared for ', 400], ['Kestrel Capital', 700], [' and the Larkfield Systems team.', 400]]);

    // The gradient box is a raster of its own background.
    const grad = cover.objects.find(o => o.name === 'vocion:cover:2~bg');

    expect(grad?.kind).toBe('raster');

    if (grad?.kind === 'raster') {
      // 600 x 120 at 2x
      expect(grad.png.readUInt32BE(16)).toBe(1200);
      expect(grad.png.readUInt32BE(20)).toBe(240);
    }

    const numbers = layouts[1]!;

    expect(numbers.objects.find(o => o.name === 'vocion:numbers:1.0')).toMatchObject({ kind: 'text', bullet: 'bullet' });
    expect(numbers.objects.find(o => o.name === 'vocion:numbers:2~bg')).toMatchObject({ kind: 'shape', shape: 'rounded', fill: 'EEF2F6', borderColor: '1C6D69', borderPx: 4 });
    expect(numbers.objects.find(o => o.name === 'vocion:numbers:3')?.kind).toBe('raster');
    expect(numbers.objects.find(o => o.name === 'vocion:numbers:4')).toMatchObject({ kind: 'image', contentType: 'image/png' });

    const closing = layouts[2]!;
    const thanks = closing.objects.find(o => o.kind === 'text');

    expect(thanks?.kind === 'text' && thanks.runs[0]!.text).toBe('THANK YOU');
  }, 60_000);

  it('round trip with no edits keeps every slide byte for byte', async () => {
    const { pptx } = await pipeline();
    const back = await pptxToDeck(pptx, FIXTURE_DECK);

    expect(back.report).toEqual([{ slideId: 'cover', status: 'kept' }, { slideId: 'numbers', status: 'kept' }, { slideId: 'closing', status: 'kept' }]);
    expect(back.deck).toEqual(FIXTURE_DECK);
    expect(back.newAssets).toEqual([]);
  }, 60_000);

  it('a text edit made in the file comes back as one changed element', async () => {
    const { pptx } = await pipeline();
    const edited = await editPptx(pptx, 'ppt/slides/slide1.xml', xml => xml.replace('<a:t>Kestrel Capital</a:t>', '<a:t>Kestrel Partners</a:t>'));
    const back = await pptxToDeck(edited, FIXTURE_DECK);

    expect(back.report.map(r => [r.slideId, r.status])).toEqual([['cover', 'text-edited'], ['numbers', 'kept'], ['closing', 'kept']]);
    expect(back.deck.slides.cover).toBe(FIXTURE_DECK.slides.cover!.replace('<b>Kestrel Capital</b>', '<b>Kestrel Partners</b>'));
    expect(back.deck.slides.numbers).toBe(FIXTURE_DECK.slides.numbers);
  }, 60_000);

  it('an edit to notes comes back in the aside', async () => {
    const { pptx } = await pipeline();
    const edited = await editPptx(pptx, 'ppt/notesSlides/notesSlide1.xml', xml => xml.replace('Pause for questions.', 'Take questions at the end.'));
    const back = await pptxToDeck(edited, FIXTURE_DECK);

    expect(back.report[0]).toMatchObject({ slideId: 'cover', status: 'text-edited' });
    expect(back.deck.slides.cover).toContain('<p>Take questions at the end.</p>');
    expect(back.deck.slides.cover).toContain('Open with the headline number.');
  }, 60_000);

  it('converts an unrecognised slide, removes a deleted one and follows the file order', async () => {
    const { pptx } = await pipeline();
    const zip = await JSZip.loadAsync(pptx);
    // Slide 2 becomes a foreign slide: strip its marker and object names. Slide 3 is dropped from the list.
    const s2 = (await zip.file('ppt/slides/slide2.xml')!.async('string')).replace(/name="vocion:[^"]*"/g, 'name="Box"');
    zip.file('ppt/slides/slide2.xml', s2);
    zip.file('ppt/notesSlides/notesSlide2.xml', (await zip.file('ppt/notesSlides/notesSlide2.xml')!.async('string')).replace(/\[\[vocion:[^\]]*\]\]/, ''));
    const pres = await zip.file('ppt/presentation.xml')!.async('string');
    const ids = [...pres.matchAll(/<p:sldId [^>]*\/>/g)].map(m => m[0]);

    expect(ids).toHaveLength(3);

    // File order: numbers (now foreign), cover; closing removed.
    zip.file('ppt/presentation.xml', pres.replace(ids.join(''), `${ids[1]}${ids[0]}`));
    const back = await pptxToDeck(await zip.generateAsync({ type: 'nodebuffer' }), FIXTURE_DECK);

    expect(back.deck.order).toEqual(['imported-1', 'cover']);
    expect(back.report.map(r => [r.slideId, r.status])).toEqual([['imported-1', 'added'], ['cover', 'kept'], ['numbers', 'removed'], ['closing', 'removed']]);
    expect(back.deck.slides['imported-1']).toContain('<section id="imported-1"');
    expect(back.deck.slides['imported-1']).toContain('Orders are up eleven percent');
    expect(back.deck.slides['imported-1']).toContain('<img src="asset:imported-1-1.png"');
    expect(back.deck.slides.closing).toBeUndefined();
    expect(back.newAssets.map(a => [a.key, a.contentType])).toEqual([['imported-1-1.png', 'image/png'], ['imported-1-2.png', 'image/png']]);
    expect(back.deck.slides.cover).toBe(FIXTURE_DECK.slides.cover);
  }, 60_000);

  it('reports a moved slide', async () => {
    const { pptx } = await pipeline();
    const zip = await JSZip.loadAsync(pptx);
    const pres = await zip.file('ppt/presentation.xml')!.async('string');
    const ids = [...pres.matchAll(/<p:sldId [^>]*\/>/g)].map(m => m[0]);
    zip.file('ppt/presentation.xml', pres.replace(ids.join(''), `${ids[2]}${ids[0]}${ids[1]}`));
    const back = await pptxToDeck(await zip.generateAsync({ type: 'nodebuffer' }), FIXTURE_DECK);

    expect(back.deck.order).toEqual(['closing', 'cover', 'numbers']);
    expect(back.report.map(r => [r.slideId, r.status])).toEqual([['closing', 'moved'], ['cover', 'kept'], ['numbers', 'kept']]);
  }, 60_000);

  it('converts a recognised slide whose objects were restructured', async () => {
    const { pptx } = await pipeline();
    // Delete the closing slide's title object.
    const edited = await editPptx(pptx, 'ppt/slides/slide3.xml', xml => xml.replace(/<p:sp>[\s\S]*<\/p:sp>/, ''));
    const back = await pptxToDeck(edited, FIXTURE_DECK);

    expect(back.report[2]).toMatchObject({ slideId: 'closing', status: 'converted' });
    expect(back.deck.slides.closing).toContain('<section id="closing"');
    expect(back.deck.slides.closing).not.toBe(FIXTURE_DECK.slides.closing);
  }, 60_000);
});
