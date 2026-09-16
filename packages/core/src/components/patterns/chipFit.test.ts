import { describe, expect, it } from 'vitest';
import { arrangeChips, fitChips } from './chipFit';

describe('fitChips', () => {
  it('shows every chip when they all fit, with no room reserved for "+N more"', () => {
    expect(fitChips([100, 100, 100], 320, 60, 8)).toBe(3); // 100+8+100+8+100 = 316
  });

  it('reserves room for the "+N more" control once something has to hide', () => {
    // 4 chips of 100 with gap 8 need 424; in 320 only the first two fit beside a 60px "+2 more" (100+8+100+8+60 = 276; a third would need 384).
    expect(fitChips([100, 100, 100, 100], 320, 60, 8)).toBe(2);
  });

  it('shows nothing but the control when even one chip would not fit beside it', () => {
    expect(fitChips([300, 300], 320, 60, 8)).toBe(0);
  });

  it('handles an empty row', () => {
    expect(fitChips([], 320, 60, 8)).toBe(0);
  });
});

describe('arrangeChips', () => {
  it('lays out pinned first, active next, the rest after, each in its given order', () => {
    const chips = [
      { key: 'c', active: false },
      { key: 'all', active: false, pinned: true },
      { key: 'b', active: true },
      { key: 'a', active: false },
      { key: 'd', active: true },
    ];

    expect(arrangeChips(chips).map(c => c.key)).toEqual(['all', 'b', 'd', 'c', 'a']);
  });
});
