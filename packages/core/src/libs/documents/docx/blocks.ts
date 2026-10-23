/**
 * Which parts of a document are paragraphs, and what each one is called.
 *
 * Export and import must agree exactly on this, so both read it from here: a
 * block is a leaf element of running text (a heading, paragraph, list item,
 * table cell or plain text `div`) inside a `.sheet`. Its identity is the
 * sheet number plus the dotted child-index path from the sheet element.
 */

import type { CheerioAPI } from 'cheerio';
import type { Element } from '../../decks/pptx/htmlText';
import { createHash } from 'node:crypto';
import { elementChildren, isTextLeaf, textOfElement } from '../../decks/pptx/htmlText';

export type Block = { sheet: number; path: string; el: Element; text: string };

const SKIP_TAGS = new Set(['script', 'style', 'svg', 'head', 'template', 'noscript']);

/**
 * Elements the DOCX never carries: scripts, styles, SVG, and the pinned
 * page footer (`.foot`), which Word paginates for itself.
 * @param el - The candidate.
 */
export function isSkipped(el: Element): boolean {
  return SKIP_TAGS.has(el.name) || (el.attribs.class ?? '').split(/\s+/).includes('foot');
}

/**
 * The sheet elements of a document, in order. A document with no `.sheet`
 * is one sheet: its body.
 * @param $ - The parsed document.
 */
export function sheetRoots($: CheerioAPI): Element[] {
  const sheets = $('article.sheet, section.sheet').toArray();
  if (sheets.length > 0) {
    return sheets;
  }
  const body = $('body').toArray();
  return body.length > 0 ? body : $.root().children().toArray().filter((n): n is Element => n.type === 'tag');
}

function walk(el: Element, path: number[], sheet: number, out: Block[]): void {
  elementChildren(el).forEach((c, i) => {
    if (isSkipped(c)) {
      return;
    }
    const p = [...path, i];
    if (isTextLeaf(c)) {
      out.push({ sheet, path: p.join('.'), el: c, text: textOfElement(c) });
    } else {
      walk(c, p, sheet, out);
    }
  });
}

/**
 * Every paragraph block in the document, in order.
 * @param $ - The parsed document.
 */
export function listBlocks($: CheerioAPI): Block[] {
  const out: Block[] = [];
  sheetRoots($).forEach((root, i) => walk(root, [], i + 1, out));
  return out;
}

/**
 * The bookmark names a block can carry. Word caps a bookmark name at 40
 * characters, so a deep path is written as a hash instead; the importer
 * accepts both forms.
 * @param sheet - 1-based sheet number.
 * @param path - Dotted child-index path.
 * @returns The plain name and the hashed name.
 */
export function bookmarkNames(sheet: number, path: number | string | string[]): { plain: string; hashed: string } {
  const p = String(path);
  return {
    plain: `vocion_${sheet}_${p.replaceAll('.', '_')}`,
    hashed: `vocion_${sheet}_h${createHash('sha1').update(p).digest('hex').slice(0, 12)}`,
  };
}

/**
 * The name written for a block.
 * @param sheet - 1-based sheet number.
 * @param path - Dotted child-index path.
 */
export function bookmarkFor(sheet: number, path: string): string {
  const { plain, hashed } = bookmarkNames(sheet, path);
  return plain.length <= 40 ? plain : hashed;
}
