import { describe, expect, it } from 'vitest';
import { reviewRedirectTarget } from './reviewRedirect';

/**
 * `/dashboard/review` forwards to the proposal kind of Review queue, carrying
 * the old `?type=` filter as `?actionKind=`.
 */
describe('reviewRedirectTarget', () => {
  it('lands on the proposal kind', () => {
    expect(reviewRedirectTarget()).toBe('/dashboard/inbox?kind=proposal');
    expect(reviewRedirectTarget({})).toBe('/dashboard/inbox?kind=proposal');
  });

  it('carries ?type= over as ?actionKind=, repeated or comma-joined, de-duplicated', () => {
    expect(reviewRedirectTarget({ type: 'hubspot.update' })).toBe('/dashboard/inbox?kind=proposal&actionKind=hubspot.update');
    expect(reviewRedirectTarget({ type: ['hubspot.update', 'gmail.send'] })).toBe('/dashboard/inbox?kind=proposal&actionKind=hubspot.update%2Cgmail.send');
    expect(reviewRedirectTarget({ type: 'a,b, a' })).toBe('/dashboard/inbox?kind=proposal&actionKind=a%2Cb');
  });

  it('ignores anything else the old page never understood', () => {
    expect(reviewRedirectTarget({ filter: 'pending', type: '' })).toBe('/dashboard/inbox?kind=proposal');
  });
});
