/**
 * Reads an edited DOCX back into the document's HTML.
 *
 * Paragraphs are placed by their bookmark first, then, where a editor dropped
 * the bookmark, by text similarity to a base paragraph nobody else claimed
 * (0.8 or better). A changed paragraph's new text is spliced into the original
 * HTML at that element; everything else stays byte-for-byte. A paragraph that
 * cannot be placed is listed in the report and left out, never guessed into a
 * sheet.
 */

import type { Buffer } from 'node:buffer';
import type { Splice } from '../../decks/pptx/htmlText';
import type { XNode } from '../../decks/pptx/xml';
import type { Block } from './blocks';
import JSZip from 'jszip';
import { applySplices, parseLocated, planTextEdit } from '../../decks/pptx/htmlText';
import { normText } from '../../decks/pptx/shared';
import { child, parseXml } from '../../decks/pptx/xml';
import { bookmarkNames, listBlocks } from './blocks';

export type DocumentImportReport = {
  /** Base paragraphs whose text came back unchanged (or that the file did not touch). */
  kept: number;
  edited: Array<{ sheet: number; path: string; before: string; after: string }>;
  /** Text of paragraphs in the file that matched nothing in the document. */
  unplaced: string[];
};

type DocParagraph = { bookmarks: string[]; text: string };

function paragraphText(p: XNode): string {
  let out = '';
  const rec = (n: XNode) => {
    for (const k of n.kids) {
      switch (k.tag) {
        case 'w:t':
          out += k.kids.map(x => x.text ?? '').join('');
          break;
        case 'w:tab':
          out += ' ';
          break;
        case 'w:br':
        case 'w:cr':
          if (!k.attrs['w:type'] || k.attrs['w:type'] === 'textWrapping') {
            out += '\n';
          }
          break;
        case 'w:noBreakHyphen':
          out += '-';
          break;
        case 'w:del':
        case 'w:instrText':
        case 'w:delText':
        case 'w:pPr':
        case 'w:rPr':
          break;
        default:
          rec(k);
      }
    }
  };
  rec(p);
  return out;
}

function collectParagraphs(node: XNode, out: DocParagraph[]): void {
  for (const k of node.kids) {
    if (k.tag === 'w:p') {
      const bookmarks: string[] = [];
      const walkBm = (n: XNode) => {
        for (const x of n.kids) {
          if (x.tag === 'w:bookmarkStart' && x.attrs['w:name']) {
            bookmarks.push(x.attrs['w:name']);
          } else if (x.tag !== 'w:pPr') {
            walkBm(x);
          }
        }
      };
      walkBm(k);
      out.push({ bookmarks, text: normText(paragraphText(k)) });
    } else if (k.tag !== 'w:del') {
      collectParagraphs(k, out);
    }
  }
}

function trigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = `  ${s} `;
  for (let i = 0; i + 3 <= t.length; i++) {
    const g = t.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let inter = 0;
  let total = 0;
  for (const v of a.values()) {
    total += v;
  }
  for (const v of b.values()) {
    total += v;
  }
  for (const [g, n] of a) {
    inter += Math.min(n, b.get(g) ?? 0);
  }
  return total === 0 ? 1 : (2 * inter) / total;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Similarity of two paragraphs in 0..1: 1 minus the normalised edit distance,
 * case-insensitive. A cheap trigram overlap rules out hopeless pairs first.
 * @param a - First text.
 * @param b - Second text.
 */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) {
    return 1;
  }
  const max = Math.max(x.length, y.length);
  if (max === 0 || Math.min(x.length, y.length) / max < 0.8) {
    return 0;
  }
  if (dice(trigrams(x), trigrams(y)) < 0.5) {
    return 0;
  }
  return 1 - levenshtein(x, y) / max;
}

const THRESHOLD = 0.8;

/**
 * Applies an edited DOCX to the document it was exported from.
 * @param buf - The DOCX file.
 * @param baseHtml - The document's HTML as it is now.
 * @returns The merged HTML and what was kept, edited and left unplaced.
 */
export async function docxToDocument(buf: Buffer, baseHtml: string): Promise<{ html: string; report: DocumentImportReport }> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) {
    throw new Error('Not a DOCX: word/document.xml is missing');
  }
  const doc = parseXml(xml).find(n => n.tag === 'w:document');
  const body = child(doc, 'w:body');
  const paragraphs: DocParagraph[] = [];
  if (body) {
    collectParagraphs(body, paragraphs);
  }

  const { $ } = parseLocated(baseHtml, true);
  const blocks = listBlocks($);
  const byName = new Map<string, Block>();
  for (const b of blocks) {
    const names = bookmarkNames(b.sheet, b.path);
    byName.set(names.plain, b);
    byName.set(names.hashed, b);
  }

  const claimed = new Map<Block, string>();
  const rest: DocParagraph[] = [];
  for (const p of paragraphs) {
    const block = p.bookmarks.map(n => byName.get(n)).find((b): b is Block => !!b && !claimed.has(b));
    if (block) {
      if (p.text !== '') {
        claimed.set(block, p.text);
      } else {
        // A cleared paragraph is not read as a deletion: the block stays as it was.
        claimed.set(block, block.text);
      }
    } else if (p.text !== '') {
      rest.push(p);
    }
  }

  // Paragraphs with no (usable) bookmark: exact text first, then by similarity.
  const unplaced: string[] = [];
  const free = () => blocks.filter(b => !claimed.has(b));
  const leftover: DocParagraph[] = [];
  for (const p of rest) {
    const exact = free().find(b => b.text === p.text);
    if (exact) {
      claimed.set(exact, p.text);
    } else {
      leftover.push(p);
    }
  }
  const pairs: Array<{ p: number; b: Block; score: number }> = [];
  leftover.forEach((p, pi) => {
    for (const b of free()) {
      const score = similarity(p.text, b.text);
      if (score >= THRESHOLD) {
        pairs.push({ p: pi, b, score });
      }
    }
  });
  pairs.sort((x, y) => y.score - x.score);
  const placed = new Set<number>();
  for (const pair of pairs) {
    if (placed.has(pair.p) || claimed.has(pair.b)) {
      continue;
    }
    placed.add(pair.p);
    claimed.set(pair.b, leftover[pair.p]!.text);
  }
  leftover.forEach((p, i) => {
    if (!placed.has(i)) {
      unplaced.push(p.text);
    }
  });

  const splices: Splice[] = [];
  const edited: DocumentImportReport['edited'] = [];
  for (const [block, text] of claimed) {
    if (normText(text) === block.text) {
      continue;
    }
    const plan = planTextEdit(block.el, text);
    if (!plan) {
      unplaced.push(text);
      continue;
    }
    if (plan.length > 0) {
      splices.push(...plan);
      edited.push({ sheet: block.sheet, path: block.path, before: block.text, after: normText(text) });
    }
  }
  edited.sort((a, b) => a.sheet - b.sheet || a.path.localeCompare(b.path, undefined, { numeric: true }));

  return {
    html: splices.length > 0 ? applySplices(baseHtml, splices) : baseHtml,
    report: { kept: blocks.length - edited.length, edited, unplaced },
  };
}
