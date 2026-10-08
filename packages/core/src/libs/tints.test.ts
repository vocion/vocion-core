import { describe, expect, it } from 'vitest';
import { defaultTint, isTint, resolveTint, TINTS } from './tints';

describe('tints', () => {
  it('knows its six names', () => {
    expect(TINTS).toEqual(['violet', 'sky', 'mint', 'peach', 'butter', 'rose']);
    expect(isTint('mint')).toBe(true);
    expect(isTint('teal')).toBe(false);
    expect(isTint(undefined)).toBe(false);
  });

  it('gives an id the same tint every time', () => {
    expect(defaultTint('gtm')).toBe(defaultTint('gtm'));
    expect(TINTS).toContain(defaultTint('a-new-app'));
  });

  it('prefers the authored tint and falls back to the id when it names none or an unknown one', () => {
    expect(resolveTint('rose', 'gtm')).toBe('rose');
    expect(resolveTint(undefined, 'gtm')).toBe(defaultTint('gtm'));
    expect(resolveTint('chartreuse', 'gtm')).toBe(defaultTint('gtm'));
  });
});
