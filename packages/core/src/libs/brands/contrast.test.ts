import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, markFills, NON_TEXT_AA, relativeLuminance, TILE_SURFACE } from './contrast';

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#4285f4', '#4285f4')).toBeCloseTo(1, 5);
  });

  it('does not care which colour comes first', () => {
    expect(contrastRatio('#ff7a59', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#ff7a59'), 10);
  });

  it('rejects a colour that is not six hex digits', () => {
    expect(() => relativeLuminance('#fff')).toThrow(/six-digit/);
  });
});

describe('markFills', () => {
  it('keeps a near-black brand colour in light mode and draws it in ink in dark mode', () => {
    expect(markFills('181717')).toEqual({ light: '#181717', dark: null });
  });

  it('draws a pale brand colour in ink on the white tile and keeps it on the dark one', () => {
    // An orange like this one clears 3:1 against the dark tile but not against white.
    expect(contrastRatio('#ff7a59', TILE_SURFACE.light)).toBeLessThan(NON_TEXT_AA);
    expect(markFills('#FF7A59')).toEqual({ light: null, dark: '#ff7a59' });
  });

  it('keeps a mid-tone brand colour that clears 3:1 in both themes', () => {
    expect(markFills('0b5cff')).toEqual({ light: '#0b5cff', dark: '#0b5cff' });
  });
});

describe('TILE_SURFACE', () => {
  // The fills are judged against these; if the stylesheet's `--card` moves, so
  // must they, or a mark that passed here fails on the page.
  const css = readFileSync(join(import.meta.dirname, '../../styles/global.css'), 'utf8');

  /**
   * The value `--card` takes inside a block of the stylesheet.
   * @param selector - The block's selector, e.g. `:root`.
   */
  function cardIn(selector: string): string {
    const block = css.slice(css.indexOf(`${selector} {`));
    const match = /--card:\s*([^;\s][^;]*);/.exec(block.slice(0, block.indexOf('}')));
    if (!match) {
      throw new Error(`no --card in ${selector}`);
    }
    return match[1]!.trim();
  }

  it('matches --card in light mode', () => {
    // `oklch(1 0 0)` is pure white.
    expect(cardIn(':root')).toBe('oklch(1 0 0)');
    expect(TILE_SURFACE.light).toBe('#ffffff');
  });

  it('matches --card in dark mode', () => {
    expect(cardIn('.dark').toLowerCase()).toBe(TILE_SURFACE.dark);
  });
});
