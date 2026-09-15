import { describe, expect, it } from 'vitest';
import { readContextRefs, readPageContext, withPageContext } from './pageContext';

describe('readPageContext', () => {
  it('accepts two short strings and trims them', () => {
    expect(readPageContext({ path: ' /dashboard/review ', title: ' Review ' })).toEqual({ path: '/dashboard/review', title: 'Review' });
  });

  it('reads anything malformed as no context, never as an error', () => {
    expect(readPageContext(undefined)).toBeNull();
    expect(readPageContext('x')).toBeNull();
    expect(readPageContext({ path: 42, title: 'Review' })).toBeNull();
    expect(readPageContext({ path: '   ', title: 'Review' })).toBeNull();
  });

  it('caps oversized values instead of rejecting them', () => {
    const ctx = readPageContext({ path: `/${'a'.repeat(500)}`, title: 'b'.repeat(500) });

    expect(ctx?.path).toHaveLength(200);
    expect(ctx?.title).toHaveLength(200);
  });
});

describe('withPageContext', () => {
  it('leaves a scoped or full-page message alone', () => {
    expect(withPageContext('what is waiting?', null)).toBe('what is waiting?');
  });

  it('adds where the person is, under the message, for the model only', () => {
    const out = withPageContext('what is waiting?', { path: '/dashboard/review', title: 'Review' });

    expect(out.startsWith('what is waiting?\n\n--- where I am ---')).toBe(true);
    expect(out).toContain('"Review" (/dashboard/review)');
  });

  it('falls back to the path when the title is empty', () => {
    expect(withPageContext('hi', { path: '/dashboard/review', title: '' })).toContain('looking at /dashboard/review in the app');
  });
});

describe('readContextRefs', () => {
  it('keeps well-formed tags, drops malformed ones, and caps the list', () => {
    const raw = [
      { type: 'team', id: 'revenue-ops', label: 'RevOps', routeTo: 'revenue-lead' },
      { type: 'mission', id: '  q3-pipeline ', label: 'Q3 pipeline' },
      { type: 'deal', id: '', label: 'nothing' },
      'not a ref',
      null,
      ...Array.from({ length: 20 }, (_, i) => ({ type: 'object', id: String(i), label: `o${i}` })),
    ];

    const refs = readContextRefs(raw);

    expect(refs[0]).toEqual({ type: 'team', id: 'revenue-ops', label: 'RevOps' });
    expect(refs[1]).toEqual({ type: 'mission', id: 'q3-pipeline', label: 'Q3 pipeline' });
    expect(refs).toHaveLength(12);
  });

  it('reads anything that is not an array as no tags', () => {
    expect(readContextRefs(undefined)).toEqual([]);
    expect(readContextRefs({ type: 'team' })).toEqual([]);
  });
});

describe('withPageContext with tagged records', () => {
  it('lists the tagged records under the message so an @tag reaches the model, not only the router', () => {
    const out = withPageContext('what is blocking?', null, [{ type: 'team', id: 'revenue-ops', label: 'RevOps' }]);

    expect(out.startsWith('what is blocking?')).toBe(true);
    expect(out).toContain('--- records I tagged ---');
    expect(out).toContain('- team "RevOps" (team:revenue-ops)');
  });

  it('stacks the page note and the tags note in that order', () => {
    const out = withPageContext('hi', { path: '/dashboard/review', title: 'Review' }, [{ type: 'deal', id: '9', label: '' }]);

    expect(out.indexOf('--- where I am ---')).toBeLessThan(out.indexOf('--- records I tagged ---'));
    expect(out).toContain('- deal "9" (deal:9)');
  });
});
