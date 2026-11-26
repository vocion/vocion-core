/**
 * Plain text and size caps for Help Center articles.
 *
 * Lives beside the tools, not in `libs/`. The HTML-to-text conversion is its
 * own linear scan instead of the shared `stripHtml` in `hubspotDirect.ts`
 * (written for HubSpot bodies): that one runs `/<[^>]+>/g`, which re-scans to
 * the end of the text from every unclosed `<`, so a partner body made of
 * 200,000 `<` characters took over 10 s. The scan also drops `<script>`, `<style>`
 * and comment blocks before their contents can leak in as text, and the file
 * holds the cut-at-N-characters helpers every Help Center cap uses. Core has no
 * shared cap helper (the nearest is `clampLimit` in `hubspotDirect.ts`, which
 * clamps a number, not text).
 *
 * Why the time is linear in the body length n. The partner controls the body,
 * so a marker search must never restart from the same place twice. The `<`
 * that finds the next opener is a plain `indexOf` that always starts after the
 * previous `<` or past the block just removed, so it is one forward pass on
 * its own. Every other marker (`>`, `-->`, `</script`, `</style`) is searched
 * through a `MarkerCursor`, which keeps the last position found, or the fact
 * that none exists, because those searches can start from many openers that
 * all point at the same far-off hit. Query positions only move forward
 * (every `from` passed for one marker is at least the previous one, because
 * the scan walks left to right and a removed block jumps past itself). So a
 * cursor does one of three things: reuses its cached position while that is
 * still at or after `from` (O(1)); answers "none" at once once a search from
 * an earlier point found nothing (nothing at or after a later point either);
 * or searches again from `from` to the next hit. The ranges scanned by those
 * fresh searches never overlap, because each starts after the hit of the
 * one before, so one marker costs at most n character comparisons in all. A
 * closing tag is a hit only when whitespace and `>` follow it; the whitespace
 * checked after one rejected candidate holds no `<`, so those checks do not
 * overlap either. With a fixed number of markers the total is O(n). The tag
 * stripper (`replaceTagsWithSpaces`) already moves its `<` position past every
 * `>` it uses, and stops at the first missing `>`, so it is a single pass too.
 */

/** Tag names whose element contents are code, never article text. */
const NON_TEXT_TAG_NAMES = ['script', 'style'] as const;

/**
 * Remembers where one marker was last found, so a search never restarts from
 * a point it already covered. `searchedFrom` is where the last real search
 * began; `position` is its hit, or -1 when the rest of the text has none.
 */
type MarkerCursor = { searchedFrom: number; position: number };

/** One cursor per marker the removal scan looks for. */
type MarkerCursors = {
  commentEnd: MarkerCursor;
  scriptEnd: MarkerCursor;
  styleEnd: MarkerCursor;
  openerEnd: MarkerCursor;
};

/** A cursor that has not searched yet. */
function newCursor(): MarkerCursor {
  return { searchedFrom: -1, position: -1 };
}

/**
 * Whether the cursor can answer a search from `from` without scanning.
 * @param cursor - The cursor.
 * @param from - Where the search would start.
 */
function cursorCovers(cursor: MarkerCursor, from: number): boolean {
  if (cursor.searchedFrom === -1 || from < cursor.searchedFrom) {
    return false;
  }
  return cursor.position === -1 || cursor.position >= from;
}

/**
 * The first index of `marker` at or after `from`, or -1, reusing the cursor's
 * last answer while it still applies (see the linear-time argument above).
 * @param text - The text to search.
 * @param marker - The text to find.
 * @param from - Where to start.
 * @param cursor - The marker's cursor, updated.
 */
function indexOfCached(text: string, marker: string, from: number, cursor: MarkerCursor): number {
  if (!cursorCovers(cursor, from)) {
    cursor.searchedFrom = from;
    cursor.position = text.indexOf(marker, from);
  }
  return cursor.position;
}

/**
 * Lower-cases ASCII letters only, so every index in the copy lines up with the
 * original (`toLowerCase` can change the length of some Unicode characters).
 * @param text - Any text.
 */
function lowerAscii(text: string): string {
  return text.replace(/[A-Z]+/g, match => match.toLowerCase());
}

/**
 * Where the `<name ...>` opening tag at `start` ends, or -1 when `start` is not
 * that tag. Mirrors the old `<name\b[^>]*>` shape: the name must end at a word
 * boundary and a `>` must follow.
 * @param lower - The ASCII-lower-cased text.
 * @param start - Index of a `<`.
 * @param name - `script` or `style`.
 * @param cursors - The `>` cursor is used and updated.
 */
function openingTagEnd(lower: string, start: number, name: string, cursors: MarkerCursors): number {
  if (!lower.startsWith(name, start + 1) || /\w/.test(lower.charAt(start + 1 + name.length))) {
    return -1;
  }
  return indexOfCached(lower, '>', start + 1 + name.length, cursors.openerEnd);
}

/**
 * Where the first `</name   >` closing tag at or after `from` ends, or -1.
 * The result is cached in the name's cursor as the closing tag's start, so a
 * later opener whose search begins before it reuses the answer.
 * @param lower - The ASCII-lower-cased text.
 * @param from - Where to start looking.
 * @param name - `script` or `style`.
 * @param cursors - The name's cursor is used and updated.
 */
function closingTagEnd(lower: string, from: number, name: 'script' | 'style', cursors: MarkerCursors): number {
  const cursor = name === 'script' ? cursors.scriptEnd : cursors.styleEnd;
  const marker = `</${name}`;
  if (!cursorCovers(cursor, from)) {
    cursor.searchedFrom = from;
    cursor.position = findClosingTagStart(lower, marker, from);
  }
  if (cursor.position === -1) {
    return -1;
  }
  return closingTagEndFrom(lower, cursor.position + marker.length);
}

/**
 * Where the first complete closing tag (`</name`, optional whitespace, `>`)
 * starts at or after `from`, or -1. The whitespace checked after a rejected
 * candidate holds no `<`, so the checks never overlap.
 * @param lower - The ASCII-lower-cased text.
 * @param marker - `</script` or `</style`.
 * @param from - Where to start looking.
 */
function findClosingTagStart(lower: string, marker: string, from: number): number {
  let candidate = lower.indexOf(marker, from);
  while (candidate !== -1) {
    if (lower.charAt(skipWhitespace(lower, candidate + marker.length)) === '>') {
      return candidate;
    }
    candidate = lower.indexOf(marker, candidate + marker.length);
  }
  return -1;
}

/**
 * The index of the first non-whitespace character at or after `from`.
 * @param text - Any text.
 * @param from - Where to start.
 */
function skipWhitespace(text: string, from: number): number {
  let cursor = from;
  while (/\s/.test(text.charAt(cursor))) {
    cursor += 1;
  }
  return cursor;
}

/**
 * The index just past the `>` that ends a closing tag whose name ends at
 * `nameEnd` (the caller already checked the `>` is there).
 * @param lower - The ASCII-lower-cased text.
 * @param nameEnd - Index just after `</script` or `</style`.
 */
function closingTagEndFrom(lower: string, nameEnd: number): number {
  return skipWhitespace(lower, nameEnd) + 1;
}

/**
 * Where the non-text block starting at the `<` at `start` ends, or -1 when the
 * `<` starts something else. A block is a comment, or a script/style element
 * with both its opening and closing tag; an unclosed one is left for the tag
 * stripper, as before.
 * @param lower - The ASCII-lower-cased text.
 * @param start - Index of a `<`.
 * @param cursors - The marker cursors.
 */
function nonTextBlockEnd(lower: string, start: number, cursors: MarkerCursors): number {
  if (lower.startsWith('<!--', start)) {
    const close = indexOfCached(lower, '-->', start + 4, cursors.commentEnd);
    return close === -1 ? -1 : close + 3;
  }
  for (const name of NON_TEXT_TAG_NAMES) {
    const openerEnd = openingTagEnd(lower, start, name, cursors);
    if (openerEnd !== -1) {
      return closingTagEnd(lower, openerEnd + 1, name, cursors);
    }
  }
  return -1;
}

/**
 * Replaces every script, style and comment block with a space, in one pass.
 * @param html - Article HTML.
 */
function removeNonTextBlocks(html: string): string {
  const lower = lowerAscii(html);
  const cursors: MarkerCursors = { commentEnd: newCursor(), scriptEnd: newCursor(), styleEnd: newCursor(), openerEnd: newCursor() };
  const kept: string[] = [];
  let copiedUpTo = 0;
  let lessThan = lower.indexOf('<');
  while (lessThan !== -1) {
    const blockEnd = nonTextBlockEnd(lower, lessThan, cursors);
    if (blockEnd === -1) {
      lessThan = lower.indexOf('<', lessThan + 1);
    } else {
      kept.push(html.slice(copiedUpTo, lessThan), ' ');
      copiedUpTo = blockEnd;
      lessThan = lower.indexOf('<', blockEnd);
    }
  }
  kept.push(html.slice(copiedUpTo));
  return kept.join('');
}

/**
 * Replaces every `<...>` tag with a space, in one pass. A `<` with no `>`
 * after it, or directly followed by `>`, stays as text, as the old
 * `/<[^>]+>/g` left it.
 * @param html - Article HTML.
 */
function replaceTagsWithSpaces(html: string): string {
  const kept: string[] = [];
  let copiedUpTo = 0;
  let lessThan = html.indexOf('<');
  while (lessThan !== -1) {
    const greaterThan = html.indexOf('>', lessThan + 1);
    if (greaterThan === -1) {
      break;
    }
    if (greaterThan === lessThan + 1) {
      lessThan = html.indexOf('<', greaterThan);
    } else {
      kept.push(html.slice(copiedUpTo, lessThan), ' ');
      copiedUpTo = greaterThan + 1;
      lessThan = html.indexOf('<', copiedUpTo);
    }
  }
  kept.push(html.slice(copiedUpTo));
  return kept.join('');
}

/**
 * An article body as plain text: non-text blocks removed, tags and entities
 * stripped, whitespace collapsed. Time is linear in the body length whatever
 * the markup, because the partner controls the body.
 * @param html - The article's `body`, or null.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  const withoutTags = replaceTagsWithSpaces(removeNonTextBlocks(html ?? ''));
  return withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, '\'')
    // Last, so `&amp;lt;` becomes the text `&lt;` and not a second-round `<`.
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The first `maxCharacters` of a text, never ending on half of an emoji or
 * other character stored as two UTF-16 units.
 * @param text - Any text.
 * @param maxCharacters - The most UTF-16 units to keep.
 */
export function firstCharacters(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text;
  }
  const lastUnit = text.charCodeAt(maxCharacters - 1);
  const splitsPair = lastUnit >= 0xD800 && lastUnit <= 0xDBFF;
  return text.slice(0, splitsPair ? maxCharacters - 1 : maxCharacters);
}

/**
 * A text cut at a cap, saying whether it was cut and how long it was.
 * @param text - Any text.
 * @param maxCharacters - The cap.
 */
export function capText(text: string, maxCharacters: number): { text: string; truncated: boolean; totalCharacters: number } {
  const truncated = text.length > maxCharacters;
  return { text: truncated ? firstCharacters(text, maxCharacters) : text, truncated, totalCharacters: text.length };
}

/**
 * How many of these rows fit under a character cap when the whole result is
 * serialized as compact JSON: each row costs its own JSON plus a comma, after
 * a reserve for the fields around the rows. Rows are kept in order and the
 * first one that does not fit ends the list, so the cut is never a half row.
 * @param rows - Rows, each already JSON-serializable.
 * @param maxCharacters - The cap on the whole serialized result.
 * @param reservedCharacters - What the fields around the rows will take.
 */
export function rowsThatFit(rows: readonly unknown[], maxCharacters: number, reservedCharacters: number): number {
  let used = reservedCharacters;
  let kept = 0;
  for (const row of rows) {
    used += JSON.stringify(row).length + 1;
    if (used > maxCharacters) {
      break;
    }
    kept += 1;
  }
  return kept;
}
