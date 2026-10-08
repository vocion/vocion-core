import { describe, expect, it } from 'vitest';
import { AA_TEXT, accentTokens, colorDistance, contrastRatio, foregroundFor, normalizeHex, parseHex, THEME_INK, THEME_SURFACES, worstContrast } from './contrast';

/**
 * An Org's accent is worn two ways — as a fill with text on it, and as ink on
 * the page — and each must reach WCAG AA (4.5:1) in both themes. A colour
 * that does is used as it is; one that does not is moved to the nearest shade
 * that does, and says so; one whose nearest readable shade is a different
 * colour is refused with the reason.
 */

describe('colour arithmetic', () => {
  it('reads hex in every length and refuses what is not one', () => {
    expect(parseHex('#fff')).toMatchObject({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseHex('#0E8C7F80')?.a).toBeCloseTo(0.5, 1);
    expect(parseHex('teal')).toBeNull();
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#0e8c7f80')).toBeNull();
  });

  it('computes WCAG contrast the way the spec does', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });

  it('always finds text that reads on a fill', () => {
    for (const fill of ['#0e8c7f', '#f18700', '#7c3cff', '#ffff00', '#000000', '#ffffff', '#808080', '#e11d48']) {
      expect(contrastRatio(fill, foregroundFor(fill))).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('accentTokens', () => {
  it('uses a colour that already reads as it is', () => {
    const t = accentTokens('#7C3CFF');

    expect(t.ok).toBe(true);

    if (!t.ok) {
      return;
    }

    expect(t.fill).toBe('#7c3cff');
    expect(t.light).toMatchObject({ ink: '#7c3cff', adjusted: false });
  });

  it('adjusts a colour too light for light pages, keeps its hue, and says what it did', () => {
    const t = accentTokens('#F18700');

    expect(t.ok).toBe(true);

    if (!t.ok) {
      return;
    }

    // The fill stays the brand colour; only the ink on the page moves.
    expect(t.fill).toBe('#f18700');
    expect(t.light.adjusted).toBe(true);
    expect(worstContrast(t.light.ink, THEME_SURFACES.light)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(colorDistance('#f18700', t.light.ink)).toBeLessThan(0.36);
    expect(t.dark).toMatchObject({ ink: '#f18700', adjusted: false });
    expect(t.notes.join(' ')).toMatch(/On light pages, links and focus use #[0-9A-F]{6} \(4\.\d:1\) because #F18700 is too light/);
  });

  it('refuses a colour whose nearest readable shade is a different colour, with the reason', () => {
    for (const hex of ['#FFFF00', '#FFE8D9']) {
      const t = accentTokens(hex);

      expect(t.ok).toBe(false);

      if (t.ok) {
        return;
      }

      expect(t.reason).toContain(hex.toUpperCase());
      expect(t.reason).toMatch(/contrast on light pages/);
      expect(t.reason).toContain('Pick a deeper shade of it.');
    }
  });

  it('refuses what is not a solid colour', () => {
    expect(accentTokens('blue')).toMatchObject({ ok: false, reason: expect.stringContaining('is not a colour') });
    expect(accentTokens('#0e8c7f80')).toMatchObject({ ok: false, reason: expect.stringContaining('see-through') });
  });

  it('a black or white brand reads as the page\'s own ink where it does not fit, never refused', () => {
    const black = accentTokens('#000000');
    const white = accentTokens('#ffffff');

    expect(black.ok && black.light.ink).toBe('#000000');
    expect(black.ok && black.dark.ink).toBe(THEME_INK.dark);
    expect(white.ok && white.light.ink).toBe(THEME_INK.light);
    expect(white.ok && white.dark.ink).toBe('#ffffff');
  });

  it('whatever it accepts reads at AA on every surface of both themes', () => {
    for (const hex of ['#0E8C7F', '#F18700', '#FFC400', '#00FF00', '#E11D48', '#1F353F', '#65AC98', '#43A5C2', '#FFB6C1', '#808080']) {
      const t = accentTokens(hex);
      if (!t.ok) {
        continue;
      }
      for (const theme of ['light', 'dark'] as const) {
        expect(worstContrast(t[theme].ink, THEME_SURFACES[theme])).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(t[theme].ink, t[theme].inkForeground)).toBeGreaterThanOrEqual(AA_TEXT);
      }

      expect(contrastRatio(t.fill, t.foreground)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
