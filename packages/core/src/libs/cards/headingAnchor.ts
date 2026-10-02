/**
 * HEADING ANCHORS — one rule for the id a markdown heading gets, shared by the
 * page that draws the heading and the link that points at it.
 *
 * A release names the named test that proves a criterion, and the proof is a
 * section of the stored test-run artifact ("## Passed: The CSV filename is…").
 * The link opens the artifact AT that section only if the drawing and the
 * link agree on the id, so both read it from here rather than from a slugger
 * each side configures on its own.
 *
 * Pure, safe on the client.
 */

/**
 * The heading's words without the inline markdown around them.
 * @param raw - The heading line after its `#`s.
 */
export function headingText(raw: string): string {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The anchor for one heading's words: lower case, letters, digits and
 * hyphens, at most 80 characters. Not unique on its own — {@link anchorCounter}
 * numbers the repeats.
 * @param text - The heading's words.
 */
export function headingAnchor(text: string): string {
  const slug = text
    .toLowerCase()
    // Decomposed, an accented letter is the letter and a mark; the mark goes
    // with every other character that is not a letter, digit, space or hyphen.
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/-$/, '');
  return slug || 'section';
}

/**
 * Numbers repeated anchors the way a document reads them: the first
 * `passed-x`, the second `passed-x-1`. One counter per drawing of one document.
 */
export function anchorCounter(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = headingAnchor(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

export type MarkdownSection = { level: number; text: string; anchor: string; body: string };

/**
 * A markdown document's headed sections, in order, each with the anchor its
 * drawing gives it and the text under it (up to the next heading). Lines in a
 * fenced block are never headings.
 * @param md - The document.
 */
export function markdownSections(md: string): MarkdownSection[] {
  const next = anchorCounter();
  const out: MarkdownSection[] = [];
  let fenced = false;
  let current: MarkdownSection | null = null;
  for (const line of md.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
    }
    const m = fenced ? null : /^(#{1,6})\s+(\S.*)$/.exec(line);
    if (m) {
      // A closing run of #s is not part of the heading's words.
      const text = headingText(m[2]!.replace(/\s#+$/, ''));
      current = { level: m[1]!.length, text, anchor: next(text), body: '' };
      out.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  return out;
}
