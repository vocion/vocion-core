import { describe, expect, it } from 'vitest';
import { shortDateTime } from './leadFormat';

describe('shortDateTime', () => {
  it('writes the same text in every engine, so a server render matches the browser', () => {
    // Safari's Intl joins date and time with "at"; Node and Chromium use a
    // comma. The string is assembled from parts, so it never depends on that.
    expect(shortDateTime('2026-09-03T17:47:00Z')).toBe('Sep 3, 5:47 PM UTC');
    expect(shortDateTime('2026-09-03T09:05:00Z')).toBe('Sep 3, 9:05 AM UTC');
  });

  it('hands back input it cannot read', () => {
    expect(shortDateTime('not a date')).toBe('not a date');
  });
});
