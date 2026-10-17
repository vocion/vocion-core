import { describe, expect, it } from 'vitest';
import { niceTicks } from './chart';

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
