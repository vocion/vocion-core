import { describe, expect, it } from 'vitest';
import { clampHeight, FULL_GAP, nextSnap, PEEK_HEIGHT, resolveSnap, snapHeights } from './drawerSnap';

/** Chris, 2026-10-24: "I can't drag drawer full height." */
describe('where the phone drawer rests', () => {
  const h = snapHeights(800);

  it('rests folded, at half, and at the full height under a small gap', () => {
    expect(h.peek).toBe(PEEK_HEIGHT);
    expect(h.half).toBe(560);
    expect(h.full).toBe(800 - FULL_GAP);
  });

  it('settles a slow drag on the nearest rest', () => {
    expect(resolveSnap(700, 0, h)).toBe('full');
    expect(resolveSnap(500, 0, h)).toBe('half');
    expect(resolveSnap(120, 0, h)).toBe('peek');
  });

  it('carries a flick past the nearest rest, either way', () => {
    // Let go just above half, moving up fast: it was heading for full.
    expect(resolveSnap(520, -1.5, h)).toBe('full');
    // Let go just below full, moving down fast: half, not full.
    expect(resolveSnap(740, 1.6, h)).toBe('half');
    // From half, a hard flick down folds it.
    expect(resolveSnap(420, 2.5, h)).toBe('peek');
  });

  it('steps the handle half → full → folded → half', () => {
    expect(nextSnap('half')).toBe('full');
    expect(nextSnap('full')).toBe('peek');
    expect(nextSnap('peek')).toBe('half');
  });

  it('never drags past the bar or the top', () => {
    expect(clampHeight(10, h)).toBe(PEEK_HEIGHT);
    expect(clampHeight(5000, h)).toBe(h.full);
  });

  it('keeps half no taller than full on a short host', () => {
    const short = snapHeights(60);

    expect(short.half).toBeLessThanOrEqual(short.full);
  });
});
