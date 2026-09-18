/**
 * Sheet-level edits — how the agent changes a document without rewriting it.
 *
 * "Cut page 9", "move the quote to page 4", "make it three agents" are edits
 * to one or two sheets of a 100 KB file. Sending the whole file back for each
 * is slow, expensive, and the place where a model quietly drops a paragraph
 * it did not mean to. So the unit of change is the sheet: replace one, remove
 * one, insert one, swap the style block, retitle, or find-and-replace. The
 * engine reassembles, renumbers the footers, and re-verifies.
 *
 * Pure. Every op is validated against the current document so a bad index is
 * a plain error the model can read and correct, never a silent no-op.
 */

import { z } from 'zod';
import { assemble, parseSheets, renumber } from './sheets';

const sheetHtml = z.string().min(20).max(400_000).describe('A complete <article class="sheet">…</article> element');

export const documentOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace_sheet'), n: z.number().int().positive(), html: sheetHtml }),
  z.object({ op: z.literal('remove_sheet'), n: z.number().int().positive() }),
  z.object({ op: z.literal('insert_sheet'), after: z.number().int().nonnegative().describe('0 inserts before the first sheet'), html: sheetHtml }),
  z.object({ op: z.literal('move_sheet'), n: z.number().int().positive(), to: z.number().int().positive().describe('New 1-based position') }),
  z.object({ op: z.literal('replace_style'), css: z.string().max(400_000).describe('Replaces the contents of the first <style> block') }),
  z.object({ op: z.literal('set_title'), title: z.string().min(1).max(200) }),
  z.object({
    op: z.literal('replace_text'),
    find: z.string().min(1).max(2000),
    replace: z.string().max(20_000),
    all: z.boolean().default(false),
    /** Limit to one sheet; default the whole document. */
    sheet: z.number().int().positive().optional(),
  }),
]);
export type DocumentOp = z.infer<typeof documentOpSchema>;

export class DocumentEditError extends Error {}

export type EditResult = {
  html: string;
  /** One line per op, past tense, for the version's change summary. */
  applied: string[];
  sheetCount: number;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply ops in order to a document and renumber the footers.
 * @param html
 * @param ops
 */
export function applyDocumentOps(html: string, ops: readonly DocumentOp[]): EditResult {
  if (ops.length === 0) {
    throw new DocumentEditError('No ops given.');
  }
  let doc = parseSheets(html);
  const applied: string[] = [];
  const need = (n: number, what: string) => {
    if (n < 1 || n > doc.sheets.length) {
      throw new DocumentEditError(`${what}: sheet ${n} does not exist (the document has ${doc.sheets.length} ${doc.sheets.length === 1 ? 'sheet' : 'sheets'}).`);
    }
  };
  const asSheet = (fragment: string, what: string) => {
    const parsed = parseSheets(fragment);
    if (parsed.sheets.length !== 1) {
      throw new DocumentEditError(`${what}: expected exactly one <article class="sheet">…</article>, got ${parsed.sheets.length}.`);
    }
    return parsed.sheets[0]!;
  };

  for (const op of ops) {
    switch (op.op) {
      case 'replace_sheet': {
        need(op.n, 'replace_sheet');
        const next = asSheet(op.html, 'replace_sheet');
        const sheets = doc.sheets.map(s => (s.n === op.n ? { ...next, n: op.n } : s));
        doc = { ...doc, sheets };
        applied.push(`replaced sheet ${op.n}${next.label ? ` (${next.label})` : ''}`);
        break;
      }
      case 'remove_sheet': {
        need(op.n, 'remove_sheet');
        const gone = doc.sheets[op.n - 1]!;
        doc = { ...doc, sheets: doc.sheets.filter(s => s.n !== op.n).map((s, i) => ({ ...s, n: i + 1 })) };
        applied.push(`removed sheet ${op.n}${gone.label ? ` (${gone.label})` : ''}`);
        break;
      }
      case 'insert_sheet': {
        if (op.after < 0 || op.after > doc.sheets.length) {
          throw new DocumentEditError(`insert_sheet: after=${op.after} is out of range (0–${doc.sheets.length}).`);
        }
        const next = asSheet(op.html, 'insert_sheet');
        const sheets = [...doc.sheets];
        sheets.splice(op.after, 0, { ...next, n: op.after + 1 });
        doc = { ...doc, sheets: sheets.map((s, i) => ({ ...s, n: i + 1 })) };
        applied.push(`inserted a sheet after ${op.after}${next.label ? ` (${next.label})` : ''}`);
        break;
      }
      case 'move_sheet': {
        need(op.n, 'move_sheet');
        need(op.to, 'move_sheet');
        const sheets = [...doc.sheets];
        const [moved] = sheets.splice(op.n - 1, 1);
        sheets.splice(op.to - 1, 0, moved!);
        doc = { ...doc, sheets: sheets.map((s, i) => ({ ...s, n: i + 1 })) };
        applied.push(`moved sheet ${op.n} to position ${op.to}`);
        break;
      }
      case 'replace_style': {
        const re = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/i;
        if (!re.test(doc.before)) {
          throw new DocumentEditError('replace_style: the document has no <style> block before its first sheet.');
        }
        doc = { ...doc, before: doc.before.replace(re, (_m, open: string, _css: string, close: string) => `${open}\n${op.css}\n${close}`) };
        applied.push('replaced the style block');
        break;
      }
      case 'set_title': {
        const re = /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i;
        const escaped = op.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
        doc = re.test(doc.before)
          ? { ...doc, before: doc.before.replace(re, `$1${escaped}$3`), title: op.title }
          : { ...doc, before: doc.before.replace(/<head\b[^>]*>/i, m => `${m}<title>${escaped}</title>`), title: op.title };
        applied.push(`set the title to "${op.title}"`);
        break;
      }
      case 'replace_text': {
        const re = new RegExp(escapeRegExp(op.find), op.all ? 'g' : '');
        let count = 0;
        const sub = (s: string) => s.replace(re, () => {
          count++;
          return op.replace;
        });
        if (op.sheet !== undefined) {
          need(op.sheet, 'replace_text');
          doc = { ...doc, sheets: doc.sheets.map(s => (s.n === op.sheet ? { ...s, html: sub(s.html) } : s)) };
        } else {
          const sheets = doc.sheets.map(s => ({ ...s, html: sub(s.html) }));
          doc = { ...doc, sheets, before: count === 0 || op.all ? sub(doc.before) : doc.before };
        }
        if (count === 0) {
          throw new DocumentEditError(`replace_text: "${op.find.slice(0, 80)}" was not found${op.sheet ? ` on sheet ${op.sheet}` : ''}. Read the sheet and match the text exactly (entities like &amp; count).`);
        }
        applied.push(`replaced "${op.find.slice(0, 40)}"${count > 1 ? ` ×${count}` : ''}`);
        break;
      }
    }
  }
  const sheets = renumber(doc.sheets);
  return { html: assemble({ ...doc, sheets }), applied, sheetCount: sheets.length };
}
