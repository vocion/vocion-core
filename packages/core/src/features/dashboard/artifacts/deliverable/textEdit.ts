/**
 * Text edited on the page, written back into the stored HTML — the text
 * nodes of ONE element, nothing else. The frame names the element by its
 * index among the page root's descendants (`bridge.ts` stamps the same
 * index), the words it had, and the words it has now; this parses the stored
 * page with the browser's own parser, finds that element, checks the words
 * still match, and replaces its text. Attributes, siblings, inline styles
 * and every other element are serialised back as they were parsed.
 *
 * Browser-only (DOMParser): the pane is the only caller.
 */

import { normaliseSlideHtml } from '@/libs/decks/slides';

function parseRoot(html: string): Element | null {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, 'text/html');
  return doc.body.firstElementChild;
}

/**
 * The page with one element's text replaced, or null when the element is
 * not where the frame said, no longer reads what the frame saw, or holds
 * more than text (so a stale or forged edit never lands somewhere else).
 * @param pageHtml - The stored `<section>` or `<article class="sheet">`.
 * @param path - The element's index among the root's descendants.
 * @param before - The words the frame showed.
 * @param after - The words the person typed.
 */
export function replaceElementText(pageHtml: string, path: number, before: string, after: string): string | null {
  const root = parseRoot(normaliseSlideHtml(pageHtml));
  if (!root || !Number.isInteger(path) || path < 0) {
    return null;
  }
  const el = root.querySelectorAll('*')[path];
  if (!el || el.textContent !== before) {
    return null;
  }
  const nodes = Array.from(el.childNodes);
  if (nodes.length === 0 || nodes.some(n => n.nodeType !== Node.TEXT_NODE)) {
    return null;
  }
  (nodes[0] as Text).data = after;
  nodes.slice(1).forEach(n => n.remove());
  return root.outerHTML;
}

/**
 * A slide id not yet in the deck, derived from the one it copies.
 * @param base - The slide being copied.
 * @param taken - Ids already in the deck.
 */
export function freshSlideId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = `${base.slice(0, 54)}-copy`;
  if (!used.has(stem)) {
    return stem;
  }
  for (let i = 2; ; i++) {
    const id = `${stem}-${i}`;
    if (!used.has(id)) {
      return id;
    }
  }
}

/**
 * The slide with its `<section id>` changed — the starting point "Add slide" inserts.
 * @param slideHtml - The slide copied.
 * @param id - The new id.
 */
export function withSectionId(slideHtml: string, id: string): string | null {
  const root = parseRoot(normaliseSlideHtml(slideHtml));
  if (!root || root.tagName.toLowerCase() !== 'section') {
    return null;
  }
  root.id = id;
  return root.outerHTML;
}
