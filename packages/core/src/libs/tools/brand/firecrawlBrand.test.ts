import { describe, expect, it } from 'vitest';

/**
 * The decisions inside a brand lookup, without spending a Firecrawl credit.
 *
 * Two of them matter. A bare domain must NOT be searched for — searching
 * "northwindhealth.com official site" can rank a directory listing above the
 * company itself, and the answer was already in the input. And an absent field
 * must stay absent: a brand lookup exists so a proposal stops inventing a
 * company's colours, so a guessed value is worse than a gap.
 */

/**
 * The bare-domain test the lookup uses to skip search.
 * @param q
 */
const bareDomain = (q: string) => /^(?:https?:\/\/)?((?:[\w-]+\.)+[a-z]{2,})(?:\/|$)/i.exec(q.trim())?.[1];

/**
 * The hex normaliser.
 * @param value
 */
function hex(value: unknown): string | undefined {
  const s = typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  const m = s ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s) : null;
  if (!m) {
    return undefined;
  }
  const raw = m[1]!.toLowerCase();
  return `#${raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw}`;
}

describe('resolving what to look up', () => {
  it('treats a bare domain as the answer rather than a search term', () => {
    expect(bareDomain('northwindhealth.com')).toBe('northwindhealth.com');
    expect(bareDomain('https://northwindhealth.com/about')).toBe('northwindhealth.com');
  });

  it('searches when given a name, because a name is not a domain', () => {
    expect(bareDomain('Northwind Health')).toBeUndefined();
    expect(bareDomain('the health insurer we met last week')).toBeUndefined();
  });
});

describe('brand colours', () => {
  it('normalises to six-digit lowercase hex, so two sites compare', () => {
    expect(hex('#58235D')).toBe('#58235d');
    expect(hex('58235D')).toBe('#58235d');
    expect(hex('#ABC')).toBe('#aabbcc');
  });

  it('drops anything that is not a colour rather than passing it through', () => {
    expect(hex('rebeccapurple')).toBeUndefined();
    expect(hex('rgb(88,35,93)')).toBeUndefined();
    expect(hex(null)).toBeUndefined();
    expect(hex('')).toBeUndefined();
  });
});
