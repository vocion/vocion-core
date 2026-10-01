/**
 * A RECORD THE ANSWER NAMES IS ONE CLICK AWAY.
 *
 * An answer says "#201" or "request 201" and the person has to go and find it
 * (Chris, 2026-09-28: "I want to click through to the feature detail page").
 * The server finds the mentions (`findRecordMentions`), checks each names a
 * real record of that kind in the workspace, and sends the links as a typed
 * `record_links` event; the same pure function (`linkRecordMentions`) applies
 * them to the live transcript and to the stored one. Deterministic
 * post-processing, never a prompt line.
 *
 * Pure and safe on the client.
 */

/**
 * One mention: the words as written, the id, and the kind it was called by
 * (null for a bare `#201`) — or, for a code (`FE-201`, `RUN-439`), its prefix.
 */
export type RecordMention = { text: string; id: number; word: string | null; code?: string };

/** One link: the words to link, and where they go. */
export type RecordMentionLink = { text: string; href: string };

/**
 * Words that put a bare `#N` in some other numbering than the workspace's
 * records: a pull request, a run, a proposal, a step. Such a mention is left alone.
 */
const OTHER_NUMBERING = /(?:\bPRs?|\bpull(?:\s+request)?|\bissues?|\bruns?|\bproposals?|\bturns?|\bcommits?|\bsteps?|\bcards?|\bfindings?|\bwalks?|\bconversations?|\bbacklog|\bversion|\bv|\bno\.?|\bnumber|\brank(?:ed)?|\bthe|\ba)\s*$/i;

/** A bare `#N` below this is more often a rank ("the #1 thing") than a record. */
const BARE_MIN_ID = 10;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The spans no link may be put inside: fenced and inline code, existing
 * markdown links (text and target), and bare URLs.
 * @param text - The answer.
 */
function protectedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const re of [/```[\s\S]*?```/g, /`[^`\n]*`/g, /\[[^\]\n]*\]\([^)\n]*\)/g, /https?:\/\/\S+/g, /<a\b[\s\S]*?<\/a>/gi]) {
    for (const m of text.matchAll(re)) {
      spans.push([m.index!, m.index! + m[0].length]);
    }
  }
  return spans;
}

function inside(spans: Array<[number, number]>, start: number, end: number): boolean {
  return spans.some(([a, b]) => start < b && end > a);
}

/**
 * Every record mention in the answer: `<kind> 201`, `<kind> #201` (the kind
 * one of `words` — the workspace's object type slugs, labels and page names)
 * and a bare `#201` not written in some other numbering.
 * @param text - The answer.
 * A code — `FE-201`, `RUN-439`, one of `codes` written in capitals — is a
 * mention too, with its prefix (`libs/codes.ts`).
 * @param words - What the workspace calls its records ("request", "feature", "deal").
 * @param codes - The prefixes this workspace reads things by (FE, PL, RUN, ASK…).
 */
export function findRecordMentions(text: string, words: readonly string[], codes: readonly string[] = []): RecordMention[] {
  const spans = protectedSpans(text);
  const coded: RecordMention[] = [];
  const prefixes = [...new Set(codes.filter(c => /^[A-Z]{2,5}$/.test(c)))].sort((a, b) => b.length - a.length);
  if (prefixes.length > 0) {
    for (const m of text.matchAll(new RegExp(`(?<![\\w-])(${prefixes.join('|')})-(\\d{1,9})\\b`, 'g'))) {
      if (!inside(spans, m.index!, m.index! + m[0].length)) {
        coded.push({ text: m[0], id: Number(m[2]), word: null, code: m[1]! });
      }
    }
  }
  const vocab = [...new Set(words.map(w => w.trim().toLowerCase()).filter(w => w.length >= 2))].sort((a, b) => b.length - a.length);
  const typed = vocab.length > 0 ? `\\b(${vocab.map(w => escapeRegex(w).replace(/[\s_-]+/g, '[\\s_-]+')).join('|')})s?\\s+#?(\\d{1,7})\\b` : null;
  const re = new RegExp(`${typed ? `${typed}|` : ''}(?<![\\w&/#])#(\\d{1,7})\\b`, 'gi');
  const out: RecordMention[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (inside(spans, start, end)) {
      continue;
    }
    if (typed && m[1] && m[2]) {
      out.push({ text: m[0], id: Number(m[2]), word: m[1].toLowerCase().replace(/[\s_-]+/g, ' ') });
      continue;
    }
    const id = Number(typed ? m[3] : m[1]);
    if (!Number.isInteger(id) || id < BARE_MIN_ID || OTHER_NUMBERING.test(text.slice(Math.max(0, start - 24), start))) {
      continue;
    }
    out.push({ text: m[0], id, word: null });
  }
  return [...coded, ...out];
}

/**
 * Link each mention's words to its page, everywhere they appear outside code
 * and existing links. Idempotent: a linked mention is inside a link and is
 * left alone the second time.
 * @param text - The answer (or one passage of it).
 * @param links - The mentions to link, as the server resolved them.
 */
export function linkRecordMentions(text: string, links: readonly RecordMentionLink[]): string {
  const usable = links.filter(l => l.text.trim() && l.href);
  if (usable.length === 0 || !text) {
    return text;
  }
  const byText = new Map(usable.map(l => [l.text.toLowerCase(), l.href]));
  const alternatives = [...byText.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  const re = new RegExp(`(?<![\\w#\\[/])(?:${alternatives.join('|')})(?![\\w\\]])`, 'gi');
  const spans = protectedSpans(text);
  return text.replace(re, (match, offset: number) => {
    if (inside(spans, offset, offset + match.length)) {
      return match;
    }
    const href = byText.get(match.toLowerCase());
    return href ? `[${match}](${href})` : match;
  });
}
