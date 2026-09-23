import { describe, expect, it } from 'vitest';
import { defaultSortFor, mergeSearch } from './searchParams';

/**
 * The bug this exists to prevent: a filter that appears in the URL and then
 * reverts a third of a second later, because a debounced write rebuilt the URL
 * from a snapshot taken before the filter was chosen.
 */
describe('mergeSearch', () => {
  it('keeps a filter that was added after the write was scheduled', () => {
    // The debounce closed over "?tab=open". By the time it fires the person has
    // also picked a type. Merging against the CURRENT string keeps both.
    const current = 'tab=open&actionKind=hubspot.update';

    expect(mergeSearch(current, { q: '' })).toBe('tab=open&actionKind=hubspot.update');
  });

  it('removes a key for null and for empty string, and sets it otherwise', () => {
    expect(mergeSearch('q=acme&kind=proposal', { q: null })).toBe('kind=proposal');
    expect(mergeSearch('q=acme&kind=proposal', { q: '' })).toBe('kind=proposal');
    expect(mergeSearch('kind=proposal', { q: 'acme' })).toBe('kind=proposal&q=acme');
  });

  it('writes several dimensions in one go, which is how a token selection lands', () => {
    expect(mergeSearch('tab=open', { kind: 'proposal', actionKind: 'gmail.send', agents: null }))
      .toBe('tab=open&kind=proposal&actionKind=gmail.send');
  });

  it('replaces rather than appends, so toggling a value twice is not two values', () => {
    expect(mergeSearch('kind=proposal', { kind: 'learning' })).toBe('kind=learning');
  });
});

describe('defaultSortFor', () => {
  it('reads a queue oldest first and a record of decisions newest first', () => {
    expect(defaultSortFor('open')).toBe('oldest');
    expect(defaultSortFor('snoozed')).toBe('oldest');
    expect(defaultSortFor('decided')).toBe('newest');
  });

  it('is what the controls leave out of the URL, so choosing the other order always writes it', () => {
    // The open queue defaults to oldest; picking newest must land in the URL.
    const chosen = 'newest';

    expect(chosen === defaultSortFor('open') ? null : chosen).toBe('newest');
    // And on decided, picking oldest must land too.
    expect(defaultSortFor('decided') === 'oldest' ? null : 'oldest').toBe('oldest');
  });
});
