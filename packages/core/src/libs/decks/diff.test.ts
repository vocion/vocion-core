import type { DeckSpec } from '@/libs/cards/specs';
import { describe, expect, it } from 'vitest';
import { diffDecks, diffDocuments, diffText, excerpt, isEmptyDiff } from './diff';

const s = (id: string, body: string, notes = 'n') => `<section id="${id}">${body}<aside>${notes}</aside></section>`;
const deck = (order: string[], slides: Record<string, string>, title = 'Larkfield Systems — rollout'): DeckSpec => ({ format: 'vocion-deck/1', title, order, slides });

describe('diffDecks', () => {
  const base = deck(['a', 'b', 'c', 'd'], { a: s('a', '<h1>Cover</h1>'), b: s('b', '<p>Four places</p>'), c: s('c', '<p>Plan</p>'), d: s('d', '<p>Ask</p>') });

  it('says nothing changed when nothing a reader sees did', () => {
    expect(isEmptyDiff(diffDecks(base, base))).toBe(true);
    expect(diffText(diffDecks(base, base))).toBe('No visible change.');
  });

  it('names added, removed, moved, rewritten, restyled and re-noted slides', () => {
    const after = deck(['a', 'c', 'b', 'e'], {
      a: s('a', '<h1 style="color:red">Cover</h1>'),
      b: s('b', '<p>Three places</p>'),
      c: s('c', '<p>Plan</p>', 'new notes'),
      e: s('e', '<p>Case study</p>'),
    }, 'Larkfield Systems — rollout v2');
    const d = diffDecks(base, after);

    expect(d.added.map(x => x.key)).toEqual(['e']);
    expect(d.removed.map(x => x.key)).toEqual(['d']);
    expect(d.moved.map(x => x.key)).toEqual(['b']);
    expect(d.textChanged).toEqual([expect.objectContaining({ key: 'b', before: 'Four places', after: 'Three places' })]);
    expect(d.restyled.map(x => x.key)).toEqual(['a']);
    expect(d.notesChanged.map(x => x.key)).toEqual(['c']);

    const text = diffText(d);

    expect(text).toContain('Title: "Larkfield Systems — rollout" → "Larkfield Systems — rollout v2"');
    expect(text).toContain('+ Slide 4 [e] (Case study) added');
    expect(text).toContain('- Slide 4 [d] (Ask) removed');
    expect(text).toContain('↕ Slide 3 [b]');
    expect(text).toContain('~ Slide 3 [b] (Three places): "Four places" → "Three places"');
  });
});

describe('excerpt', () => {
  it('shows the words around the first difference', () => {
    expect(excerpt('Orders live in four places today', 'Orders live in three places today')).toEqual({ before: 'Orders live in four places today', after: 'Orders live in three places today' });

    const long = 'x'.repeat(100);

    expect(excerpt(`${long} four ${long}`, `${long} three ${long}`).before.startsWith('…')).toBe(true);
  });
});

describe('diffDocuments', () => {
  it('compares sheets by position and names the ones whose words changed', () => {
    const doc = (a: string, b: string) => `<html><head><title>T</title></head><body><article class="sheet"><h1>${a}</h1></article><article class="sheet"><h2>${b}</h2></article></body></html>`;
    const d = diffDocuments(doc('Cover', 'Price'), doc('Cover', 'Pricing per role'));

    expect(d.unit).toBe('sheet');
    expect(d.textChanged.map(x => x.key)).toEqual(['2']);
    expect(diffText(d)).toContain('~ Sheet 2 (Pricing per role)');
  });
});
