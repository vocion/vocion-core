/**
 * Front-door copy (`docs/design/patterns.md` § Front doors): a card says what
 * a thing does in ONE sentence. Authored copy should already be one sentence;
 * this trims a longer description from data (a catalog entry, a manifest) to
 * its first, so a card never grows a paragraph. The full text stays where the
 * door leads.
 *
 * Display trimming, not interpretation: it splits on sentence punctuation
 * followed by a space and an uppercase letter, so "v2.1" and "e.g. this" stay
 * whole.
 * @param text - A description of any length.
 */
export function firstSentence(text: string | null | undefined): string {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  const match = /^(.+?[.!?])\s+(?=\p{Lu})/u.exec(t);
  return match ? match[1]! : t;
}
