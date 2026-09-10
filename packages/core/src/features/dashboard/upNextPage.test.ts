import { describe, expect, it } from 'vitest';
import { upNextPage } from './upNextPage';

describe('upNextPage', () => {
  it('shows eight first, then fifty more per click, until none remain', () => {
    expect(upNextPage(149, 0)).toEqual({ shown: 8, remaining: 141 });
    expect(upNextPage(149, 1)).toEqual({ shown: 58, remaining: 91 });
    expect(upNextPage(149, 2)).toEqual({ shown: 108, remaining: 41 });
    expect(upNextPage(149, 3)).toEqual({ shown: 149, remaining: 0 });
  });

  it('never shows more than there are', () => {
    expect(upNextPage(3, 0)).toEqual({ shown: 3, remaining: 0 });
    expect(upNextPage(0, 5)).toEqual({ shown: 0, remaining: 0 });
  });
});
