/**
 * How a printed value is collapsed before it is compared with an operator's
 * value: the `normalise` block of `resolveAgainst` and of `dropIfNotIn`.
 *
 * Its own module, and free of the database, so the validation gate can use it
 * without pulling in the resolver's reads.
 */

import { normaliseForKey } from '@/libs/actions/objects-propose-candidate';

/** How a value is compared, per a rule's `normalise` block for that field. */
export type NormaliseRule = {
  dropWords?: string[];
  abbreviations?: Record<string, string>;
};

/**
 * Escape a literal for use inside a regular expression.
 * @param text - The literal to escape.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The value with the rule's abbreviations expanded and its drop words gone.
 * @param value - The printed value.
 * @param rule - The per-field normalise block, if the config declared one.
 */
function collapse(value: unknown, rule: NormaliseRule | undefined): string {
  let text = String(value ?? '').toLowerCase();
  for (const [from, to] of Object.entries(rule?.abbreviations ?? {})) {
    // Left boundary only: `s.` has to match at the start of a word, but its
    // own trailing dot is not a word character, so `\b` after it never fires.
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from.toLowerCase())}`, 'gu'), to.toLowerCase());
  }
  const drop = new Set((rule?.dropWords ?? []).map(word => word.toLowerCase()));
  return text.split(/\s+/).filter(token => token !== '' && !drop.has(token.replace(/[^\p{L}\p{N}&]/gu, ''))).join(' ');
}

/**
 * Collapse a value the way the tenant's own matcher does, then the way the
 * dedup key does, so the answer is comparable on both sides.
 * @param value - The printed value.
 * @param rule - The per-field normalise block, if the config declared one.
 */
export function normaliseForMatch(value: unknown, rule: NormaliseRule | undefined): string {
  return normaliseForKey(collapse(value, rule));
}

/**
 * `normaliseForMatch`, or undefined when no letter or digit is left to
 * compare: the dedup key spells nothing as `none`, which a list could hold.
 * @param value - The printed value.
 * @param rule - The per-field normalise block, if the config declared one.
 */
export function matchKeyOf(value: unknown, rule: NormaliseRule | undefined): string | undefined {
  const text = collapse(value, rule);
  return /[\p{L}\p{N}]/u.test(text) ? normaliseForKey(text) : undefined;
}
