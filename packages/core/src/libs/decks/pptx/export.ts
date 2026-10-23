/**
 * Writes a rendered deck as a PPTX of native objects.
 *
 * The canvas is 1920 x 1080 px mapped to 13.333 x 7.5 in (144 px per inch;
 * 1 px of font size is half a point). Text boxes carry the computed font,
 * size, weight and colour with zero insets; images and rasters are pictures;
 * shapes are rectangles, rounded rectangles and ellipses.
 *
 * Recognition on the way back rests on two things, either of which is enough
 * to identify the slide:
 *   1. the object name `vocion:<slideId>:<path>` on every object (PowerPoint
 *      and Keynote keep it; Google Slides may drop it),
 *   2. a marker line at the end of the slide's notes carrying the slide id,
 *      a hash of the text of each object as exported, and the other object
 *      names (all three editors keep speaker notes, which is why the marker
 *      lives there and not in a custom XML part that Keynote and Google Slides
 *      discard).
 * A slide with neither is treated as new.
 */

import type { DeckFiles, LayoutObject, SlideLayout, TextObject } from './types';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { formatMarker, normText, parseObjectName, textHash } from './shared';

const PX_PER_IN = 144;
const PT_PER_PX = 0.5;

const inch = (px: number) => px / PX_PER_IN;
const pt = (px: number) => px * PT_PER_PX;

function dataUrl(bytes: Buffer, contentType: string): string {
  return `${contentType};base64,${bytes.toString('base64')}`;
}

/**
 * The text of a text object as it is hashed: runs joined, normalised.
 * @param o - The text object.
 */
export function textOfObject(o: TextObject): string {
  return normText(o.runs.map(r => r.text).join(''));
}

function addText(slide: PptxGenJS.Slide, o: TextObject): void {
  const paragraphs: TextObject['runs'][] = [[]];
  for (const run of o.runs) {
    const lines = run.text.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) {
        paragraphs.push([]);
      }
      if (line !== '') {
        paragraphs.at(-1)!.push({ ...run, text: line });
      }
    });
  }
  const textRuns: PptxGenJS.TextProps[] = [];
  paragraphs.forEach((runs, pi) => {
    const last = pi === paragraphs.length - 1;
    const first = runs[0] ?? o.runs[0]!;
    const para: PptxGenJS.TextPropsOptions = {
      align: o.align,
      lineSpacing: o.lineHeightPx ? pt(o.lineHeightPx) : undefined,
      paraSpaceBefore: 0,
      paraSpaceAfter: 0,
      bullet: o.bullet === 'number' ? { type: 'number', indent: pt(o.indentPx) } : o.bullet === 'bullet' ? { indent: pt(o.indentPx) } : false,
    };
    if (runs.length === 0) {
      textRuns.push({ text: '', options: { ...para, fontFace: first.fontFamily, fontSize: pt(first.sizePx), breakLine: !last } });
      return;
    }
    runs.forEach((r, ri) => {
      textRuns.push({
        text: r.text,
        options: {
          ...(ri === 0 ? para : {}),
          fontFace: r.fontFamily,
          fontSize: pt(r.sizePx),
          bold: r.weight >= 600,
          italic: r.italic,
          underline: r.underline ? { style: 'sng' } : undefined,
          color: r.color,
          charSpacing: o.letterSpacingPx ? pt(o.letterSpacingPx) : undefined,
          breakLine: ri === runs.length - 1 && !last,
        },
      });
    });
  });
  const shift = o.bullet ? o.indentPx : 0;
  slide.addText(textRuns, {
    x: inch(o.box.x - shift),
    y: inch(o.box.y),
    w: inch(o.box.w + shift),
    h: inch(o.box.h),
    margin: 0,
    valign: 'top',
    wrap: true,
    fit: 'none',
    objectName: o.name,
  });
}

function addObject(pres: PptxGenJS, slide: PptxGenJS.Slide, o: LayoutObject): void {
  switch (o.kind) {
    case 'text':
      addText(slide, o);
      return;
    case 'image':
      slide.addImage({ data: dataUrl(o.bytes, o.contentType), x: inch(o.box.x), y: inch(o.box.y), w: inch(o.box.w), h: inch(o.box.h), objectName: o.name, altText: o.alt || o.name });
      return;
    case 'raster':
      slide.addImage({ data: dataUrl(o.png, 'image/png'), x: inch(o.box.x), y: inch(o.box.y), w: inch(o.box.w), h: inch(o.box.h), objectName: o.name, altText: o.name });
      return;
    case 'shape': {
      const type = o.shape === 'ellipse' ? pres.ShapeType.ellipse : o.shape === 'rounded' ? pres.ShapeType.roundRect : pres.ShapeType.rect;
      slide.addShape(type, {
        x: inch(o.box.x),
        y: inch(o.box.y),
        w: inch(o.box.w),
        h: inch(o.box.h),
        fill: o.fill ? { color: o.fill, transparency: Math.round(o.fillTransparency * 100) } : { type: 'none' },
        line: o.borderColor && o.borderPx > 0 ? { color: o.borderColor, width: pt(o.borderPx) } : { type: 'none' },
        rectRadius: o.shape === 'rounded' ? inch(o.radiusPx) : undefined,
        objectName: o.name,
      });
    }
  }
}

/**
 * Exports a deck as a PPTX.
 * @param input - The deck and its measured layouts.
 * @param input.deck - The deck; `order` and `title` are used.
 * @param input.layouts - One layout per slide id (from `measureSlideLayouts`). Slides without a layout are skipped.
 * @returns The PPTX file.
 */
export async function deckToPptx(input: { deck: DeckFiles; layouts: SlideLayout[] }): Promise<Buffer> {
  const { deck, layouts } = input;
  const byId = new Map(layouts.map(l => [l.slideId, l]));
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'VOCION_16x9', width: inch(1920), height: inch(1080) });
  pres.layout = 'VOCION_16x9';
  pres.title = deck.title;

  for (const id of deck.order) {
    const layout = byId.get(id);
    if (!layout) {
      continue;
    }
    const slide = pres.addSlide();
    slide.background = 'color' in layout.background
      ? { color: layout.background.color }
      : { data: dataUrl(layout.background.png, 'image/png') };
    const text: Record<string, string> = {};
    const other: string[] = [];
    for (const o of layout.objects) {
      addObject(pres, slide, o);
      if (o.kind === 'text') {
        const parsed = parseObjectName(o.name);
        if (parsed && !parsed.suffix) {
          text[parsed.path] = textHash(textOfObject(o));
        } else {
          other.push(o.name.slice(`vocion:${id}:`.length));
        }
      } else {
        other.push(o.name.slice(`vocion:${id}:`.length));
      }
    }
    const notes = normText(layout.notes);
    slide.addNotes(`${notes}${notes ? '\n\n' : ''}${formatMarker({ slideId: id, notes: textHash(notes), text, other })}`);
  }

  const out = await pres.write({ outputType: 'nodebuffer' });
  return fixupPptx(Buffer.from(out as Uint8Array));
}

/**
 * Two repairs to what pptxgenjs writes: a stray paragraph-properties element
 * between runs (invalid order), and a carriage return left on each line of the
 * notes.
 * @param buf - The PPTX as written.
 */
async function fixupPptx(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  for (const file of Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
    const xml = await zip.file(file)!.async('string');
    // pptxgenjs repeats a bare <a:pPr> before every run after the first; the schema allows one, first.
    zip.file(file, xml.replace(/(<\/a:r>)<a:pPr[^>]*?(?:\/>|>(?:(?!<\/a:pPr>).)*<\/a:pPr>)/g, '$1'));
  }
  for (const file of Object.keys(zip.files).filter(f => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f))) {
    // pptxgenjs leaves a carriage return at the end of each notes line.
    zip.file(file, (await zip.file(file)!.async('string')).replaceAll('\r', ''));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
