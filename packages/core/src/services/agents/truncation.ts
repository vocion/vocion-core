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
 * The trailing run of letters `s` ends on — the word a cut landed in the
 * middle of, or the last whole one before whatever follows. Empty when `s`
 * does not end in a letter.
 * @param s - The text to look at the end of.
 */
function trailingWord(s: string): string {
  return s.match(/[a-z]+$/i)?.[0] ?? '';
}

/**
 * A CLOSED, short list of words whose capital letter is trustworthy: a
 * possessive or subject pronoun that all but never prefixes an unrelated
 * English word. Case matters — sentence-initial and mid-sentence variants
 * are listed separately because only the capitalized spelling is safe to
 * trust; a lowercase `my` mid-sentence is exactly as ambiguous as `cont`.
 *
 * The set every OTHER capitalized fragment is tested against — "The",
 * "This", "Is", "An" — is the opposite: short, common words that are
 * FAMOUS prefixes of dozens of others ("The" of "There", "Them", "Theme";
 * "Is" of "Isle", "Island"), so treating one of those as complete is the
 * wrong default and they are deliberately left off this list, staying
 * glued exactly as they did before this fix existed.
 */
const SAFE_WHOLE_WORDS = new Set(['I', 'My', 'Our', 'Your', 'His', 'Her', 'Its', 'Their', 'Mine', 'Ours', 'Yours', 'Theirs']);

/**
 * DOES A RELEASE NEED A SPACE BEFORE IT, SO TWO WORDS ARE NEVER GLUED?
 *
 * Prod: a stored reply read "**Mylast message" — the continuation after
 * "**My" started with "last message" and nothing separated the two words.
 * "Continue exactly from where it stopped" is answered both ways: a
 * continuation that resumed cleanly already carries its own leading space
 * (`" the title"` after `"I changed"`) and this leaves that alone; one that
 * does not leaves no signal in ITSELF that a boundary was crossed.
 *
 * The signal this uses instead is the overlap detection already above: when
 * `repeatedLead` found nothing to remove — no shared text at the join at
 * all — a capital letter alone is NOT enough to call the word whole: an
 * existing case (conversation 349) has the answer stop at "**The" and the
 * continuation resume "re is still …", finishing "There" — "The" is
 * capitalized and still mid-word. The only trustworthy signal left is
 * membership in {@link SAFE_WHOLE_WORDS}, a closed set of pronouns that
 * essentially never continue into a longer word. Everything else —
 * lowercase (`cont`, waiting for `inuation`) or a capitalized word NOT on
 * the list (`The`, waiting for `re`) — glues, exactly as it always has.
 *
 * Deliberately narrow, like {@link cutOffMidSentence}: a genuinely finished
 * word outside the list (`"the cat"` + `"sat"`, or a real "**The" that meant
 * the article) still glues. That false negative is the same trade
 * `MIN_REPEAT` makes for repeats — expand the list when real use demands a
 * name for it, never guess a general rule past what the two known cases prove.
 * @param tail - What the answer ended on (its last {@link TAIL_WINDOW} characters).
 * @param out - What is about to be released, after any repeat is removed.
 */
export function needsJoinSpace(tail: string, out: string): boolean {
  if (out === '' || /^\s/.test(out)) {
    // Nothing to join, or the continuation already drew its own boundary.
    return false;
  }
  if (!/[a-z0-9]$/i.test(tail) || !/[a-z]/i.test(out.charAt(0))) {
    // Not a letter/letter join — a fence, a marker, a digit: leave it as the
    // repeat logic above already decided.
    return false;
  }
  return SAFE_WHOLE_WORDS.has(trailingWord(tail));
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
 *
 * A release with nothing to remove still gets one more check before it goes
 * out: {@link needsJoinSpace} decides whether the join needs a space so two
 * words are never glued (prod: "**Mylast message").
 *
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
    return needsJoinSpace(this.tail, out) ? ` ${out}` : out;
  }
}
