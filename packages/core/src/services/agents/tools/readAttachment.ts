/**
 * read_attachment — the whole of a file a person attached, a page at a time.
 *
 * What rides under the message is a preview (`services/chat/convert.ts`): a
 * 5,000-row lead sheet arrives as its columns, its row count and its first
 * twenty rows, because inlining it would swamp the turn and still be cut.
 * "Analyse all the leads" needs every row, and this is how the agent gets
 * them without blowing up its context: filter, count, group and page over
 * the STORED ORIGINAL, read fresh from the artifact store. Non-tabular files
 * (a Word document, a deck, an email, a PDF) read by character range or by
 * search.
 *
 * Reads only — an upload is the person's file, an artifact of kind `file`,
 * and nothing here changes it. Org-scoped through `getArtifact`, so an id
 * from another workspace reads as missing.
 */

import type { RuntimeContext } from '../types';
import type { SheetTable } from '@/services/chat/convert';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatOf } from '@/libs/chat/attachmentFormats';
import { getArtifact, listArtifactsForConversation } from '@/services/ArtifactService';

/** Rows one call returns by default, and at most. */
const DEFAULT_ROWS = 50;
const MAX_ROWS = 200;
/** Characters of a text document one call returns by default, and at most. */
const DEFAULT_CHARS = 12_000;
const MAX_CHARS = 30_000;
/** A reply is cut here whatever was asked, so one call can never flood the context. */
const MAX_REPLY_CHARS = 40_000;
/** Groups listed by `group_by`, largest first. */
const MAX_GROUPS = 100;

const OPS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty'] as const;
type Op = typeof OPS[number];
type Where = { column: string; op: Op; value?: string | number | null };

// Parsed files, by their content-addressed filename: the same bytes always
// parse the same, so a paging agent does not re-read a 20 MB workbook on
// every call. Small and per process — a miss only costs a parse.
const CACHE_LIMIT = 4;
const cache = new Map<string, Promise<SheetTable[] | string>>();

function cached(key: string, load: () => Promise<SheetTable[] | string>): Promise<SheetTable[] | string> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = load();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** Drop the parse cache — for tests. */
export function clearAttachmentCache(): void {
  cache.clear();
}

const n = (x: number) => x.toLocaleString('en-US');

function asNumber(v: string): number | null {
  const t = v.replace(/[\s,$€£¥%]/g, '');
  if (t === '' || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(t)) {
    return null;
  }
  return Number(t);
}

function asDate(v: string): number | null {
  if (!/\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(v)) {
    return null;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function compare(cell: string, value: string): number {
  const a = asNumber(cell);
  const b = asNumber(value);
  if (a !== null && b !== null) {
    return a - b;
  }
  const da = asDate(cell);
  const db = asDate(value);
  if (da !== null && db !== null) {
    return da - db;
  }
  return cell.localeCompare(value, 'en', { sensitivity: 'base', numeric: true });
}

function matches(cell: string, w: Where): boolean {
  const value = w.value === null || w.value === undefined ? '' : String(w.value);
  const c = cell.trim();
  switch (w.op) {
    case 'is_empty':
      return c === '';
    case 'not_empty':
      return c !== '';
    case 'equals':
      return compare(c, value) === 0;
    case 'not_equals':
      return compare(c, value) !== 0;
    case 'contains':
      return c.toLowerCase().includes(value.toLowerCase());
    case 'not_contains':
      return !c.toLowerCase().includes(value.toLowerCase());
    case 'starts_with':
      return c.toLowerCase().startsWith(value.toLowerCase());
    default: {
      if (c === '') {
        return false;
      }
      const d = compare(c, value);
      return w.op === 'gt' ? d > 0 : w.op === 'gte' ? d >= 0 : w.op === 'lt' ? d < 0 : d <= 0;
    }
  }
}

function csvLine(cells: string[]): string {
  return cells.map(v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
}

type Args = {
  id?: number;
  sheet?: string | number;
  columns?: string[];
  where?: Where[];
  search?: string;
  group_by?: string;
  offset?: number;
  limit?: number;
};

/**
 * Read a sheet: pick it, filter it, then group it or page it.
 * @param title - The file's name.
 * @param sheets - Every sheet.
 * @param args - The call.
 */
export function readSheet(title: string, sheets: SheetTable[], args: Args): string {
  if (sheets.length === 0) {
    return `${title} has no sheets with data.`;
  }
  let sheet = sheets[0]!;
  if (args.sheet !== undefined && args.sheet !== '') {
    const asked = String(args.sheet).trim();
    const byName = sheets.find(s => s.name.toLowerCase() === asked.toLowerCase());
    const byIndex = /^\d+$/.test(asked) ? sheets[Number(asked) - 1] : undefined;
    const found = byName ?? byIndex;
    if (!found) {
      return `${title} has no sheet “${asked}”. Its sheets: ${sheets.map(s => `“${s.name}”`).join(', ')}.`;
    }
    sheet = found;
  }
  const colIndex = (name: string): number => {
    const want = name.trim().toLowerCase();
    return sheet.header.findIndex(h => h.toLowerCase() === want);
  };
  const unknown = [...(args.columns ?? []), ...(args.where ?? []).map(w => w.column), ...(args.group_by ? [args.group_by] : [])]
    .filter(c => colIndex(c) < 0);
  if (unknown.length > 0) {
    return `Sheet “${sheet.name}” has no column ${unknown.map(c => `“${c}”`).join(', ')}. Its columns: ${sheet.header.join(', ')}.`;
  }

  const filters = (args.where ?? []).map(w => ({ ...w, i: colIndex(w.column) }));
  const needle = args.search?.trim().toLowerCase();
  // Row numbers are the sheet's own (the header is row 1), so a person can find the row.
  const hits: Array<{ row: number; cells: string[] }> = [];
  sheet.rows.forEach((cells, k) => {
    if (filters.every(f => matches(cells[f.i] ?? '', f)) && (!needle || cells.some(c => c.toLowerCase().includes(needle)))) {
      hits.push({ row: k + 2, cells });
    }
  });

  const scope = sheets.length > 1 ? `sheet “${sheet.name}” (${sheets.length} sheets: ${sheets.map(s => `“${s.name}”`).join(', ')})` : `sheet “${sheet.name}”`;
  const head = `${title} · ${scope} · ${n(sheet.rows.length)} rows · columns: ${sheet.header.join(', ')}`;
  const filtered = filters.length > 0 || needle;
  const filterLine = filtered
    ? `Filter: ${[...filters.map(f => `${f.column} ${f.op.replace('_', ' ')}${f.op === 'is_empty' || f.op === 'not_empty' ? '' : ` ${JSON.stringify(f.value ?? '')}`}`), ...(needle ? [`any cell contains ${JSON.stringify(args.search)}`] : [])].join(' and ')} → ${n(hits.length)} matching row${hits.length === 1 ? '' : 's'}.`
    : '';

  if (args.group_by) {
    const gi = colIndex(args.group_by);
    const counts = new Map<string, number>();
    for (const h of hits) {
      const key = (h.cells[gi] ?? '').trim() || '(empty)';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const lines = sorted.slice(0, MAX_GROUPS).map(([k, c]) => csvLine([k, String(c)]));
    return [
      head,
      filterLine,
      `Counts by ${sheet.header[gi]} over ${n(hits.length)} row${hits.length === 1 ? '' : 's'} (${n(counts.size)} distinct value${counts.size === 1 ? '' : 's'}):`,
      csvLine([sheet.header[gi]!, 'rows']),
      ...lines,
      sorted.length > MAX_GROUPS ? `(${n(sorted.length - MAX_GROUPS)} smaller groups not listed.)` : '',
    ].filter(Boolean).join('\n');
  }

  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  const limit = Math.min(MAX_ROWS, Math.max(1, Math.floor(args.limit ?? DEFAULT_ROWS)));
  const picked = (args.columns ?? []).length > 0 ? args.columns!.map(colIndex) : sheet.header.map((_, i) => i);
  const page = hits.slice(offset, offset + limit);
  const lines: string[] = [csvLine(['row', ...picked.map(i => sheet.header[i]!)])];
  let size = head.length + filterLine.length + lines[0]!.length;
  let shown = 0;
  for (const h of page) {
    const line = csvLine([String(h.row), ...picked.map(i => h.cells[i] ?? '')]);
    if (size + line.length > MAX_REPLY_CHARS) {
      break;
    }
    lines.push(line);
    size += line.length + 1;
    shown += 1;
  }
  const next = offset + shown;
  const tail = hits.length === 0
    ? 'No rows match.'
    : next < hits.length
      ? `Showing ${n(offset + 1)}–${n(next)} of ${n(hits.length)}. Call again with offset: ${next} for the next rows, or use group_by to count instead of reading.`
      : `Showing ${n(Math.min(offset + 1, hits.length))}–${n(next)} of ${n(hits.length)} — that is every ${filtered ? 'matching ' : ''}row.`;
  return [head, filterLine, ...(hits.length > 0 ? lines : []), tail].filter(Boolean).join('\n');
}

/**
 * Read a text document by range or by search.
 * @param title - The file's name.
 * @param text - Its whole text.
 * @param args - The call.
 */
export function readText(title: string, text: string, args: Args): string {
  const total = text.length;
  const needle = args.search?.trim().toLowerCase();
  if (needle) {
    const paras = text.split(/\n{2,}/);
    const found: string[] = [];
    let at = 0;
    let count = 0;
    for (const p of paras) {
      if (p.toLowerCase().includes(needle)) {
        count += 1;
        if (found.join('\n\n').length < MAX_CHARS) {
          found.push(`[at ${n(at)}] ${p}`);
        }
      }
      at += p.length + 2;
    }
    return count === 0
      ? `${title} (${n(total)} characters): no paragraph contains ${JSON.stringify(args.search)}.`
      : `${title} (${n(total)} characters): ${n(count)} paragraph${count === 1 ? '' : 's'} contain ${JSON.stringify(args.search)}${found.length < count ? `, first ${found.length} shown` : ''}.\n\n${found.join('\n\n')}`;
  }
  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  const limit = Math.min(MAX_CHARS, Math.max(1, Math.floor(args.limit ?? DEFAULT_CHARS)));
  const body = text.slice(offset, offset + limit);
  const end = offset + body.length;
  return `${title} · characters ${n(offset)}–${n(end)} of ${n(total)}${end < total ? ` (call again with offset: ${end} for more)` : ' — the end of the file'}\n\n${body}`;
}

async function latestUpload(ctx: RuntimeContext): Promise<number | null> {
  if (!ctx.conversationId) {
    return null;
  }
  const rows = await listArtifactsForConversation({ orgId: ctx.orgId, conversationId: ctx.conversationId });
  const uploads = rows.filter(r => r.kind === 'file' && (r.spec as Record<string, unknown> | null)?.uploaded === true);
  return uploads.at(-1)?.id ?? null;
}

export function readAttachmentTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as Args;
      const id = args.id ?? await latestUpload(ctx);
      if (!id) {
        return 'No file is attached in this conversation. Ask the person to attach it (the + button, a drop, or a paste).';
      }
      const row = await getArtifact({ orgId: ctx.orgId, id });
      const spec = (row?.spec ?? {}) as Record<string, unknown>;
      if (!row || row.kind !== 'file' || typeof spec.filename !== 'string') {
        return `No attached file #${id} in this workspace.`;
      }
      const title = row.title;
      const format = formatOf({ name: typeof spec.originalName === 'string' ? spec.originalName : title, type: typeof spec.contentType === 'string' ? spec.contentType : '' });
      if (!format || format.kind === 'image') {
        return `${title} is an image; it was shown to you with the message it came on. There is no text to read.`;
      }
      const { readStoredFile } = await import('@/services/chat/attachments');
      const filename = spec.filename;
      let parsed: SheetTable[] | string;
      try {
        parsed = await cached(`${filename}:${format.family}`, async () => {
          const data = await readStoredFile(filename);
          if (!data) {
            throw new Error('the stored file is gone');
          }
          const { readFullText, readTables } = await import('@/services/chat/convert');
          return format.family === 'sheet' ? readTables(data, format) : readFullText(data, format);
        });
      } catch (err) {
        return `Could not read ${title}: ${(err as Error).message}. Ask the person to attach it again.`;
      }
      return typeof parsed === 'string' ? readText(title, parsed, args) : readSheet(title, parsed, args);
    },
    {
      name: 'read_attachment',
      description: [
        'Read the WHOLE of a file the person attached to this conversation — the message only carried a preview (a spreadsheet\'s columns and first rows; a long document cut at a limit).',
        'Spreadsheets (Excel, CSV, TSV, OpenDocument): pick a `sheet`, filter rows with `where` (every condition must hold) or `search` (any cell contains), choose `columns`, and page with `offset`/`limit` (up to 200 rows a call). `group_by` a column to COUNT rows per value instead of reading them — use it for "how many", "break down by", "which are most common". Row numbers in the reply are the sheet\'s own.',
        'Documents, decks, emails and PDFs: read by character range (`offset`/`limit`, up to 30,000 a call) or find the paragraphs containing `search`.',
        'Omit `id` for the most recent file attached in this conversation. The id is in the attachment header (`file #12`).',
      ].join(' '),
      schema: z.object({
        id: z.number().int().positive().optional().describe('The file\'s id from its header ("file #12"). Omit for the latest attachment in this conversation.'),
        sheet: z.union([z.string(), z.number()]).optional().describe('Spreadsheets: sheet name, or its 1-based position. Default: the first sheet.'),
        columns: z.array(z.string()).optional().describe('Spreadsheets: only these columns, by header name. Default: every column.'),
        where: z.array(z.object({
          column: z.string().describe('Header name.'),
          op: z.enum(OPS).describe('equals / not_equals compare as numbers or dates when both sides are; contains / not_contains / starts_with ignore case; gt / gte / lt / lte compare numbers, dates, then text.'),
          value: z.union([z.string(), z.number(), z.null()]).optional(),
        })).optional().describe('Spreadsheets: row filters, all of which must hold.'),
        search: z.string().optional().describe('Spreadsheets: rows where any cell contains this. Documents: paragraphs containing this.'),
        group_by: z.string().optional().describe('Spreadsheets: count the (filtered) rows per value of this column instead of returning rows.'),
        offset: z.number().int().min(0).optional().describe('Spreadsheets: matching rows to skip. Documents: characters to skip.'),
        limit: z.number().int().positive().optional().describe('Spreadsheets: rows to return (default 50, max 200). Documents: characters (default 12,000, max 30,000).'),
      }),
    },
  );
}
