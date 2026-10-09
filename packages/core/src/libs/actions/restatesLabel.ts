/**
 * Whether a sentence only restates a card's label — "Draft reply to Dana on
 * the call" as the rationale of a card labelled the same. The Why a reviewer
 * reads is then the title a second time, which is no reason at all (proposal
 * 8017, 2026-10-09: "The reasoning" and "Why it suggests that" both repeated
 * the title). Compared on the words, ignoring case, punctuation and a
 * "Recommended:" prefix.
 * @param sentence - The rationale or reason.
 * @param label - The card's label.
 */
export function restatesLabel(sentence: string | undefined, label: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/^\s*recommended\s*:\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const a = words(sentence ?? '');
  const b = words(label);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length / long.length >= 0.8;
}
