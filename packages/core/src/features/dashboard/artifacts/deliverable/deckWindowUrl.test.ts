import { describe, expect, it } from 'vitest';
import { deckWindowFeatures, deckWindowName, deckWindowPath, slideIndexFromParam } from './deckWindowUrl';

function features(s: string): Record<string, number | true> {
  return Object.fromEntries(s.split(',').map((part) => {
    const [k, v] = part.split('=');
    return [k!, v === undefined ? true : Number(v)];
  }));
}

describe('the deck window URL', () => {
  it('opens on the first slide without a parameter, and on any later slide with one', () => {
    expect(deckWindowPath(41)).toBe('/dashboard/artifacts/41/window');
    expect(deckWindowPath(41, 1)).toBe('/dashboard/artifacts/41/window');
    expect(deckWindowPath(41, 3)).toBe('/dashboard/artifacts/41/window?slide=3');
  });

  it('names one window per deck, so opening it again brings that window forward', () => {
    expect(deckWindowName(41)).toBe(deckWindowName(41));
    expect(deckWindowName(41)).not.toBe(deckWindowName(42));
  });

  it('reads ?slide= as a 1-based slide, clamped to the deck', () => {
    expect(slideIndexFromParam('3', 5)).toBe(2);
    expect(slideIndexFromParam(['2', '4'], 5)).toBe(1);
    expect(slideIndexFromParam('99', 5)).toBe(4);
    expect(slideIndexFromParam('0', 5)).toBe(0);
    expect(slideIndexFromParam('-2', 5)).toBe(0);
    expect(slideIndexFromParam('plan', 5)).toBe(0);
    expect(slideIndexFromParam(undefined, 5)).toBe(0);
    expect(slideIndexFromParam('3', 0)).toBe(0);
  });
});

describe('the deck window size', () => {
  it('is a popup whose slide area is 16:9, inside the screen, centred', () => {
    const screen = { availWidth: 1920, availHeight: 1080, availLeft: 0, availTop: 0 };
    const f = features(deckWindowFeatures(screen));

    expect(f.popup).toBe(true);

    const width = f.width as number;
    const height = f.height as number;

    // The controls bar (48px) sits under a 16:9 slide.
    expect(Math.abs((height - 48) - width * 9 / 16)).toBeLessThanOrEqual(1);
    expect(width).toBeLessThan(screen.availWidth);
    expect(height).toBeLessThan(screen.availHeight);
    expect(Math.abs((f.left as number) - (screen.availWidth - width) / 2)).toBeLessThanOrEqual(1);
  });

  it('is bounded by height on a wide screen and by width on a tall one', () => {
    const wide = features(deckWindowFeatures({ availWidth: 3440, availHeight: 1400 }));
    const tall = features(deckWindowFeatures({ availWidth: 1080, availHeight: 1920 }));

    expect(wide.height as number).toBeLessThanOrEqual(1400 * 0.8);
    expect(tall.width as number).toBeLessThanOrEqual(1080 * 0.8);
  });

  it('opens on the screen the person is on', () => {
    const f = features(deckWindowFeatures({ availWidth: 1920, availHeight: 1080, availLeft: 2560, availTop: 0 }));

    expect(f.left as number).toBeGreaterThanOrEqual(2560);
  });
});
