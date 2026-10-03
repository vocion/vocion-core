import type { GlanceEffort } from './featureGlance';
import { describe, expect, it } from 'vitest';
import { builtLine, cardDescription, cardTitle, compactSpan, DEFAULT_BUILDER, glanceStats, headlineOf, timeSplit } from './featureGlance';

/**
 * A feature at a glance: one reading of how long it took and what it cost,
 * for the page's subhead and figures and for the line a pasted link unfurls
 * with. Fictional fixture (Northwind).
 */

const shipped: GlanceEffort = { duration: '1h 12m', until: 'seen live', attempts: 2, total: '$4.80' };

describe('a span, compact', () => {
  it('says minutes, hours and minutes, and days and hours', () => {
    expect(compactSpan(38 * 60_000)).toBe('38m');
    expect(compactSpan(72 * 60_000)).toBe('1h 12m');
    expect(compactSpan(120 * 60_000)).toBe('2h');
    expect(compactSpan(51 * 3_600_000)).toBe('2d 3h');
    expect(compactSpan(48 * 3_600_000)).toBe('2d');
  });

  it('never says 0m', () => {
    expect(compactSpan(20_000)).toBe('<1m');
    expect(compactSpan(-1)).toBeNull();
    expect(compactSpan(Number.NaN)).toBeNull();
  });
});

describe('the headline', () => {
  it('reads how long and the cost off the same figures the page shows', () => {
    expect(glanceStats(shipped).map(s => [s.key, s.value])).toEqual([['duration', '1h 12m'], ['attempts', '2'], ['cost', '$4.80']]);
    expect(headlineOf(shipped)).toEqual({ took: '1h 12m', cost: '$4.80', soFar: false });
    expect(builtLine(shipped)).toBe('Built in 1h 12m for $4.80');
    expect(builtLine(shipped, 'Northwind Studio')).toBe('Built by Northwind Studio in 1h 12m for $4.80');
  });

  it('leaves out whichever number is missing, and has nothing to say with neither', () => {
    expect(builtLine({ ...shipped, total: null })).toBe('Built in 1h 12m');
    expect(builtLine({ ...shipped, duration: null })).toBe('Built for $4.80');
    expect(builtLine({ ...shipped, total: '$0.00' })).toBe('Built in 1h 12m');
    expect(headlineOf({ ...shipped, duration: null, total: null })).toBeNull();
    expect(builtLine({ ...shipped, duration: null, total: null })).toBe('');
    expect(builtLine({ ...shipped, duration: null, total: null }, 'Northwind Studio')).toBe('Built by Northwind Studio');
  });

  it('says it is still being built while it is', () => {
    expect(builtLine({ duration: '3h 5m', until: 'so far', attempts: 1, total: '$1.20' }, 'Northwind Studio')).toBe('Being built by Northwind Studio · 3h 5m so far · $1.20');
  });
});

describe('the link\'s card', () => {
  it('leads the description with the builder, the time and the cost, under 200 characters', () => {
    expect(cardDescription(shipped, 'Northwind Studio', 'Library rows show when each file was uploaded.')).toBe('Built by Northwind Studio in 1h 12m for $4.80 · Library rows show when each file was uploaded.');

    const long = cardDescription(shipped, DEFAULT_BUILDER, `Library rows show ${'when each file was uploaded and by whom, '.repeat(10)}`);

    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.startsWith(`Built by ${DEFAULT_BUILDER} in 1h 12m for $4.80 · Library rows`)).toBe(true);
    expect(long.endsWith('…')).toBe(true);
  });

  it('puts the figures in the title when it stays under 70 characters', () => {
    expect(cardTitle('Sort the library by name or date', shipped)).toBe('Sort the library by name or date · 1h 12m · $4.80');
    expect(cardTitle('Sort the library by name, upload date or last opened first', shipped)).toBe('Sort the library by name, upload date or last opened first');
    expect(cardTitle('Sort the library', { ...shipped, total: null })).toBe('Sort the library · 1h 12m');
    expect(cardTitle('Sort the library', { ...shipped, until: 'so far' })).toBe('Sort the library');
  });
});

describe('where the time went', () => {
  it('counts each stretch to the step that ends it, and the parts add up', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 2, 7, 0) + m * 60_000).toISOString();
    const split = timeSplit([
      { at: at(0), phase: null }, // asked
      { at: at(2), phase: 'plan' }, // plan approved
      { at: at(40), phase: 'build' }, // built
      { at: at(50), phase: 'qa' }, // QA asked for changes
      { at: at(64), phase: 'build' }, // built again
      { at: at(70), phase: 'qa' }, // QA approved
      { at: at(71), phase: 'release' }, // merged
      { at: at(78), phase: 'release' }, // released
      { at: at(80), phase: 'live' }, // seen live
    ]);

    expect(split).toEqual([
      { label: 'Plan', amount: '2m' },
      { label: 'Build', amount: '52m' },
      { label: 'QA', amount: '16m' },
      { label: 'Release', amount: '8m' },
      { label: 'Live check', amount: '2m' },
    ]);
    expect(compactSpan(80 * 60_000)).toBe('1h 20m');
  });

  it('leaves out a phase that took no time', () => {
    expect(timeSplit([{ at: '2026-10-02T07:00:00Z', phase: null }, { at: '2026-10-02T07:30:00Z', phase: 'build' }])).toEqual([{ label: 'Build', amount: '30m' }]);
    expect(timeSplit([])).toEqual([]);
  });
});
