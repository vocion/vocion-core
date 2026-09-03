/**
 * "Sources" reads "connectors" everywhere a person can see it.
 *
 * The rename is front-end only, and this is the part of it a reviewer cannot
 * hold in their head: two locale files, and one stray "source" is enough to
 * make the dashboard contradict itself. So the wording is asserted rather than
 * eyeballed — in both languages, because French drifted from English here
 * before.
 *
 * Deliberately not asserted: "source material" in the search copy, and the
 * chat's "Sources" list of citations. Those are the ordinary English word for
 * where an answer came from, not the name of the connectors feature, and
 * renaming them would make the product worse rather than more consistent.
 */
import { describe, expect, it } from 'vitest';
import en from './en.json';
import fr from './fr.json';

/**
 * Every string value under `namespace`, paired with its key.
 * @param messages - One locale's message tree.
 * @param namespace - Top-level namespace to read.
 */
function entriesIn(messages: Record<string, unknown>, namespace: string): [string, string][] {
  const group = messages[namespace] as Record<string, unknown> | undefined;
  if (!group) {
    return [];
  }
  const found: [string, string][] = [];
  for (const [key, value] of Object.entries(group)) {
    if (typeof value === 'string') {
      found.push([key, value]);
    }
  }
  return found;
}

/** The word in each language, as it would appear inside a sentence. */
const WORD_FOR_SOURCE = { en: /\bsources?\b/i, fr: /\bsources?\b/i };

describe('the connectors namespace', () => {
  it('never says "source" in English', () => {
    const offenders = entriesIn(en, 'Connectors').filter(([, value]) => WORD_FOR_SOURCE.en.test(value));

    expect(offenders).toEqual([]);
  });

  it('never says "source" in French', () => {
    const offenders = entriesIn(fr, 'Connectors').filter(([, value]) => WORD_FOR_SOURCE.fr.test(value));

    expect(offenders).toEqual([]);
  });

  it('holds the same keys in both languages, so neither can drift ahead', () => {
    const english = entriesIn(en, 'Connectors').map(([key]) => key).sort();
    const french = entriesIn(fr, 'Connectors').map(([key]) => key).sort();

    expect(french).toEqual(english);
  });
});

describe('the nav item', () => {
  it('reads Connectors, not Sources', () => {
    // The key name stays `sources` — internal identifiers are unchanged, and
    // only the value is what anybody reads.
    expect(en.DashboardLayout.sources).toBe('Connectors');
    expect(fr.DashboardLayout.sources).toBe('Connecteurs');
  });
});

describe('copy that named the feature elsewhere', () => {
  it('calls a connector a connector on the objects pages', () => {
    expect(en.Objects.sources).toBe('connectors');
    expect(fr.Objects.sources).toBe('connecteurs');
    expect(en.Objects.title_bar_description).not.toMatch(/source/i);
    expect(fr.Objects.title_bar_description).not.toMatch(/source/i);
  });

  it('filters by connector, not by source', () => {
    expect(en.Search.coming_soon_features_2).toBe('Filter by connector, author, date, and tags');
    expect(fr.Search.coming_soon_features_2).toBe('Filtrer par connecteur, auteur, date et tags');
  });

  it('no longer offers to connect "a new source system"', () => {
    expect(en.DashboardIndex.action_add_connector_desc).not.toMatch(/source/i);
    expect(fr.DashboardIndex.action_add_connector_desc).not.toMatch(/source/i);
  });
});
