/**
 * Text shaping for the ask screen — the manifesto's "simplest useful
 * explanation first, evidence underneath" applied to whatever a filer sent.
 * A verbose filer (a nine-line body, an option description that repeats the
 * body) must still read as one question with two or three short rows. Pure
 * functions, so the clamp and duplicate rules are testable without a DOM.
 */

/** How much of the body shows before "Show details". */
export const BODY_LEAD_CHARS = 240;
export const BODY_LEAD_SENTENCES = 2;

/** Filers get a hint in the server log past these. */
export const TITLE_SOFT_LIMIT = 80;
export const BODY_SOFT_LIMIT = 400;

/**
 * "one slack app per WORKSPACE?" → "One slack app per WORKSPACE?". Only the
 * first letter moves; the rest is the filer's — an acronym or a slug in a
 * title must survive.
 * @param text
 */
export function sentenceCase(text: string): string {
  const t = text.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * Split a body into the lead — its first two sentences or ~240 characters,
 * whichever comes first, cut on a sentence or word boundary — and the rest.
 * Markdown block breaks count as sentence ends. `rest` is null when nothing
 * was cut.
 * @param body
 * @param opts
 * @param opts.chars
 * @param opts.sentences
 */
export function splitBody(body: string | null | undefined, opts: { chars?: number; sentences?: number } = {}): { lead: string; rest: string | null } {
  const chars = opts.chars ?? BODY_LEAD_CHARS;
  const sentences = opts.sentences ?? BODY_LEAD_SENTENCES;
  const text = (body ?? '').trim();
  if (!text) {
    return { lead: '', rest: null };
  }
  // Sentence ends: terminal punctuation followed by whitespace, or a blank line.
  const ends: number[] = [];
  const re = /[.!?](?=\s)|\n\s*\n/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    ends.push(m.index + (m[0].startsWith('\n') ? 0 : 1));
    m = re.exec(text);
  }
  let cut = text.length;
  if (ends.length >= sentences && ends[sentences - 1]! < text.length) {
    cut = ends[sentences - 1]!;
  }
  if (cut > chars) {
    // Prefer the last sentence end inside the budget; else the last word break.
    const lastEnd = ends.filter(e => e <= chars).pop();
    if (lastEnd && lastEnd > chars / 2) {
      cut = lastEnd;
    } else {
      const space = text.lastIndexOf(' ', chars);
      cut = space > chars / 2 ? space : chars;
    }
  }
  if (cut >= text.length) {
    return { lead: text, rest: null };
  }
  const lead = text.slice(0, cut).trim();
  const rest = text.slice(cut).trim();
  return { lead: /[.!?:]$/.test(lead) ? lead : `${lead}…`, rest: rest || null };
}

/**
 * The first paragraph of a body — what an option description most often
 * repeats.
 * @param body
 */
export function firstParagraph(body: string | null | undefined): string {
  return (body ?? '').trim().split(/\n\s*\n/)[0]?.trim() ?? '';
}

/**
 * Lower-case letters and digits only — punctuation, markdown and spacing
 * never make two sentences different.
 * @param text
 */
export function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * True when one text is (nearly) a prefix of the other — the option
 * description repeats the body, or the body opens with the description. The
 * share is the common prefix over the shorter text; ≥ 0.8 is a duplicate.
 * Empty on either side is never a duplicate.
 * @param a
 * @param b
 * @param threshold
 */
export function isNearDuplicate(a: string | null | undefined, b: string | null | undefined, threshold = 0.8): boolean {
  const x = normaliseText(a ?? '');
  const y = normaliseText(b ?? '');
  if (!x || !y) {
    return false;
  }
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  let i = 0;
  while (i < short.length && short[i] === long[i]) {
    i++;
  }
  // A description contained anywhere in the body counts too.
  if (i / short.length < threshold && long.includes(short) && short.length >= 24) {
    return true;
  }
  return i / short.length >= threshold;
}

/**
 * Whether a filed ask is longer than reads well on a phone, and why. Used for
 * the server-log hint on file.
 * @param ask
 * @param ask.title
 * @param ask.body
 */
export function verbosityHints(ask: { title: string; body?: string | null }): string[] {
  const hints: string[] = [];
  if (ask.title.trim().length > TITLE_SOFT_LIMIT) {
    hints.push(`title is ${ask.title.trim().length} chars (aim for ≤ ${TITLE_SOFT_LIMIT})`);
  }
  const body = (ask.body ?? '').trim();
  if (body.length > BODY_SOFT_LIMIT) {
    hints.push(`body is ${body.length} chars (aim for ≤ ${BODY_SOFT_LIMIT}; put the long form in contextMd)`);
  }
  return hints;
}
