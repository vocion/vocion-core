import { describe, expect, it } from 'vitest';
import { formatScore, NOT_ENOUGH_DATA } from './formatScore';

describe('formatScore', () => {
  it('shows a missing agreement rate as "Not enough data", never 0%', () => {
    expect(formatScore(null)).toBe(NOT_ENOUGH_DATA);
    expect(formatScore(null)).not.toContain('0');
  });

  it('still shows a real zero as 0% — an agent that was always overruled is not "no data"', () => {
    expect(formatScore(0)).toBe('0%');
  });

  it('rounds a rate to a whole percentage', () => {
    expect(formatScore(0.666)).toBe('67%');
    expect(formatScore(1)).toBe('100%');
  });

  it('treats a non-number (a 0 ÷ 0 that slipped through) as no data', () => {
    expect(formatScore(Number.NaN)).toBe(NOT_ENOUGH_DATA);
  });
});
