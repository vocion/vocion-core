/**
 * A REPLY LEADS WITH ITS ANSWER, AND THE REST FOLDS.
 *
 * Chris, 2026-09-29, on an eight-paragraph product-manager reply
 * (conversation 373): "overall this response is a little too long to be
 * useful and respondable". A transcript that is a wall of paragraphs cannot
 * be answered in one move. So a long reply shows its lead — the first
 * paragraph, or about the first 80 words where the paragraph runs on — and
 * the rest folds behind "Show more" in the same message. Nothing is cut:
 * the whole answer is one tap away, and a short reply is never folded.
 *
 * Pure and deterministic: the same text always folds at the same place, on
 * the live turn once it has finished and on every reload.
 */

/** A reply this long or shorter is shown whole. */
export const FOLD_ABOVE_WORDS = 150;
/** The lead aims for this many words: one paragraph, or the sentences that reach it. */
export const LEAD_WORDS = 80;
/** Folding fewer words than this hides too little to be worth a tap. */
const MIN_FOLDED_WORDS = 40;
/** A first block shorter than this ("I'll read the record.") is not a lead on its own. */
const MIN_LEAD_WORDS = 20;

export type ReplyFold = { lead: string; rest: string; restWords: number };

const wordsIn = (s: string): number => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;

/**
 * Markdown blocks — split on blank lines, never inside a code fence.
 * @param text - The reply.
 */
function blocksOf(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
    }
    if (!fenced && line.trim() === '') {
      if (cur.length > 0) {
        out.push(cur.join('\n'));
        cur = [];
      }
      continue;
    }
    cur.push(line);
  }
  if (cur.length > 0) {
    out.push(cur.join('\n'));
  }
  return out;
}

/**
 * Inline markup that must not be split across the lead and the rest.
 * @param s - The lead so far.
 */
const balanced = (s: string): boolean => (s.match(/\*\*/g) ?? []).length % 2 === 0 && (s.match(/`/g) ?? []).length % 2 === 0 && (s.match(/\[/g) ?? []).length === (s.match(/\]/g) ?? []).length;

/**
 * A paragraph that runs well past the lead is cut after the first sentence
 * that reaches it, where no bold, code or link is left open. A list, a table
 * or a quote is never cut inside.
 * @param block - One paragraph.
 */
function cutParagraph(block: string): { head: string; tail: string } | null {
  if (/^\s*(?:[-*+]\s|\d+[.)]\s|[|>#])/.test(block)) {
    return null;
  }
  const ends = [...block.matchAll(/[.!?](?:\*\*|["”’)])?\s+(?=[A-Z0-9*[`"“])/g)];
  for (const m of ends) {
    const at = m.index! + m[0].trimEnd().length;
    const head = block.slice(0, at);
    if (wordsIn(head) >= LEAD_WORDS && balanced(head)) {
      const tail = block.slice(at).trim();
      return tail ? { head, tail } : null;
    }
  }
  return null;
}

/**
 * Where a reply folds, or null when it is shown whole.
 * @param text - The reply as Markdown.
 */
export function foldReply(text: string): ReplyFold | null {
  if (wordsIn(text) <= FOLD_ABOVE_WORDS) {
    return null;
  }
  const blocks = blocksOf(text);
  const lead: string[] = [];
  let i = 0;
  // The lead is whole blocks until it reads as an answer: a heading or a
  // one-line preamble alone is not one.
  while (i < blocks.length && (lead.length === 0 || wordsIn(lead.join(' ')) < MIN_LEAD_WORDS)) {
    lead.push(blocks[i]!);
    i += 1;
  }
  let rest = blocks.slice(i);
  // One paragraph that runs on is the lead only up to the sentence that reaches ~80 words.
  const last = lead[lead.length - 1]!;
  if (wordsIn(lead.join(' ')) > LEAD_WORDS * 1.75) {
    const cut = cutParagraph(last);
    if (cut) {
      lead[lead.length - 1] = cut.head;
      rest = [cut.tail, ...rest];
    }
  }
  const restText = rest.join('\n\n');
  const restWords = wordsIn(restText);
  if (restWords < MIN_FOLDED_WORDS) {
    return null;
  }
  return { lead: lead.join('\n\n'), rest: restText, restWords };
}
