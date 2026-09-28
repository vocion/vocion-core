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

/**
 * The shortest repeat worth removing. A continuation that happens to begin
 * with a few of the characters the answer ended on ("re" after "The") is
 * finishing a word, not repeating one.
 */
const MIN_REPEAT = 12;

/** How much of the answer's tail a continuation is compared against. */
const TAIL_WINDOW = 2_000;

/**
 * How many leading characters of `continuation` repeat the end of `prior`:
 * the longest k ≥ {@link MIN_REPEAT} with continuation[0..k) equal to prior's
 * last k characters, else 0.
 * @param prior - What the answer already said.
 * @param continuation - What the continuation said.
 */
export function repeatedLead(prior: string, continuation: string): number {
  const tail = prior.slice(-TAIL_WINDOW);
  for (let k = Math.min(tail.length, continuation.length); k >= MIN_REPEAT; k--) {
    if (tail.endsWith(continuation.slice(0, k))) {
      return k;
    }
  }
  return 0;
}

/**
 * A CONTINUATION THAT REPEATS WHERE IT STARTED, JOINED ONCE.
 *
 * Conversation 349 (2026-09-28): an answer stopped at "**There", the turn
 * re-entered to finish it ("continue exactly from where it stopped"), and the
 * model began again from the middle of an earlier word — "een — approving it
 * is what writes the record. … **There is still …". Appended as it came, the
 * stored reply read "**Thereeen — approving it…", a paragraph twice over.
 *
 * This holds the continuation's first characters back until it is plain
 * whether they repeat the answer's end, then releases them with the repeat
 * removed. It decides as soon as it can: the moment the held text is no
 * longer something the answer's tail contains, no longer repeat is possible,
 * so a continuation that does not repeat streams after a character or two.
 * Pure and deterministic (truncation.test.ts).
 */
export class ContinuationJoin {
  private held = '';
  private decided = false;
  private readonly tail: string;

  /**
   * @param prior - The answer as it stood when the continuation began.
   */
  constructor(prior: string) {
    this.tail = prior.slice(-TAIL_WINDOW);
  }

  /**
   * Feed a delta; get the text to release now.
   * @param delta - The next piece of the continuation.
   */
  push(delta: string): string {
    if (this.decided) {
      return delta;
    }
    this.held += delta;
    if (this.held.length < this.tail.length && this.tail.includes(this.held)) {
      return '';
    }
    return this.release();
  }

  /** At the end of the continuation: whatever is still held. */
  flush(): string {
    return this.decided ? '' : this.release();
  }

  private release(): string {
    this.decided = true;
    const k = repeatedLead(this.tail, this.held);
    const out = this.held.slice(k);
    this.held = '';
    return out;
  }
}
