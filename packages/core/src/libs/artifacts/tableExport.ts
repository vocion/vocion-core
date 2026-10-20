/**
 * An artifact's tables, as a spreadsheet.
 *
 * Chris, 2026-10-20, before the Metacto Finance demo: "can we show export into
 * sheets?" A finance document is mostly tables — the scorecard, the balance
 * sheet, the driver bridge — and the person reading it wants them in a
 * spreadsheet to work with, not to retype them from the PDF.
 *
 * Two sources, one shape:
 *   - a `document` artifact: every `<table>` in its HTML, named by the heading
 *     above it (or its `<caption>`), one sheet each;
 *   - a `table` artifact: its rows, typed by its columns.
 *
 * Numbers go in as numbers. A cell that reads "454,313.34", "-$47,671.78",
 * "(1,200)" or "-14.0%" is the number it says, with a display format that
 * prints it the way the document did; anything else ("-34.8 pts", "1. Delivery
 * cost up", a date) stays the text it was. Nothing is guessed: a cell is a
 * number only when the whole cell is one.
 *
 * The .xlsx opens in Excel, Numbers and Google Sheets (File › Import, or drop
 * it into Drive). There is no "Open in Google Sheets" here: every Drive
 * connection Vocion holds is `drive.readonly`, so creating a Sheet would mean
 * a new OAuth scope — a separate decision, not a side effect of an export.
 */

import type { CellValue, DataTableSpec } from '@/libs/cards/specs';
import { Buffer } from 'node:buffer';
import { load } from 'cheerio';

/** One cell: its value and, for a number, the Excel display format. */
export type ExportCell = { v: string | number; z?: string };

/** One table, ready to become a sheet. */
export type ExportTable = { name: string; rows: ExportCell[][] };

const CURRENCY_HEADERS = /^(?:usd|\$|amount|amount \(usd\))$/i;

/**
 * The number a cell's whole text says, with the format that prints it the
 * same way — or null when the cell is not (only) a number.
 * @param raw - The cell's text as the document shows it.
 * @param currencyTable - The table's corner header says its money is USD, so
 *   a bare "1,234.56" is dollars.
 */
export function parseNumericCell(raw: string, currencyTable = false): ExportCell | null {
  let s = raw.replace(/\xA0/g, ' ').trim();
  if (s === '') {
    return null;
  }
  // Unicode minus and the dashes a writer types for it.
  s = s.replace(/^[−–—]/, '-');
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1]!.trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  let dollar = false;
  if (s.startsWith('$')) {
    dollar = true;
    s = s.slice(1).trim();
  }
  // "-$5" and "$-5" both read as negative five dollars.
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  // Digits with optional thousands separators and an optional fraction — the
  // whole of what is left, or it is not a number.
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) {
    return null;
  }
  const decimals = s.includes('.') ? s.split('.')[1]!.length : 0;
  const grouped = s.includes(',');
  let n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) {
    return null;
  }
  if (negative) {
    n = -n;
  }
  const frac = decimals > 0 ? `.${'0'.repeat(Math.min(decimals, 4))}` : '';
  if (percent) {
    return { v: n / 100, z: `0${frac}%` };
  }
  if (dollar || currencyTable) {
    return { v: n, z: `"$"#,##0${frac}` };
  }
  if (grouped || decimals > 0) {
    return { v: n, z: `#,##0${frac}` };
  }
  return { v: n };
}

/**
 * Whitespace collapsed, the way the cell reads on the page.
 * @param text
 */
function cellText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Every table in a document's HTML, each named by the heading above it.
 * @param html - The document's self-contained HTML.
 * @param fallbackName - For a table no heading names.
 */
export function tablesFromHtml(html: string, fallbackName = 'Table'): ExportTable[] {
  const $ = load(html);
  const out: ExportTable[] = [];
  let heading: string | null = null;
  // `$(selector)` walks in document order, so the last heading seen is the
  // one above this table.
  $('h1, h2, h3, h4, table').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (tag !== 'table') {
      heading = cellText($(el).text()) || heading;
      return;
    }
    // A table nested in another table's cell is that cell's content.
    if ($(el).parents('table').length > 0) {
      return;
    }
    const caption = cellText($(el).children('caption').first().text());
    const trs = $(el).find('tr').filter((_, tr) => $(tr).closest('table').is(el));
    const texts: string[][] = [];
    trs.each((_, tr) => {
      const row: string[] = [];
      $(tr).children('th, td').each((_, cell) => {
        row.push(cellText($(cell).text()));
        const span = Number($(cell).attr('colspan') ?? 1);
        for (let i = 1; i < Math.min(Number.isFinite(span) ? span : 1, 50); i++) {
          row.push('');
        }
      });
      if (row.length > 0) {
        texts.push(row);
      }
    });
    if (texts.length === 0) {
      return;
    }
    const currencyTable = CURRENCY_HEADERS.test(texts[0]![0] ?? '');
    const rows = texts.map((row, r) => row.map((t): ExportCell => {
      // The header row stays words, even a header that is a year.
      if (r === 0 && trs.eq(0).children('th').length > 0) {
        return { v: t };
      }
      return parseNumericCell(t, currencyTable) ?? { v: t };
    }));
    out.push({ name: caption || heading || `${fallbackName} ${out.length + 1}`, rows });
  });
  return out;
}

/**
 * A table artifact's rows, typed by its columns.
 * @param spec - The table's spec.
 * @param name - The sheet's name.
 */
export function tableFromSpec(spec: DataTableSpec, name: string): ExportTable {
  const header: ExportCell[] = spec.columns.map(c => ({ v: c.label ?? c.key }));
  const rows = spec.rows.map(row => spec.columns.map((c): ExportCell => {
    const value: CellValue | undefined = row[c.key];
    if (value === null || value === undefined) {
      return { v: '' };
    }
    if (typeof value === 'boolean') {
      return { v: value ? 'Yes' : 'No' };
    }
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    switch (c.type) {
      case 'currency':
        return Number.isFinite(n) ? { v: n, z: '"$"#,##0.00' } : { v: String(value) };
      case 'percent':
        // The table card prints a percent as `n%`: its values are 0–100.
        return Number.isFinite(n) ? { v: n / 100, z: '0.0%' } : { v: String(value) };
      case 'number':
        return Number.isFinite(n) ? { v: n, z: Number.isInteger(n) ? '#,##0' : '#,##0.00' } : { v: String(value) };
      default:
        return typeof value === 'number' ? { v: value } : { v: String(value) };
    }
  }));
  return { name: spec.title || name, rows: [header, ...rows] };
}

/** The artifact fields the export reads. */
export type ExportableArtifact = { kind: string; title: string; spec: unknown };

/**
 * The tables an artifact carries, or [] when it has none to export.
 * @param artifact - The artifact row's kind, title and spec.
 */
export function extractTables(artifact: ExportableArtifact): ExportTable[] {
  const spec = (artifact.spec ?? {}) as Record<string, unknown>;
  if (artifact.kind === 'document' && typeof spec.html === 'string') {
    return tablesFromHtml(spec.html, artifact.title || 'Table');
  }
  if (artifact.kind === 'table' && Array.isArray(spec.columns) && Array.isArray(spec.rows)) {
    return [tableFromSpec(spec as DataTableSpec, artifact.title || 'Table')];
  }
  return [];
}

/**
 * Excel's rules for a sheet name: 31 characters, none of `[]:*?/\`, unique in
 * the workbook (case-insensitively).
 * @param names - The tables' names, in order.
 */
export function sheetNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((raw) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31).trim();
    let name = base;
    for (let i = 2; seen.has(name.toLowerCase()); i++) {
      const suffix = ` (${i})`;
      name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}

/**
 * The workbook: one sheet per table, numbers as numbers, columns wide enough
 * to read.
 * @param tables - What `extractTables` returned.
 */
export async function toXlsx(tables: ExportTable[]): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  const names = sheetNames(tables.map(t => t.name));
  tables.forEach((table, t) => {
    const sheet = XLSX.utils.aoa_to_sheet(table.rows.map(row => row.map(c => c.v)));
    const widths: number[] = [];
    table.rows.forEach((row, r) => row.forEach((cell, c) => {
      widths[c] = Math.max(widths[c] ?? 0, String(cell.v).length);
      if (cell.z && typeof cell.v === 'number') {
        const ref = XLSX.utils.encode_cell({ r, c });
        const target = sheet[ref] as { z?: string } | undefined;
        if (target) {
          target.z = cell.z;
        }
      }
    }));
    sheet['!cols'] = widths.map(w => ({ wch: Math.min(Math.max(w + 2, 8), 60) }));
    XLSX.utils.book_append_sheet(book, sheet, names[t]);
  });
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array);
}

/**
 * One table as CSV (RFC 4180 quoting). Numbers are written plain, so a
 * spreadsheet reads them back as numbers.
 * @param table - The table.
 */
export function toCsv(table: ExportTable): string {
  const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return `${table.rows.map(row => row.map((c) => {
    if (typeof c.v === 'number') {
      // A percent is stored as a fraction; CSV has no formats, so write what
      // the document said.
      return c.z?.endsWith('%') ? `${Math.round(c.v * 100 * 10_000) / 10_000}%` : String(c.v);
    }
    return quote(c.v);
  }).join(',')).join('\r\n')}\r\n`;
}

/**
 * A filename for the download: the artifact's title, made safe.
 * @param title - The artifact's title.
 * @param ext - `xlsx` or `csv`.
 */
export function exportFilename(title: string, ext: 'xlsx' | 'csv'): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'export';
  return `${base}.${ext}`;
}
