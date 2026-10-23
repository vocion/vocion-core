/**
 * Applying edited text back into HTML without re-serialising it.
 *
 * Both adapters (PPTX slides, DOCX sheets) merge text edits into the original
 * HTML. A parse-and-print would reformat the file, so this works the other way
 * round: parse with source offsets, plan edits as string splices, and apply
 * the splices to the original string. Everything not touched stays
 * byte-for-byte.
 *
 * An edit is applied to the narrowest span that changed. The common prefix and
 * suffix of the old and new text (case-insensitively, so a `text-transform`
 * does not read as a rewrite) are left alone; when the changed middle sits
 * inside one text node only that node is rewritten and the inline `<b>` or
 * `<span>` structure around it survives. When the change spans several nodes
 * or contains a line break, the element's content is replaced with plain text.
 */

import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import { normText } from './shared';

/** An element node of the parsed HTML (cheerio does not export domhandler's type). */
export type Element = Extract<ReturnType<CheerioAPI['root']>[0]['children'][number], { attribs: Record<string, string> }>;

export type Splice = { start: number; end: number; insert: string };

export type LocatedHtml = { $: CheerioAPI; html: string };

const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'del',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'wbr',
]);

/**
 * Parses with source offsets.
 * @param html - The source string; offsets refer to it.
 * @param isDocument - True for a whole page, false for a fragment.
 */
export function parseLocated(html: string, isDocument: boolean): LocatedHtml {
  return { $: cheerio.load(html, { sourceCodeLocationInfo: true }, isDocument), html };
}

function isElement(n: unknown): n is Element {
  const t = (n as { type?: string }).type;
  return t === 'tag' || t === 'script' || t === 'style';
}

/**
 * Element children, in document order.
 * @param el - The parent.
 */
export function elementChildren(el: Element): Element[] {
  return el.children.filter(isElement);
}

/**
 * Walks a dotted child-index path from a root element.
 * @param root - The element the path starts at.
 * @param path - `0.2.1`: first child, its third child, that one's second.
 */
export function elementAtPath(root: Element, path: string): Element | null {
  let cur: Element = root;
  for (const part of path.split('.')) {
    const next = elementChildren(cur)[Number(part)];
    if (!next) {
      return null;
    }
    cur = next;
  }
  return cur;
}

/**
 * Whether an element is a block of running text: not itself inline, with at
 * least one text character, and nothing but inline elements inside it.
 * @param el - The candidate.
 */
export function isTextLeaf(el: Element): boolean {
  if (INLINE_TAGS.has(el.name) || el.type !== 'tag') {
    return false;
  }
  return elementChildren(el).every(c => INLINE_TAGS.has(c.name) && isInlineDeep(c)) && textOfElement(el).length > 0;
}

function isInlineDeep(el: Element): boolean {
  return elementChildren(el).every(c => INLINE_TAGS.has(c.name) && isInlineDeep(c));
}

type Seg = { kind: 'text'; node: { data: string; sourceCodeLocation?: { startOffset: number; endOffset: number } | null }; text: string; start: number } | { kind: 'br' };

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ');
}

function segments(el: Element): { segs: Seg[]; text: string } {
  const segs: Seg[] = [];
  let text = '';
  const walk = (parent: Element) => {
    for (const c of parent.children) {
      if (c.type === 'text') {
        let t = collapse(c.data);
        if (text === '' || text.endsWith(' ') || text.endsWith('\n')) {
          t = t.replace(/^ /, '');
        }
        if (t === '') {
          continue;
        }
        segs.push({ kind: 'text', node: c as never, text: t, start: text.length });
        text += t;
      } else if (isElement(c)) {
        if (c.name === 'script' || c.name === 'style') {
          continue;
        }
        if (c.name === 'br') {
          const last = segs.at(-1);
          if (last?.kind === 'text' && last.text.endsWith(' ')) {
            last.text = last.text.slice(0, -1);
            text = text.slice(0, -1);
          }
          segs.push({ kind: 'br' });
          text += '\n';
        } else {
          walk(c);
        }
      }
    }
  };
  walk(el);
  const last = segs.at(-1);
  if (last?.kind === 'text' && last.text.endsWith(' ')) {
    last.text = last.text.slice(0, -1);
    text = text.slice(0, -1);
  }
  return { segs, text };
}

/**
 * The visible text of an element as the adapters see it: whitespace collapsed,
 * `<br>` as a newline.
 * @param el - The element.
 */
export function textOfElement(el: Element): string {
  return normText(segments(el).text);
}

function escapeText(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Plans the splices that make an element read `newText`.
 * @param el - A located element (from `parseLocated`).
 * @param newText - The text it should now hold; normalised before use.
 * @returns Splices (empty when nothing differs), or null when the element has no source location.
 */
export function planTextEdit(el: Element, newText: string): Splice[] | null {
  const loc = el.sourceCodeLocation;
  if (!loc?.startTag) {
    return null;
  }
  const { segs, text: old } = segments(el);
  const next = normText(newText);
  if (old === next) {
    return [];
  }
  const a = old.toLowerCase();
  const b = next.toLowerCase();
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) {
    p++;
  }
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    s++;
  }
  const regionStart = p;
  const regionEnd = old.length - s;
  const repl = next.slice(p, next.length - s);

  if (!repl.includes('\n')) {
    const texts = segs.filter((g): g is Extract<Seg, { kind: 'text' }> => g.kind === 'text');
    const hit = regionStart === regionEnd
      ? (texts.find(g => g.start < regionStart && regionStart <= g.start + g.text.length) ?? texts.find(g => g.start === regionStart))
      : texts.find(g => g.start <= regionStart && regionEnd <= g.start + g.text.length);
    const nl = hit?.node.sourceCodeLocation;
    if (hit && nl) {
      const a0 = regionStart - hit.start;
      const b0 = regionEnd - hit.start;
      return [{ start: nl.startOffset, end: nl.endOffset, insert: escapeText(hit.text.slice(0, a0) + repl + hit.text.slice(b0)) }];
    }
  }
  const start = loc.startTag.endOffset;
  const end = loc.endTag?.startOffset ?? loc.endOffset;
  return [{ start, end, insert: next.split('\n').map(escapeText).join('<br>') }];
}

/**
 * Applies non-overlapping splices to a string.
 * @param html - The original.
 * @param splices - Any order.
 */
export function applySplices(html: string, splices: Splice[]): string {
  let out = html;
  for (const sp of [...splices].sort((x, y) => y.start - x.start)) {
    out = out.slice(0, sp.start) + sp.insert + out.slice(sp.end);
  }
  return out;
}
