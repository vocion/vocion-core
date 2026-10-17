import { describe, expect, it } from 'vitest';
import { niceTicks, trendLine } from './chart';

describe('the trend line', () => {
  it('fits a straight line through the values', () => {
    expect(trendLine([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(trendLine([4, 4, 4])).toEqual([4, 4, 4]);
  });

  it('skips a missing value rather than reading it as zero', () => {
    expect(trendLine([2, null, 6])).toEqual([2, 4, 6]);
  });

  it('draws nothing with fewer than two points', () => {
    expect(trendLine([5])).toBeNull();
    expect(trendLine([null, 3])).toBeNull();
  });
});

describe('the chart\'s y axis', () => {
  it('ends at or above the largest value, so no bar rises past it', () => {
    expect(niceTicks(17)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(565_000).at(-1)).toBeGreaterThanOrEqual(565_000);
  });

  it('stops at a round max without adding a tick above it', () => {
    expect(niceTicks(30)).toEqual([0, 10, 20, 30]);
  });

  it('draws a single baseline when there is nothing to scale', () => {
    expect(niceTicks(0)).toEqual([0]);
  });
});
