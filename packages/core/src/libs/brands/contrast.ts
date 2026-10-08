/**
 * Whether a brand's own colour is legible on the tile it sits on.
 *
 * A logo is a graphic, so the bar is WCAG 2.2 AA for non-text contrast
 * (1.4.11): 3:1 against the colour next to it. A brand colour that clears it
 * on the tile is drawn in that colour; one that does not is drawn in the
 * tile's ink instead, so a near-black mark (GitHub, Notion) goes light in dark
 * mode and a pale one goes dark in light mode rather than disappearing.
 */

/** WCAG 2.2 AA minimum for a graphic against its neighbour (1.4.11). */
export const NON_TEXT_AA = 3;

/**
 * The surface a logo tile is drawn on, in each theme: `--card` in
 * `src/styles/global.css` (`oklch(1 0 0)` light, `#1c1a20` dark).
 * `contrast.test.ts` reads the stylesheet so the two cannot drift.
 */
export const TILE_SURFACE = { light: '#ffffff', dark: '#1c1a20' } as const;

/**
 * The relative luminance of an sRGB colour, per WCAG 2.2.
 * @param hex - `#rrggbb` or `rrggbb`.
 */
export function relativeLuminance(hex: string): number {
  const value = hex.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`not a six-digit hex colour: ${hex}`);
  }
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(value.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG contrast ratio between two colours, from 1 to 21.
 * @param a - A `#rrggbb` colour.
 * @param b - Another.
 */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** How a mark is filled in each theme: its brand colour, or null for the tile's ink. */
export type MarkFills = { light: string | null; dark: string | null };

/**
 * The brand colour in each theme where it clears {@link NON_TEXT_AA} on the
 * tile, and null (draw in ink) where it does not.
 * @param hex - The brand colour, `#rrggbb` or `rrggbb`.
 */
export function markFills(hex: string): MarkFills {
  const colour = `#${hex.replace(/^#/, '').toLowerCase()}`;
  return {
    light: contrastRatio(colour, TILE_SURFACE.light) >= NON_TEXT_AA ? colour : null,
    dark: contrastRatio(colour, TILE_SURFACE.dark) >= NON_TEXT_AA ? colour : null,
  };
}
