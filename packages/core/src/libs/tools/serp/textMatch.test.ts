import { describe, expect, it } from 'vitest';
import { clusterHeadings, headingsMatch, jaccard, sharedTerms, shingles, stem, words } from './textMatch';

describe('stem', () => {
  it('folds the forms a heading or a page uses for one word', () => {
    expect(['tests', 'tested', 'testing'].map(stem)).toEqual(['test', 'test', 'test']);
    expect(['heaters', 'repairs', 'boxes', 'companies'].map(stem)).toEqual(['heater', 'repair', 'box', 'company']);
    expect(['installation', 'installing', 'install'].map(stem)).toEqual(['install', 'install', 'install']);
    expect(['process', 'status', 'analysis'].map(stem)).toEqual(['process', 'status', 'analysis']);
  });

  it('reads words with case, accents, possessives and punctuation gone', () => {
    expect(words('Fairview\'s Best: Café-Grade Repairs!')).toEqual(['fairview', 'best', 'cafe', 'grade', 'repairs']);
  });
});

describe('headingsMatch', () => {
  it('matches the same heading written two ways', () => {
    expect(headingsMatch('How We Tested!', 'how we tested')).toBe(true);
    expect(headingsMatch('How we tested', 'Our testing process')).toBe(true);
    expect(headingsMatch('Water heater installation cost', '2. Cost of installing a water heater')).toBe(true);
  });

  it('does not match headings that only share a word', () => {
    expect(headingsMatch('Cost', 'Water heater installation cost')).toBe(false);
    expect(headingsMatch('Tankless water heaters', 'Signs your furnace needs repair')).toBe(false);
  });
});

describe('clusterHeadings', () => {
  it('groups loose matches across pages, names each by its most used wording, and keeps only what two pages share', () => {
    const clusters = clusterHeadings([
      { position: 1, headings: ['How we tested', 'Sizing tips'] },
      { position: 2, headings: ['How We Tested!', 'Our pick'] },
      { position: 4, headings: ['Our testing process', '1. Sizing tip'] },
    ]);

    expect(clusters).toEqual([
      { heading: 'How we tested', positions: [1, 2, 4], variants: ['How we tested', 'How We Tested!', 'Our testing process'] },
      { heading: 'Sizing tips', positions: [1, 4], variants: ['Sizing tips', 'Sizing tip'] },
    ]);
  });
});

describe('sharedTerms', () => {
  const pages = [
    { position: 1, text: 'A tankless water heater needs a yearly flush. Anode rods wear out. Call for a free estimate.' },
    { position: 2, text: 'Flushing a tankless water heater every year removes sediment. Replace the anode rod.' },
    { position: 4, text: 'Sediment builds up in a tankless water heater; an anode rod protects the tank.' },
    { position: 5, text: 'We service furnaces only.' },
  ];

  it('lists terms three or more pages use, with which pages, longest wording when it covers the same pages', () => {
    const terms = sharedTerms(pages, { exclude: 'water heater repair' });
    const byTerm = new Map(terms.map(t => [t.term, t.positions]));

    expect(byTerm.get('tankless water heater')).toEqual([1, 2, 4]);
    expect(byTerm.get('anode rod')).toEqual([1, 2, 4]);
    // "tankless" alone is used by exactly the pages that use the longer term.
    expect(byTerm.has('tankless')).toBe(false);
    // The query's own words say nothing on their own.
    expect(byTerm.has('water heater')).toBe(false);
    // Two pages are not "the top pages".
    expect([...byTerm.keys()].some(t => t.includes('sediment'))).toBe(false);
    expect(terms.find(t => t.term === 'anode rod')!.mentions).toBe(3);
  });

  it('needs at least the minimum number of pages', () => {
    expect(sharedTerms(pages.slice(0, 2))).toEqual([]);
  });
});

describe('shingles and jaccard', () => {
  it('compare runs of five words', () => {
    const a = shingles('one two three four five six');
    const b = shingles('one two three four five seven');

    expect([...a]).toEqual(['one two three four five', 'two three four five six']);
    expect(jaccard(a, b)).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});
