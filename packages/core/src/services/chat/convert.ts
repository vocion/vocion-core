/**
 * Office files, mail and tables turned into something a model reads.
 *
 * A spreadsheet becomes tables, a document becomes text with its headings, a
 * deck becomes one section per slide, an email becomes its headers and body.
 * Two readings of every file:
 *
 *   - the PREVIEW (`convertForModel`), made once at upload and stored on the
 *     artifact: what the model sees under the message. A big sheet is
 *     summarised — its columns, its row count and its first rows — because
 *     5,000 leads inlined would swamp the turn and still be cut;
 *   - the FULL reading (`readTables`, `readFullText`), made on demand from the
 *     stored original by `read_attachment`, so "analyse all the leads" works
 *     on every row, a page or a filter at a time.
 *
 * Server-only, and every parser is imported lazily inside the function that
 * needs it: none of them is in a route's static graph, and next.config.ts
 * keeps them out of the bundle (`serverExternalPackages`). SheetJS reads every
 * spreadsheet format (xlsx, xlsm, xls, ods, csv, tsv); the zip-based document
 * formats are read with `fflate` and a small XML walker here, which is all
 * text extraction needs; mail goes through `postal-mime` and `msgreader`.
 */

import type { Buffer } from 'node:buffer';
import type { AttachmentFormat } from '@/libs/chat/attachmentFormats';

/** One sheet, as rows of display text. `header` is its first non-empty row. */
export type SheetTable = {
  name: string;
  header: string[];
  rows: string[][];
};

/** What the model gets at upload, plus the shape a later tool call can name. */
export type Conversion = {
  text: string;
  sheets?: Array<{ name: string; rows: number; columns: string[] }>;
  slides?: number;
};

/** A sheet at or under this many rows is inlined whole. */
export const SMALL_SHEET_ROWS = 50;
/** A bigger sheet shows this many rows, then says how many more there are. */
export const PREVIEW_ROWS = 20;
/** A preview cell is cut here; the tool reads the whole value. */
const PREVIEW_CELL_CHARS = 80;
/** Sheets past this many are listed by name only in the preview. */
const PREVIEW_SHEETS = 12;
/** No single entry inside an Office zip is inflated past this — a guard against zip bombs. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

const TOOL_HINT = 'read_attachment';

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * The preview the model reads under the message, for a file of any accepted
 * document family. Images never come here.
 * @param data - The file's bytes.
 * @param format - Its resolved format.
 */
export async function convertForModel(data: Buffer, format: AttachmentFormat): Promise<Conversion> {
  switch (format.family) {
    case 'sheet': {
      const sheets = await readTables(data, format);
      return { text: sheetsPreview(sheets, format), sheets: sheets.map(s => ({ name: s.name, rows: s.rows.length, columns: s.header })) };
    }
    case 'slides': {
      const slides = await readSlides(data, format);
      return { text: slides.map(slideText).join('\n\n'), slides: slides.length };
    }
    default:
      return { text: await readFullText(data, format) };
  }
}

/**
 * Every sheet of a spreadsheet (or the one table of a CSV / TSV), as text.
 * Values are what the cell DISPLAYS — a date reads as a date, a currency as
 * its formatted amount — because that is what a person asking about the
 * sheet is looking at.
 * @param data - The file's bytes.
 * @param format - A `sheet` format.
 */
export async function readTables(data: Buffer, format: AttachmentFormat): Promise<SheetTable[]> {
  const XLSX = await import('xlsx');
  const text = format.ext === 'csv' || format.ext === 'tsv';
  const wb = text
    ? XLSX.read(stripBom(data.toString('utf8')), { type: 'string', dense: true, raw: true, ...(format.ext === 'tsv' ? { FS: '\t' } : {}) } as never)
    : XLSX.read(data, { type: 'buffer', dense: true, cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false });
  const out: SheetTable[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) {
      continue;
    }
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
      .map(r => r.map(cellText));
    out.push(toTable(name, grid));
  }
  return out;
}

/**
 * The whole text of a non-tabular document: a Word or OpenDocument file with
 * its headings as markdown, every slide of a deck, an email, a PDF, a text file.
 * @param data - The file's bytes.
 * @param format - A non-image, non-sheet format.
 */
export async function readFullText(data: Buffer, format: AttachmentFormat): Promise<string> {
  switch (format.family) {
    case 'pdf': {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(data) });
      try {
        return normalise((await parser.getText()).text);
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
    case 'doc':
      return normalise(format.ext === 'docx' ? await docxText(data) : await odtText(data));
    case 'slides':
      return (await readSlides(data, format)).map(slideText).join('\n\n');
    case 'mail':
      return normalise(format.ext === 'msg' ? await msgText(data) : await emlText(data));
    case 'sheet':
      return (await readTables(data, format)).map(s => `## ${s.name}\n${csvOf([s.header, ...s.rows])}`).join('\n\n');
    default:
      return normalise(stripBom(data.toString('utf8')));
  }
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function cellText(v: unknown): string {
  if (v === null || v === undefined) {
    return '';
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  }
  return String(v).replace(/\r\n?/g, '\n').trim();
}

function toTable(name: string, grid: string[][]): SheetTable {
  const rows = grid.filter(r => r.some(c => c !== ''));
  const width = rows.reduce((w, r) => {
    let last = r.length - 1;
    while (last >= 0 && r[last] === '') {
      last -= 1;
    }
    return Math.max(w, last + 1);
  }, 0);
  const [head = [], ...body] = rows;
  const seen = new Map<string, number>();
  const header = Array.from({ length: width }, (_, i) => {
    const base = head[i]?.replace(/\s+/g, ' ').trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  return { name, header, rows: body.map(r => Array.from({ length: width }, (_, i) => r[i] ?? '')) };
}

function mdCell(v: string, cap = PREVIEW_CELL_CHARS): string {
  const one = v.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
  return one.length > cap ? `${one.slice(0, cap - 1)}…` : one;
}

/**
 * Rows as a markdown table.
 * @param header - Column names.
 * @param rows - The rows to show.
 * @param cap - Per-cell character cap.
 */
export function markdownTable(header: string[], rows: string[][], cap = PREVIEW_CELL_CHARS): string {
  if (header.length === 0) {
    return '(empty)';
  }
  const line = (cells: string[]) => `| ${cells.map(c => mdCell(c, cap)).join(' | ')} |`;
  return [line(header), `| ${header.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n');
}

/**
 * Rows as CSV, quoted where a value needs it.
 * @param rows - Header first, if wanted.
 */
export function csvOf(rows: string[][]): string {
  return rows.map(r => r.map(v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n');
}

const n = (x: number) => x.toLocaleString('en-US');

function sheetsPreview(sheets: SheetTable[], format: AttachmentFormat): string {
  if (sheets.length === 0 || sheets.every(s => s.header.length === 0)) {
    return '(This file has no data in it.)';
  }
  const parts: string[] = [];
  const many = sheets.length > 1;
  if (many) {
    parts.push(`${format.label} with ${sheets.length} sheets: ${sheets.map(s => `“${s.name}” (${n(s.rows.length)} row${s.rows.length === 1 ? '' : 's'})`).join(', ')}.`);
  }
  for (const s of sheets.slice(0, PREVIEW_SHEETS)) {
    const head = `## ${many ? `Sheet “${s.name}” — ` : ''}${n(s.rows.length)} row${s.rows.length === 1 ? '' : 's'} × ${s.header.length} column${s.header.length === 1 ? '' : 's'}`;
    if (s.header.length === 0) {
      parts.push(`${head}\n(empty)`);
      continue;
    }
    if (s.rows.length <= SMALL_SHEET_ROWS) {
      parts.push(`${head}\n${markdownTable(s.header, s.rows)}`);
      continue;
    }
    parts.push([
      head,
      `Columns: ${s.header.join(', ')}`,
      `First ${PREVIEW_ROWS} rows:`,
      markdownTable(s.header, s.rows.slice(0, PREVIEW_ROWS)),
      `(${n(s.rows.length - PREVIEW_ROWS)} more rows not shown. Read, filter or count every row with ${TOOL_HINT}.)`,
    ].join('\n'));
  }
  if (sheets.length > PREVIEW_SHEETS) {
    parts.push(`(${sheets.length - PREVIEW_SHEETS} more sheets not shown: ${sheets.slice(PREVIEW_SHEETS).map(s => `“${s.name}”`).join(', ')}.)`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Zip-based documents (docx, pptx, odt, odp)
// ---------------------------------------------------------------------------

async function unzip(data: Buffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), {
    filter: f => wanted(f.name) && f.originalSize <= MAX_INFLATED_BYTES,
  });
  return new Map(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'', nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

function attrsOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return out;
}

/**
 * The element names one XML vocabulary uses for the things text extraction
 * cares about. One walker, three dialects (WordprocessingML, DrawingML,
 * OpenDocument).
 */
type Dialect = {
  para: string[];
  /** Text counts only inside these; null = any text inside a paragraph. */
  textIn: string[] | null;
  tab: string[];
  br: string[];
  /** `text:s` — a run of spaces, `text:c` long. */
  space?: string;
  table: string;
  row: string;
  cell: string;
  listItem?: string;
  /** The heading level an element (or a property inside a paragraph) sets. */
  heading: (name: string, attrs: Record<string, string>) => number | null;
  /** A property inside a paragraph marking it as a list item. */
  listMark?: string;
};

const WORD: Dialect = {
  para: ['w:p'],
  textIn: ['w:t'],
  tab: ['w:tab'],
  br: ['w:br', 'w:cr'],
  table: 'w:tbl',
  row: 'w:tr',
  cell: 'w:tc',
  listMark: 'w:numPr',
  heading: (name, a) => {
    if (name === 'w:pStyle') {
      const v = (a['w:val'] ?? '').toLowerCase();
      if (v === 'title') {
        return 1;
      }
      const m = /heading\s*(\d)/.exec(v);
      return m ? Number(m[1]) : null;
    }
    if (name === 'w:outlineLvl') {
      const v = Number(a['w:val']);
      return Number.isInteger(v) && v < 9 ? v + 1 : null;
    }
    return null;
  },
};

const DRAWING: Dialect = {
  para: ['a:p'],
  textIn: ['a:t'],
  tab: ['a:tab'],
  br: ['a:br'],
  table: 'a:tbl',
  row: 'a:tr',
  cell: 'a:tc',
  heading: () => null,
};

const OPEN_DOC: Dialect = {
  para: ['text:p', 'text:h'],
  textIn: null,
  tab: ['text:tab'],
  br: ['text:line-break'],
  space: 'text:s',
  table: 'table:table',
  row: 'table:table-row',
  cell: 'table:table-cell',
  listItem: 'text:list-item',
  heading: (name, a) => (name === 'text:h' ? Math.max(1, Math.min(6, Number(a['text:outline-level']) || 1)) : null),
};

/**
 * Walk one XML part and write it out as markdown-ish text: a paragraph per
 * line, headings as `#`, list items as `-`, tables as markdown tables.
 * @param xml - The part.
 * @param d - Its dialect.
 */
function xmlToText(xml: string, d: Dialect): string {
  const out: string[] = [];
  const paraSet = new Set(d.para);
  const textSet = d.textIn ? new Set(d.textIn) : null;
  let inPara = 0;
  let inText = 0;
  let buf = '';
  let level: number | null = null;
  let listed = false;
  let listDepth = 0;
  // Tables: only the outermost is laid out; a nested table's text joins its cell.
  let tableDepth = 0;
  let table: string[][] = [];
  let row: string[] = [];
  let cell: string[] = [];

  const flushPara = () => {
    const text = buf.replace(/[ \t\xA0]+/g, ' ').replace(/ *\n */g, '\n').trim();
    buf = '';
    if (tableDepth > 0) {
      if (text) {
        cell.push(text);
      }
    } else if (text) {
      const prefix = level ? `${'#'.repeat(Math.min(level, 6))} ` : (listed || listDepth > 0) ? '- ' : '';
      out.push(`${prefix}${text}`);
    }
    level = null;
    listed = false;
  };

  for (const m of xml.matchAll(/<(\/?)([\w:.-]+)((?:\s[^>]*?)?)(\/?)>|([^<]+)/g)) {
    const [, close, name, rawAttrs, selfClose, textNode] = m;
    if (textNode !== undefined) {
      if (inPara > 0 && (textSet ? inText > 0 : true)) {
        buf += decodeEntities(textNode);
      }
      continue;
    }
    if (!name || name.startsWith('?') || name.startsWith('!')) {
      continue;
    }
    if (close) {
      if (paraSet.has(name)) {
        inPara = Math.max(0, inPara - 1);
        if (inPara === 0) {
          flushPara();
        }
      } else if (textSet?.has(name)) {
        inText = Math.max(0, inText - 1);
      } else if (name === d.listItem) {
        listDepth = Math.max(0, listDepth - 1);
      } else if (name === d.cell && tableDepth === 1) {
        row.push(cell.join(' '));
        cell = [];
      } else if (name === d.row && tableDepth === 1) {
        table.push(row);
        row = [];
      } else if (name === d.table) {
        tableDepth -= 1;
        if (tableDepth === 0) {
          const rows = table.filter(r => r.some(c => c));
          if (rows.length > 0) {
            const width = Math.max(...rows.map(r => r.length));
            const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
            out.push(markdownTable(pad(rows[0]!), rows.slice(1).map(pad), 400));
          }
          table = [];
        }
      }
      continue;
    }
    const attrs = rawAttrs ? attrsOf(rawAttrs) : {};
    if (paraSet.has(name)) {
      if (!selfClose) {
        if (inPara === 0) {
          buf = '';
        }
        inPara += 1;
      }
      const h = d.heading(name, attrs);
      if (h) {
        level = h;
      }
      continue;
    }
    if (textSet?.has(name)) {
      if (!selfClose) {
        inText += 1;
      }
      continue;
    }
    if (name === d.table && !selfClose) {
      tableDepth += 1;
      continue;
    }
    if (name === d.listItem && !selfClose) {
      listDepth += 1;
      continue;
    }
    if (inPara > 0) {
      if (d.tab.includes(name)) {
        buf += '\t';
      } else if (d.br.includes(name)) {
        buf += '\n';
      } else if (name === d.space) {
        buf += ' '.repeat(Math.min(Number(attrs['text:c']) || 1, 8));
      } else if (name === d.listMark) {
        listed = true;
      } else {
        const h = d.heading(name, attrs);
        if (h) {
          level = h;
        }
      }
    }
  }
  return out.join('\n\n');
}

async function docxText(data: Buffer): Promise<string> {
  const files = await unzip(data, n => n === 'word/document.xml');
  const xml = files.get('word/document.xml');
  if (xml === undefined) {
    throw new Error('not a Word document');
  }
  return xmlToText(xml, WORD);
}

async function odtText(data: Buffer): Promise<string> {
  const files = await unzip(data, n => n === 'content.xml');
  const xml = files.get('content.xml');
  if (xml === undefined) {
    throw new Error('not an OpenDocument file');
  }
  return xmlToText(xml, OPEN_DOC);
}

/** One slide of a deck. */
export type Slide = { index: number; title: string; body: string; notes: string };

function slideText(s: Slide): string {
  const head = `## Slide ${s.index}${s.title ? `: ${s.title}` : ''}`;
  return [head, s.body, s.notes ? `Speaker notes: ${s.notes}` : ''].filter(Boolean).join('\n\n');
}

/**
 * Footer, date and slide-number placeholders say nothing about the slide.
 * @param xml
 */
function dropChrome(xml: string): string {
  return xml.replace(/<p:sp\b(?:(?!<\/p:sp>)[\s\S])*?<p:ph\s[^>]*type="(?:sldNum|dt|ftr|hdr|sldImg)"[\s\S]*?<\/p:sp>/g, '');
}

function titleOf(xml: string): string {
  const m = /<p:sp\b(?:(?!<\/p:sp>)[\s\S])*?<p:ph\s[^>]*type="(?:title|ctrTitle)"[\s\S]*?<\/p:sp>/.exec(xml);
  return m ? xmlToText(m[0], DRAWING).replace(/\s+/g, ' ').trim() : '';
}

function withoutTitle(body: string, title: string): string {
  if (!title) {
    return body;
  }
  const lines = body.split('\n\n');
  const at = lines.findIndex(l => l.replace(/\s+/g, ' ').trim() === title);
  if (at >= 0) {
    lines.splice(at, 1);
  }
  return lines.join('\n\n');
}

function resolvePart(base: string, target: string): string {
  const parts = `${base.slice(0, base.lastIndexOf('/') + 1)}${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') {
      out.pop();
    } else if (p && p !== '.') {
      out.push(p);
    }
  }
  return out.join('/');
}

function relsOf(xml: string | undefined): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  for (const m of (xml ?? '').matchAll(/<Relationship\b([^>]*)>/g)) {
    const a = attrsOf(m[1]!);
    if (a.Id && a.Target) {
      map.set(a.Id, { target: a.Target, type: a.Type ?? '' });
    }
  }
  return map;
}

/**
 * The slides of a deck, in the order the deck presents them.
 * @param data - The file's bytes.
 * @param format - `pptx` or `odp`.
 */
export async function readSlides(data: Buffer, format: AttachmentFormat): Promise<Slide[]> {
  if (format.ext === 'odp') {
    const files = await unzip(data, n => n === 'content.xml');
    const xml = files.get('content.xml');
    if (xml === undefined) {
      throw new Error('not an OpenDocument file');
    }
    return [...xml.matchAll(/<draw:page\b([^>]*)>([\s\S]*?)<\/draw:page>/g)].map((m, i) => {
      const inner = m[2]!;
      const notesXml = /<presentation:notes\b[\s\S]*?<\/presentation:notes>/.exec(inner)?.[0] ?? '';
      const body = xmlToText(inner.replace(notesXml, ''), OPEN_DOC);
      const [first = '', ...rest] = body.split('\n\n');
      return { index: i + 1, title: first.replace(/^- /, ''), body: rest.join('\n\n'), notes: xmlToText(notesXml, OPEN_DOC).replace(/\n+/g, ' ') };
    });
  }
  const files = await unzip(data, n => /^ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(?:_rels\/)?slide\d+\.xml(?:\.rels)?|notesSlides\/notesSlide\d+\.xml)$/.test(n));
  const rels = relsOf(files.get('ppt/_rels/presentation.xml.rels'));
  let order = [...(files.get('ppt/presentation.xml') ?? '').matchAll(/<p:sldId\b([^>]*)>/g)]
    .map(m => rels.get(attrsOf(m[1]!)['r:id'] ?? '')?.target)
    .filter((t): t is string => Boolean(t))
    .map(t => resolvePart('ppt/presentation.xml', t))
    .filter(p => files.has(p));
  if (order.length === 0) {
    order = [...files.keys()].filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  }
  if (order.length === 0 && !files.has('ppt/presentation.xml')) {
    throw new Error('not a PowerPoint deck');
  }
  return order.map((part, i) => {
    const xml = dropChrome(files.get(part)!);
    const title = titleOf(xml);
    const slideRels = relsOf(files.get(part.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')));
    const notesTarget = [...slideRels.values()].find(r => r.type.endsWith('/notesSlide'))?.target;
    const notesXml = notesTarget ? files.get(resolvePart(part, notesTarget)) : undefined;
    // The notes page repeats the slide's image placeholder and its number; only its body is notes.
    const notes = notesXml ? xmlToText(dropChrome(notesXml), DRAWING).replace(/\n+/g, ' ').trim() : '';
    return { index: i + 1, title, body: withoutTitle(xmlToText(xml, DRAWING), title), notes };
  });
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ''));
}

function mailText(m: { subject?: string; from?: string; to?: string; cc?: string; date?: string; body: string; attachments: string[] }): string {
  const head = [
    m.subject ? `Subject: ${m.subject}` : '',
    m.from ? `From: ${m.from}` : '',
    m.to ? `To: ${m.to}` : '',
    m.cc ? `Cc: ${m.cc}` : '',
    m.date ? `Date: ${m.date}` : '',
    m.attachments.length > 0 ? `Attachments: ${m.attachments.join(', ')}` : '',
  ].filter(Boolean);
  return `${head.join('\n')}\n\n${m.body.trim()}`;
}

type Addr = { name?: string; address?: string; group?: Addr[] } | undefined;
const addr = (a: Addr): string => (a ? (a.group ? a.group.map(addr).join(', ') : a.name && a.address ? `${a.name} <${a.address}>` : a.address ?? a.name ?? '') : '');

async function emlText(data: Buffer): Promise<string> {
  const { default: PostalMime } = await import('postal-mime');
  const m = await PostalMime.parse(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return mailText({
    subject: m.subject,
    from: addr(m.from as Addr),
    to: (m.to ?? []).map(a => addr(a as Addr)).join(', '),
    cc: (m.cc ?? []).map(a => addr(a as Addr)).join(', '),
    date: m.date,
    body: m.text ?? (m.html ? htmlToText(m.html) : ''),
    attachments: (m.attachments ?? []).map(a => a.filename ?? '').filter(Boolean),
  });
}

async function msgText(data: Buffer): Promise<string> {
  const { default: MsgReader } = await import('@kenjiuno/msgreader');
  const reader = new MsgReader(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const m = reader.getFileData();
  if (m.error) {
    throw new Error(m.error);
  }
  const recipients = (m.recipients ?? []) as Array<{ name?: string; email?: string; smtpAddress?: string; recipType?: string }>;
  const who = (r: { name?: string; email?: string; smtpAddress?: string }) => {
    const email = r.smtpAddress ?? r.email;
    return r.name && email && r.name !== email ? `${r.name} <${email}>` : email ?? r.name ?? '';
  };
  return mailText({
    subject: m.subject,
    from: m.senderName && m.senderEmail ? `${m.senderName} <${m.senderEmail}>` : m.senderEmail ?? m.senderName,
    to: recipients.filter(r => r.recipType !== 'cc' && r.recipType !== 'bcc').map(who).join(', '),
    cc: recipients.filter(r => r.recipType === 'cc').map(who).join(', '),
    date: m.messageDeliveryTime ?? m.clientSubmitTime,
    body: m.body ?? (m.bodyHtml ? htmlToText(m.bodyHtml) : ''),
    attachments: (m.attachments ?? []).map(a => a.fileName ?? a.fileNameShort ?? '').filter(Boolean),
  });
}

// ---------------------------------------------------------------------------

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

/**
 * Tidy extracted text: one newline style, no trailing spaces, at most one blank line.
 * @param text - Raw text.
 */
export function normalise(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
