/**
 * The title an artifact is filed under, when the model's own title is not one.
 *
 * `render_markdown` asked the model for a title and got "Right now — Sep 17,
 * 4:50 PM UTC", "Today — Sep 17, 2026", "Sample Document". A timestamp is not
 * a title, and a person scanning the artifacts list cannot tell two of them
 * apart (Chris, 2026-09-17: *"the artifact titles should be more dynamic, not
 * just reference time or 'requested'. We should be generating a title based
 * on context and content."*).
 *
 * So the title is derived from the CONTENT when the model's is weak, in this
 * order, deterministically (CLAUDE.md, structural over prompting):
 *
 *   1. the model's title with any trailing date or time stripped, if what is
 *      left says something — "Pipeline review — Sep 17" → "Pipeline review";
 *   2. the document's first heading;
 *   3. its first sentence, capped;
 *   4. the caller's fallback (the request's subject, or the kind).
 *
 * A title is WEAK when, after the date is stripped, it is empty, a single
 * generic word ("Update", "Response", "Document"), or a time word ("Right
 * now", "Today", "Now").
 */

/**
 * A trailing date/time the model wrote, in the shapes it produces: "— Sep 17,
 * 4:50 PM UTC", "(Wed Sep 16)", "- Sep 16, 2026", "— 4:50 PM". Anchored at
 * the end; every optional part carries its own separator so no two quantifiers
 * can trade characters (regexp/no-super-linear-backtracking).
 */
const TRAILING_DATE
  = /[\s—–\-(:,]*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s\d{4}|\s\d{4}|,\d{4})?(?:,?\s\d{1,2}:\d{2}(?:\s?[ap]m)?(?:\s[A-Z]{2,4})?)?\)?$/i;
const TRAILING_TIME = /[\s—–\-(:,]*\d{1,2}:\d{2}(?:\s?[ap]m)?(?:\s[A-Z]{2,4})?\)?$/i;

const GENERIC = new Set([
  'right now',
  'now',
  'today',
  'tomorrow',
  'yesterday',
  'this morning',
  'this afternoon',
  'tonight',
  'update',
  'updated',
  'response',
  'answer',
  'result',
  'results',
  'output',
  'summary',
  'document',
  'doc',
  'artifact',
  'note',
  'notes',
  'draft',
  'report',
  'sample document',
  'untitled',
  'requested',
  'requested document',
  'here you go',
  'done',
  // The kind, echoed back as the name.
  'table',
  'chart',
  'record',
  'markdown',
  'file',
  'list',
  'data',
]);

/** Max length of a derived title. */
const MAX = 90;

/**
 * Strip a trailing date/time and tidy.
 * @param title - What the model supplied.
 */
export function stripStamp(title: string): string {
  let out = (title ?? '').trim();
  // Two passes: "Today — Sep 17, 2026" strips the date, then "Today" is judged weak below.
  for (let i = 0; i < 2; i++) {
    out = out.replace(TRAILING_DATE, '').replace(TRAILING_TIME, '').trim().replace(/[\s—–\-,:(]+$/, '').trim();
  }
  return out;
}

/**
 * Whether a title says anything.
 * @param title - After `stripStamp`.
 */
export function isWeakTitle(title: string): boolean {
  const t = title.trim().replace(/[.!…]+$/, '').toLowerCase();
  if (!t) {
    return true;
  }
  if (GENERIC.has(t)) {
    return true;
  }
  // One short word is a label, not a title.
  return !t.includes(' ') && t.length < 4;
}

function cap(s: string): string {
  const clean = s.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > MAX ? `${clean.slice(0, MAX - 1).trimEnd()}…` : clean;
}

/**
 * The first heading of a markdown body, or null.
 * @param md - Markdown.
 */
export function firstHeading(md: string): string | null {
  const m = /^#{1,6}[ \t]+(\S.*)$/m.exec(md ?? '');
  const h = m?.[1] ? cap(m[1]) : '';
  return h && !isWeakTitle(stripStamp(h)) ? h : null;
}

/**
 * The first sentence of a body, headings and list markers skipped, or null.
 * @param text - Markdown or plain text.
 */
export function firstSentence(text: string): string | null {
  const lines = (text ?? '').split('\n').map(l => l.trim()).filter(l => l && !/^#{1,6}\s/.test(l) && !/^[-*>|`]/.test(l) && !/^\d+\.\s/.test(l));
  const para = lines[0] ?? '';
  const sentence = para.split(/(?<=[.!?])\s+/)[0] ?? '';
  const out = cap(sentence);
  return out && !isWeakTitle(out) && out.split(' ').length >= 2 ? out : null;
}

/**
 * The title to file an artifact under.
 * @param modelTitle - What the model supplied.
 * @param content - The body to derive from when the model's title is weak.
 * @param content.md - Markdown body (markdown artifacts, wrapped answers).
 * @param content.caption - A table's caption.
 * @param content.text - Any other text.
 * @param fallback - What to call it when nothing else says anything.
 */
export function artifactTitle(modelTitle: string, content: { md?: string; caption?: string; text?: string } = {}, fallback = 'Document'): string {
  const stripped = stripStamp(modelTitle);
  if (!isWeakTitle(stripped)) {
    return cap(stripped);
  }
  const body = content.md ?? content.text ?? '';
  return firstHeading(body)
    ?? firstSentence(body)
    ?? (content.caption && !isWeakTitle(content.caption) ? cap(content.caption) : null)
    ?? (isWeakTitle(stripStamp(fallback)) ? fallback : cap(fallback));
}
