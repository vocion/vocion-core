/**
 * Content-addressed anchor resolution.
 *
 * A comment points at a span of text, and that text has to survive a
 * re-render, an agent edit somewhere else in the document, and a whitespace
 * change. Anchoring to DOM offsets cannot do that, so an anchor is a quote
 * plus the characters immediately around it (a W3C-style TextQuoteSelector):
 * we find the quote in the current text and use the surrounding context to
 * pick the right occurrence when the quote appears more than once.
 *
 * The rule that matters for trust: when the quote can no longer be found the
 * anchor resolves to `null` — the caller renders it as orphaned. Guessing a
 * nearby span would put the reviewer's note against words they never
 * selected, which is worse than saying the span is gone.
 */

/** How much text on either side of the quote is stored for disambiguation. */
export const CONTEXT_CHARS = 32;

export type TextAnchor = {
  quote: string;
  prefix: string;
  suffix: string;
};

export type ResolvedAnchor = {
  start: number;
  end: number;
  /** True when the surrounding context matched too, not just the quote. */
  exact: boolean;
};

/**
 * Build an anchor from a selection inside a known text.
 * @param text - The full field text the selection was made in.
 * @param start - Selection start offset within that text.
 * @param end - Selection end offset within that text.
 * @returns The stored anchor shape, or null when the range is empty.
 */
export function buildAnchor(text: string, start: number, end: number): TextAnchor | null {
  if (start < 0 || end > text.length || end <= start) {
    return null;
  }
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, Math.min(text.length, end + CONTEXT_CHARS)),
  };
}

/**
 * Collect every offset at which `needle` occurs in `haystack`.
 * @param haystack - Text to search.
 * @param needle - Text to find.
 * @returns Every start offset, in order.
 */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) {
    return found;
  }
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      return found;
    }
    found.push(at);
    from = at + 1;
  }
}

/**
 * How many trailing characters the two strings share.
 * @param a - First string.
 * @param b - Second string.
 * @returns The shared trailing length.
 */
function tailOverlap(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let n = 0;
  while (n < max && a[a.length - 1 - n] === b[b.length - 1 - n]) {
    n += 1;
  }
  return n;
}

/**
 * How many leading characters the two strings share.
 * @param a - First string.
 * @param b - Second string.
 * @returns The shared leading length.
 */
function headOverlap(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let n = 0;
  while (n < max && a[n] === b[n]) {
    n += 1;
  }
  return n;
}

/**
 * Locate an anchor in the current text.
 *
 * A single occurrence resolves directly. Several occurrences are scored by
 * how much of the stored prefix and suffix still surround each one, so an
 * edit elsewhere in the document cannot move the highlight onto the wrong
 * copy of a repeated phrase. Nothing found resolves to null — orphaned, and
 * the surface says so.
 * @param text - The current field text.
 * @param anchor - The stored anchor.
 * @returns The resolved range, or null when the quote is gone.
 */
export function resolveAnchor(text: string, anchor: TextAnchor): ResolvedAnchor | null {
  const hits = occurrences(text, anchor.quote);
  if (hits.length === 0) {
    return null;
  }
  if (hits.length === 1) {
    const start = hits[0]!;
    const before = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
    const after = text.slice(start + anchor.quote.length, start + anchor.quote.length + CONTEXT_CHARS);
    const contextMatches = (!anchor.prefix && !anchor.suffix)
      || (anchor.prefix.length > 0 && tailOverlap(before, anchor.prefix) > 0)
      || (anchor.suffix.length > 0 && headOverlap(after, anchor.suffix) > 0);
    return { start, end: start + anchor.quote.length, exact: contextMatches };
  }
  let best = hits[0]!;
  let bestScore = -1;
  for (const start of hits) {
    const before = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
    const after = text.slice(start + anchor.quote.length, start + anchor.quote.length + CONTEXT_CHARS);
    const score = tailOverlap(before, anchor.prefix) + headOverlap(after, anchor.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return { start: best, end: best + anchor.quote.length, exact: bestScore > 0 };
}
