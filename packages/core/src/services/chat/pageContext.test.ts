import { describe, expect, it } from 'vitest';
import { readPageContext, withPageContext } from './pageContext';

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
