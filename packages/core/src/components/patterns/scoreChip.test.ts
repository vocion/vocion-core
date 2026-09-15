import { describe, expect, it } from 'vitest';
import { formatScore, scorePercent, scoreVerdict } from './scoreChip';

describe('scoreVerdict', () => {
  it('passes at or above the threshold — the router\'s own inequality', () => {
    expect(scoreVerdict(0.95, 0.8)).toBe('pass');
    expect(scoreVerdict(0.8, 0.8)).toBe('pass');
  });

  it('fails below it', () => {
    expect(scoreVerdict(0.79, 0.8)).toBe('fail');
    expect(scoreVerdict(0, 0.5)).toBe('fail');
  });

  it('has no verdict without a threshold to read against', () => {
    expect(scoreVerdict(0.95, undefined)).toBe('none');
    expect(scoreVerdict(0.95, null)).toBe('none');
    expect(scoreVerdict(0.95, Number.NaN)).toBe('none');
  });
});

describe('formatScore / scorePercent', () => {
  it('renders two decimals, clamped to the unit interval', () => {
    expect(formatScore(0.9)).toBe('0.90');
    expect(formatScore(0.4249)).toBe('0.42');
    expect(formatScore(1.7)).toBe('1.00');
    expect(formatScore(-0.2)).toBe('0.00');
  });

  it('gives the meter a clamped whole percentage', () => {
    expect(scorePercent(0.425)).toBe(43);
    expect(scorePercent(2)).toBe(100);
    expect(scorePercent(-1)).toBe(0);
  });
});
