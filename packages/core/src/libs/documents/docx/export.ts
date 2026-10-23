/**
 * Writes a paginated HTML document as a DOCX.
 *
 * Each `.sheet` becomes a section (a new US-Letter page). Headings map to
 * Word's heading styles; paragraphs, list items and table cells become
 * paragraphs whose runs keep bold, italic, underline, links and inline
 * colours. Data-URI images go in as inline pictures. Every paragraph is
 * wrapped in a bookmark `vocion_<sheet>_<path>` so the importer can put edited
 * text back at the element it came from.
 */

import type { ParagraphChild } from 'docx';
import type { Element } from '../../decks/pptx/htmlText';
import { Buffer } from 'node:buffer';
import {
  AlignmentType,
  Bookmark,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { elementChildren, isTextLeaf, parseLocated } from '../../decks/pptx/htmlText';
import { bookmarkFor, isSkipped, sheetRoots } from './blocks';

type Style = { bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean; color?: string; superScript?: boolean; subScript?: boolean; font?: string };
type Block = Paragraph | Table;

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const CONTENT_WIDTH_PX = 624;

function hexOf(css: string | undefined): string | undefined {
  if (!css) {
    return undefined;
  }
  const h = /#([0-9a-f]{6})\b/i.exec(css) ?? /#([0-9a-f]{3})\b/i.exec(css);
  if (h) {
    const v = h[1]!;
    return (v.length === 3 ? [...v].map(c => c + c).join('') : v).toUpperCase();
  }
  const m = /rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css);
  return m ? [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : undefined;
}

function styleOf(el: Element, parent: Style): Style {
  const s: Style = { ...parent };
  switch (el.name) {
    case 'b':
    case 'strong':
      s.bold = true;
      break;
    case 'i':
    case 'em':
    case 'cite':
      s.italics = true;
      break;
    case 'u':
    case 'ins':
      s.underline = true;
      break;
    case 's':
    case 'del':
      s.strike = true;
      break;
    case 'sup':
      s.superScript = true;
      break;
    case 'sub':
      s.subScript = true;
      break;
    case 'code':
    case 'kbd':
      s.font = 'Courier New';
      break;
  }
  const css = el.attribs.style ?? '';
  const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(css)?.[1];
  if (hexOf(color)) {
    s.color = hexOf(color);
  }
  if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(css)) {
    s.bold = true;
  }
  if (/font-style\s*:\s*italic/i.test(css)) {
    s.italics = true;
  }
  if (/text-decoration[^;]*underline/i.test(css)) {
    s.underline = true;
  }
  return s;
}

type Part = { t: 'text'; text: string; st: Style } | { t: 'br' } | { t: 'link'; href: string; parts: Part[] };

/**
 * Runs for the inline content of a leaf block. Whitespace is collapsed the way
 * `textOfElement` collapses it, so the text Word holds equals the text the
 * importer compares against.
 * @param el - The leaf block.
 * @param base - Style the block starts with (bold for header cells).
 */
function inlineRuns(el: Element, base: Style = {}): ParagraphChild[] {
  let text = '';
  let lastText: Extract<Part, { t: 'text' }> | null = null;
  const rec = (parent: Element, st: Style): Part[] => {
    const parts: Part[] = [];
    for (const c of parent.children) {
      if (c.type === 'text') {
        let t = c.data.replace(/\s+/g, ' ');
        if (text === '' || text.endsWith(' ') || text.endsWith('\n')) {
          t = t.replace(/^ /, '');
        }
        if (t !== '') {
          text += t;
          lastText = { t: 'text', text: t, st };
          parts.push(lastText);
        }
      } else if (c.type === 'tag') {
        if (c.name === 'br') {
          if (text.endsWith(' ') && lastText) {
            lastText.text = lastText.text.slice(0, -1);
            text = text.slice(0, -1);
          }
          text += '\n';
          parts.push({ t: 'br' });
        } else if (c.name === 'a' && /^(?:https?:|mailto:)/i.test(c.attribs.href ?? '')) {
          parts.push({ t: 'link', href: c.attribs.href!, parts: rec(c, { ...styleOf(c, st), underline: true, color: st.color ?? '0563C1' }) });
        } else {
          parts.push(...rec(c, styleOf(c, st)));
        }
      }
    }
    return parts;
  };
  const parts = rec(el, base);
  if (text.endsWith(' ') && lastText) {
    (lastText as Extract<Part, { t: 'text' }>).text = (lastText as Extract<Part, { t: 'text' }>).text.slice(0, -1);
  }
  const build = (ps: Part[]): TextRun[] => ps.flatMap((p): TextRun[] => {
    if (p.t === 'br') {
      return [new TextRun({ break: 1 })];
    }
    if (p.t === 'link') {
      return build(p.parts);
    }
    return p.text === '' ? [] : [new TextRun({ text: p.text, bold: p.st.bold, italics: p.st.italics, underline: p.st.underline ? {} : undefined, strike: p.st.strike, color: p.st.color, superScript: p.st.superScript, subScript: p.st.subScript, font: p.st.font })];
  });
  return parts.map((p): ParagraphChild[] => (p.t === 'link' ? [new ExternalHyperlink({ link: p.href, children: build(p.parts) })] : build([p]))).flat();
}

function imageSize(bytes: Buffer, type: string): { w: number; h: number } | null {
  try {
    if (type === 'png') {
      return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
    }
    if (type === 'gif') {
      return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) };
    }
    if (type === 'jpg') {
      let i = 2;
      while (i < bytes.length) {
        if (bytes[i] !== 0xFF) {
          i++;
          continue;
        }
        const marker = bytes[i + 1]!;
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
        }
        i += 2 + bytes.readUInt16BE(i + 2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function imageParagraph(el: Element): Paragraph | null {
  const src = el.attribs.src ?? '';
  const m = /^data:image\/(png|jpe?g|gif);base64,([\s\S]*)$/i.exec(src);
  const alt = el.attribs.alt ?? '';
  if (!m) {
    return alt ? new Paragraph({ children: [new TextRun({ text: `[image: ${alt}]`, italics: true })] }) : null;
  }
  const type = m[1]!.toLowerCase().startsWith('jp') ? 'jpg' : (m[1]!.toLowerCase() as 'png' | 'gif');
  const data = Buffer.from(m[2]!, 'base64');
  const natural = imageSize(data, type) ?? { w: 300, h: 200 };
  const css = el.attribs.style ?? '';
  const attrW = Number(el.attribs.width) || Number(/width\s*:\s*([\d.]+)px/i.exec(css)?.[1]) || 0;
  const attrH = Number(el.attribs.height) || Number(/height\s*:\s*([\d.]+)px/i.exec(css)?.[1]) || 0;
  let w = attrW || (attrH ? (attrH * natural.w) / natural.h : natural.w);
  let h = attrH || (attrW ? (attrW * natural.h) / natural.w : natural.h);
  if (w > CONTENT_WIDTH_PX) {
    h = (h * CONTENT_WIDTH_PX) / w;
    w = CONTENT_WIDTH_PX;
  }
  return new Paragraph({
    children: [new ImageRun({ type, data, transformation: { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }, altText: { name: alt || 'image', description: alt, title: alt } })],
  });
}

type Ctx = { sheet: number; olCount: { n: number }; numbering: Array<{ reference: string }> };

function leafParagraph(el: Element, path: number[], ctx: Ctx, extra: { listLevel?: number; ordered?: string } = {}): Paragraph {
  const heading = /^h([1-6])$/.exec(el.name);
  const children = inlineRuns(el, el.name === 'th' ? { bold: true } : {});
  return new Paragraph({
    heading: heading ? HEADINGS[Number(heading[1]) - 1] : undefined,
    bullet: extra.listLevel !== undefined && !extra.ordered ? { level: Math.min(extra.listLevel, 8) } : undefined,
    numbering: extra.ordered ? { reference: extra.ordered, level: Math.min(extra.listLevel ?? 0, 8) } : undefined,
    children: [new Bookmark({ id: bookmarkFor(ctx.sheet, path.join('.')), children: children as TextRun[] })],
  });
}

function tableOf(el: Element, path: number[], ctx: Ctx): Table {
  const rows: Element[] = [];
  const collect = (e: Element) => {
    for (const c of elementChildren(e)) {
      if (c.name === 'tr') {
        rows.push(c);
      } else if (['thead', 'tbody', 'tfoot'].includes(c.name)) {
        collect(c);
      }
    }
  };
  collect(el);
  const cols = Math.max(1, ...rows.map(r => elementChildren(r).filter(c => c.name === 'td' || c.name === 'th').length));
  // Child indices are over the real DOM, so find each row and cell by identity.
  const indexPath = (target: Element): number[] => {
    const trail: number[] = [];
    let cur: Element | null = target;
    while (cur && cur !== el) {
      const parent = cur.parent as Element | null;
      if (!parent) {
        break;
      }
      trail.unshift(elementChildren(parent).indexOf(cur));
      cur = parent;
    }
    return [...path, ...trail];
  };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: cols }, () => Math.floor(9360 / cols)),
    rows: rows.map(r => new TableRow({
      children: elementChildren(r).filter(c => c.name === 'td' || c.name === 'th').map((cell) => {
        const cp = indexPath(cell);
        const content: Block[] = isTextLeaf(cell) ? [leafParagraph(cell, cp, ctx)] : blocksOf(cell, cp, ctx);
        return new TableCell({ children: content.length > 0 ? content : [new Paragraph({})], columnSpan: Number(cell.attribs.colspan) > 1 ? Number(cell.attribs.colspan) : undefined });
      }),
    })),
  });
}

function blocksOf(parent: Element, path: number[], ctx: Ctx, list?: { level: number; ordered?: string }): Block[] {
  const out: Block[] = [];
  elementChildren(parent).forEach((c, i) => {
    if (isSkipped(c)) {
      return;
    }
    const p = [...path, i];
    if (c.name === 'table') {
      out.push(tableOf(c, p, ctx));
    } else if (c.name === 'img') {
      const para = imageParagraph(c);
      if (para) {
        out.push(para);
      }
    } else if (isTextLeaf(c)) {
      out.push(leafParagraph(c, p, ctx, c.name === 'li' && list ? { listLevel: list.level, ordered: list.ordered } : {}));
    } else if (c.name === 'ul' || c.name === 'ol') {
      let ordered: string | undefined;
      if (c.name === 'ol') {
        ordered = `vocion-ol-${++ctx.olCount.n}`;
        ctx.numbering.push({ reference: ordered });
      }
      out.push(...blocksOf(c, p, ctx, { level: list ? list.level + 1 : 0, ordered }));
    } else {
      out.push(...blocksOf(c, p, ctx, c.name === 'li' && list ? list : undefined));
    }
  });
  return out;
}

/**
 * Exports a document as a DOCX.
 * @param input - The document.
 * @param input.html - The document's HTML: `.sheet` articles in order.
 * @param input.title - The document title, written to the file's properties.
 * @returns The DOCX file.
 */
export async function documentToDocx(input: { html: string; title: string }): Promise<Buffer> {
  const { $ } = parseLocated(input.html, true);
  const numbering: Ctx['numbering'] = [];
  const olCount = { n: 0 };
  const sections = sheetRoots($).map((root, i) => ({
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
    children: (() => {
      const blocks = blocksOf(root, [], { sheet: i + 1, olCount, numbering });
      return blocks.length > 0 ? blocks : [new Paragraph({})];
    })(),
  }));
  const doc = new Document({
    title: input.title,
    creator: 'Vocion',
    numbering: {
      config: numbering.map(n => ({
        reference: n.reference,
        levels: Array.from({ length: 9 }, (_, level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })),
      })),
    },
    sections: sections.length > 0 ? sections : [{ children: [new Paragraph({})] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
