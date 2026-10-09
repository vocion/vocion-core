/**
 * A card's title, as a person reads it at a glance: a short plain-language
 * action, never a paragraph cut off mid-thought. The founder's card on
 * 2026-10-08 was titled with the first 120 characters of its rationale,
 * "The operating intent names this as one of three repositories in the
 * factory's scope and states its production/reliabi…", over that same
 * rationale. Shared by the server that describes a proposal and the card
 * that draws one, so both cut the same way.
 */

/** The longest a card's title reads before it is cut at a word: a short action, not a paragraph. */
const CARD_TITLE_MAX = 70;

/**
 * A card's title as a short line: whole when it fits, else cut at the last
 * word that fits, with an ellipsis. Never mid-word.
 * @param title - The title as written.
 * @param max - The longest it may be.
 */
export function shortTitle(title: string, max = CARD_TITLE_MAX): string {
  const t = title.trim().replace(/\s+/g, ' ');
  if (t.length <= max) {
    return t;
  }
  const cut = t.slice(0, max - 1);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}
