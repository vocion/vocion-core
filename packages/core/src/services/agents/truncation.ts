/**
 * An answer that stops mid-sentence.
 *
 * Mission run 5364 (2026-09-26): the QA reviewer read a pull request's diff,
 * began its verdict and ended at "Head read at `" — 367 characters, an open
 * code span, no verdict. The loop's guarantees look for promises, empty
 * turns and narrated calls; a reply cut off in the middle of a word is none
 * of those, so it was accepted as the answer. It is not one.
 *
 * Deliberately narrow: an unclosed inline-code span or fence, or a last line
 * that ends in a word with no closing punctuation after a long enough answer.
 * A heading, a list item or a table row can end without a full stop and is
 * not a cut.
 * @param text - The answer as it will be shown.
 */
export function cutOffMidSentence(text: string): boolean {
  const t = text.trimEnd();
  if (t.length < 40) {
    return false;
  }
  const fences = (t.match(/^```/gm) ?? []).length;
  if (fences % 2 === 1) {
    return true;
  }
  const last = t.split('\n').pop() ?? '';
  const ticks = (last.replace(/```/g, '').match(/`/g) ?? []).length;
  if (ticks % 2 === 1) {
    return true;
  }
  if (/^\s*(?:#|[-*+] |\d+\. |\|)/.test(last)) {
    return false;
  }
  return /[A-Z0-9,;:(\-–]\s*$/i.test(last) && !/[.!?)"'’”*_>\]]\s*$/.test(last);
}
