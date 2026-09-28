import { describe, expect, it } from 'vitest';
import { formatPassRate } from './formatPassRate';

describe('formatPassRate', () => {
  it('shows a rate just under the bar as under it, never rounded up onto it', () => {
    expect(formatPassRate(159 / 200)).toBe('79.5%');
    expect(formatPassRate(0.79999)).toBe('79.99%');
  });

  it('shows a rate exactly on the bar as the bar', () => {
    expect(formatPassRate(4 / 5)).toBe('80%');
  });

  it('keeps two decimals of a repeating rate without rounding it up', () => {
    expect(formatPassRate(2 / 3)).toBe('66.66%');
  });

  it('is not thrown off by float noise in the multiplication', () => {
    expect(formatPassRate(0.29)).toBe('29%');
    expect(formatPassRate(0.57)).toBe('57%');
    // An average can land a hair under the round number it means.
    expect(formatPassRate(0.3 - 0.1)).toBe('20%');
  });

  it('shows a value that is not a number as missing, never as "NaN%"', () => {
    expect(formatPassRate(Number.NaN)).toBe('—');
    expect(formatPassRate(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('shows the ends of the scale plainly', () => {
    expect(formatPassRate(0)).toBe('0%');
    expect(formatPassRate(1)).toBe('100%');
  });
});
