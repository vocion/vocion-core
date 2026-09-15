import { describe, expect, it } from 'vitest';
import { clampRailWidth, defaultRailWidth, RAIL_MIN_WIDTH } from './railState';

describe('rail width', () => {
  it('opens at a third of the viewport, never under 384px', () => {
    expect(defaultRailWidth(1440)).toBe(480);
    expect(defaultRailWidth(1000)).toBe(384);
  });

  it('clamps to [320px, 50vw]', () => {
    expect(clampRailWidth(100, 1440)).toBe(RAIL_MIN_WIDTH);
    expect(clampRailWidth(2000, 1440)).toBe(720);
    expect(clampRailWidth(500.4, 1440)).toBe(500);
    expect(clampRailWidth(Number.NaN, 1440)).toBe(480);
  });
});
