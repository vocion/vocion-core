import { describe, expect, it } from 'vitest';
import { applyListState, flipDirection, parseListState, toggleChip } from './listUrlState';

const CONFIG = {
  defaults: { tab: 'review', q: '', sort: 'arrived', dir: 'desc' as const, chips: [] as string[] },
  tabs: ['review', 'held', 'sent', 'all'],
  sorts: ['arrived', 'confidence', 'name'],
  chips: ['drop', 'generate', 'confirm'],
};

/** A list that also declares independent single-value dimensions (the Ledger's shape). */
const FACETED = {
  ...CONFIG,
  facets: { decision: ['discovery', 'not-discovery'], review: ['pending', 'corrected'] },
};

const NO_FACETS = { facets: {} };

describe('parseListState', () => {
  it('reads a clean URL as the defaults', () => {
    expect(parseListState('', CONFIG)).toEqual({ ...CONFIG.defaults, ...NO_FACETS });
    expect(parseListState('?', CONFIG)).toEqual({ ...CONFIG.defaults, ...NO_FACETS });
  });

  it('reads every parameter, with or without the leading ?', () => {
    const state = { tab: 'sent', q: 'meridian', sort: 'name', dir: 'asc' as const, chips: ['drop', 'confirm'], ...NO_FACETS };

    expect(parseListState('?tab=sent&q=meridian&sort=name&dir=asc&f=drop,confirm', CONFIG)).toEqual(state);
    expect(parseListState('tab=sent&q=meridian&sort=name&dir=asc&f=drop&f=confirm', CONFIG)).toEqual(state);
  });

  it('falls back to the defaults on values the list does not accept', () => {
    const state = parseListState('?tab=nope&sort=colour&dir=sideways&f=drop,unknown', CONFIG);

    expect(state.tab).toBe('review');
    expect(state.sort).toBe('arrived');
    expect(state.dir).toBe('desc');
    expect(state.chips).toEqual(['drop']);
  });

  it('accepts any value when the config lists none', () => {
    const open = { defaults: CONFIG.defaults };

    expect(parseListState('?tab=anything&f=x', open)).toMatchObject({ tab: 'anything', chips: ['x'] });
  });

  it('namespaces its parameters behind a prefix', () => {
    const prefixed = { ...CONFIG, prefix: 'ledger' };

    expect(parseListState('?tab=sent&ledger.tab=held', prefixed).tab).toBe('held');
  });
});

describe('applyListState', () => {
  it('writes nothing for the default state', () => {
    expect(applyListState('', CONFIG.defaults, CONFIG)).toBe('');
  });

  it('writes only what differs from the defaults, and removes what returned to them', () => {
    expect(applyListState('', { ...CONFIG.defaults, tab: 'sent', q: 'acme' }, CONFIG)).toBe('?tab=sent&q=acme');
    expect(applyListState('?tab=sent&q=acme', { ...CONFIG.defaults, q: 'acme' }, CONFIG)).toBe('?q=acme');
  });

  it('leaves parameters it does not own alone', () => {
    // Storybook's own params, a page's own params — untouched, in place.
    expect(applyListState('?id=patterns--list&viewMode=story', { ...CONFIG.defaults, tab: 'held' }, CONFIG))
      .toBe('?id=patterns--list&viewMode=story&tab=held');
  });

  it('writes chips sorted as one comma-joined parameter', () => {
    expect(applyListState('', { ...CONFIG.defaults, chips: ['generate', 'drop'] }, CONFIG)).toBe('?f=drop%2Cgenerate');
    expect(parseListState(applyListState('', { ...CONFIG.defaults, chips: ['generate', 'drop'] }, CONFIG), CONFIG).chips)
      .toEqual(['drop', 'generate']);
  });

  it('round-trips', () => {
    const state = { tab: 'all', q: 'jamie smith', sort: 'confidence', dir: 'asc' as const, chips: ['confirm'], ...NO_FACETS };

    expect(parseListState(applyListState('?x=1', state, CONFIG), CONFIG)).toEqual(state);
  });
});

describe('facets — independent single-value dimensions', () => {
  const base = { ...CONFIG.defaults, facets: { decision: '', review: '' } };

  it('defaults every declared facet to "all"', () => {
    expect(parseListState('', FACETED).facets).toEqual({ decision: '', review: '' });
  });

  it('reads each facet under its own parameter', () => {
    expect(parseListState('?decision=not-discovery&review=corrected', FACETED).facets)
      .toEqual({ decision: 'not-discovery', review: 'corrected' });
  });

  it('drops a value the facet does not accept rather than filtering on nonsense', () => {
    expect(parseListState('?decision=banana', FACETED).facets.decision).toBe('');
  });

  it('writes only the facets that are set, and clears one that returns to all', () => {
    expect(applyListState('', { ...base, facets: { decision: 'discovery', review: '' } }, FACETED))
      .toBe('?decision=discovery');
    expect(applyListState('?decision=discovery', { ...base, facets: { decision: '', review: '' } }, FACETED))
      .toBe('');
  });

  it('namespaces facets behind the prefix too', () => {
    const prefixed = { ...FACETED, prefix: 'ledger' };

    expect(parseListState('?decision=discovery&ledger.decision=uncertain', prefixed).facets.decision).toBe('');
    expect(parseListState('?ledger.decision=discovery', prefixed).facets.decision).toBe('discovery');
  });

  it('round-trips with the rest of the state', () => {
    const state = { ...base, tab: 'all', q: 'ranger', facets: { decision: 'not-discovery', review: 'corrected' } };

    expect(parseListState(applyListState('', state, FACETED), FACETED)).toEqual(state);
  });
});

describe('toggleChip / flipDirection', () => {
  it('adds a chip that is off and removes one that is on, keeping order', () => {
    expect(toggleChip([], 'drop')).toEqual(['drop']);
    expect(toggleChip(['drop', 'confirm'], 'generate')).toEqual(['drop', 'confirm', 'generate']);
    expect(toggleChip(['drop', 'confirm'], 'drop')).toEqual(['confirm']);
  });

  it('flips a direction', () => {
    expect(flipDirection('asc')).toBe('desc');
    expect(flipDirection('desc')).toBe('asc');
  });
});
