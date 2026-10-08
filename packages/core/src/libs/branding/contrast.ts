/**
 * AN ACCENT THAT STAYS READABLE — the arithmetic behind an Org's brand colour.
 *
 * An Org picks one accent. The app uses it two ways, and each has its own bar
 * (WCAG 2.2 AA):
 *
 * - **As a fill** (the sign-in button, a filled badge): the brand colour as
 *   given, with text on it. The text colour is derived — white or ink,
 *   whichever reads better — and has to reach 4.5:1 against the fill.
 * - **As ink on a surface** (links, the focus ring, the sidebar's mark of the
 *   current page): text-sized, so it has to reach 4.5:1 against every surface
 *   the theme paints, light and dark, separately.
 *
 * When the brand colour already reaches the bar it is used as it is. When it
 * does not, the ink is the nearest shade that does — same hue, lightness moved
 * just far enough — and the result says so in a sentence a person reads. An
 * accent with no hue (black, white, a grey) takes the page's own ink in the
 * theme it does not fit: a black brand reads white on a dark page, which is
 * what a monochrome brand means.
 *
 * Refused, with the reason, only when no shade would still be that colour: a
 * pale tint whose nearest readable shade is a different colour altogether, or
 * a colour that is not solid. "I can't make this work, pick a deeper shade"
 * beats a silently different brand.
 *
 * Pure: no DOM, no fetch. Colour space conversions are the published OKLab
 * matrices (Björn Ottosson, 2020) over linear sRGB.
 */

export type Rgb = { r: number; g: number; b: number };
export type ThemeName = 'light' | 'dark';

/** Text on a fill, and accent ink on a surface: AA for normal-size text. */
export const AA_TEXT = 4.5;

/**
 * The surfaces each theme paints that an accent sits on — the page, a card,
 * the sidebar — from `styles/global.css`. An accent is checked against all of
 * them and must clear the bar on the worst.
 */
export const THEME_SURFACES: Record<ThemeName, readonly string[]> = {
  light: ['#fcfaf6', '#ffffff', '#f9f7f3'],
  dark: ['#141217', '#1c1a20', '#1a181e'],
};

/** The page's own ink per theme (`--ink`), what an achromatic accent becomes where it does not fit. */
export const THEME_INK: Record<ThemeName, string> = { light: '#15131a', dark: '#f4f1ec' };

/** Text on a fill: white, or near-black (the dark theme's background; never pure black, which reads harsh). */
export const ON_FILL_LIGHT = '#ffffff';
export const ON_FILL_DARK = '#141217';

/**
 * How far (OKLab distance) a shade may move from the brand colour and still be
 * called the same colour. Measured on light pages: an orange or a teal
 * darkened to reach 4.5:1 moves 0.13–0.2, an amber or a saturated green about
 * 0.3–0.35 and still reads as itself; pure yellow (0.43) comes out olive and a
 * near-white peach (0.39) comes out brown-grey.
 */
export const MAX_SHIFT = 0.36;

/** Below this OKLCH chroma a colour reads as grey: no hue to keep. */
const ACHROMATIC_CHROMA = 0.03;

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `#abc`, `#aabbcc`, `#aabbccdd` → channels 0..1 and alpha; null when it is not a hex colour.
 * @param hex - The colour as typed.
 */
export function parseHex(hex: string): (Rgb & { a: number }) | null {
  const s = hex.trim();
  if (!HEX.test(s)) {
    return null;
  }
  let h = s.slice(1);
  if (h.length <= 4) {
    h = h.split('').map(c => c + c).join('');
  }
  const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

/**
 * Channels 0..1 → `#rrggbb`, clamped.
 * @param c - The colour.
 */
export function toHex(c: Rgb): string {
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}

/**
 * A hex colour as `#rrggbb`, lower case; null when it is not one or is not solid.
 * @param hex - The colour as typed.
 */
export function normalizeHex(hex: string): string | null {
  const c = parseHex(hex);
  return c && c.a === 1 ? toHex(c) : null;
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/**
 * WCAG relative luminance.
 * @param c - The colour.
 */
export function luminance(c: Rgb): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/**
 * WCAG contrast ratio between two colours, 1..21.
 * @param a - One colour (hex).
 * @param b - The other (hex).
 */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) {
    return 1;
  }
  const la = luminance(ca);
  const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The lowest contrast a colour has against any of these surfaces.
 * @param color - The colour (hex).
 * @param surfaces - The surfaces (hex).
 */
export function worstContrast(color: string, surfaces: readonly string[]): number {
  return Math.min(...surfaces.map(s => contrastRatio(color, s)));
}

type Oklab = { L: number; a: number; b: number };

function rgbToOklab(c: Rgb): Oklab {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToLinear(o: Oklab): Rgb {
  const l = (o.L + 0.3963377774 * o.a + 0.2158037573 * o.b) ** 3;
  const m = (o.L - 0.1055613458 * o.a - 0.0638541728 * o.b) ** 3;
  const s = (o.L - 0.0894841775 * o.a - 1.291485548 * o.b) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function inGamut(c: Rgb): boolean {
  const e = 1e-4;
  return c.r >= -e && c.r <= 1 + e && c.g >= -e && c.g <= 1 + e && c.b >= -e && c.b <= 1 + e;
}

/**
 * An OKLCH colour as sRGB, chroma reduced until it fits (hue and lightness kept).
 * @param L - Lightness 0..1.
 * @param C - Chroma.
 * @param h - Hue, radians.
 */
function oklchToRgb(L: number, C: number, h: number): Rgb {
  let chroma = C;
  for (let i = 0; i < 40; i += 1) {
    const lin = oklabToLinear({ L, a: chroma * Math.cos(h), b: chroma * Math.sin(h) });
    if (inGamut(lin) || chroma < 1e-4) {
      return { r: fromLinear(Math.min(1, Math.max(0, lin.r))), g: fromLinear(Math.min(1, Math.max(0, lin.g))), b: fromLinear(Math.min(1, Math.max(0, lin.b))) };
    }
    chroma *= 0.92;
  }
  return { r: L, g: L, b: L };
}

/**
 * The OKLab distance between two colours — how different they look.
 * @param a - One colour (hex).
 * @param b - The other (hex).
 */
export function colorDistance(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) {
    return Number.POSITIVE_INFINITY;
  }
  const oa = rgbToOklab(ca);
  const ob = rgbToOklab(cb);
  return Math.hypot(oa.L - ob.L, oa.a - ob.a, oa.b - ob.b);
}

/**
 * The text colour for a fill: the first of white / dark ink / black that
 * reaches AA on it, else whichever reads best.
 * @param fill - The fill (hex).
 */
export function foregroundFor(fill: string): string {
  return contrastRatio(fill, ON_FILL_LIGHT) >= contrastRatio(fill, ON_FILL_DARK) ? ON_FILL_LIGHT : ON_FILL_DARK;
}

/** A surface the brand colour fills, and the text on it. */
export type ReadableFill = { fill: string; foreground: string; adjusted: boolean };

/**
 * THE BRAND COLOUR AS A FILL WITH TEXT ON IT — a button, a badge, a selected
 * chip. The text is white or near-black, whichever reaches AA (4.5:1) on the
 * colour. A mid-tone reaches it with neither (a teal carries white at about
 * 4.2:1 and near-black at about 4.4:1), and black on a saturated mid-tone
 * reads muddy however the ratio comes out, so the fill moves instead: the
 * nearest darker shade of the same hue that carries white text at AA, or —
 * when that would no longer be the same colour — the nearest lighter shade
 * that carries near-black.
 * @param hex - The brand colour, normalised.
 */
export function readableFill(hex: string): ReadableFill {
  const white = contrastRatio(hex, ON_FILL_LIGHT);
  const dark = contrastRatio(hex, ON_FILL_DARK);
  if (white >= AA_TEXT || dark >= AA_TEXT) {
    return { fill: hex, foreground: white >= dark ? ON_FILL_LIGHT : ON_FILL_DARK, adjusted: false };
  }
  const darker = nearestReadableShade(hex, [ON_FILL_LIGHT], 'light', AA_TEXT);
  if (darker && colorDistance(hex, darker) <= MAX_SHIFT) {
    return { fill: darker, foreground: ON_FILL_LIGHT, adjusted: true };
  }
  const lighter = nearestReadableShade(hex, [ON_FILL_DARK], 'dark', AA_TEXT);
  if (lighter) {
    return { fill: lighter, foreground: ON_FILL_DARK, adjusted: true };
  }
  return { fill: hex, foreground: white >= dark ? ON_FILL_LIGHT : ON_FILL_DARK, adjusted: false };
}

/**
 * The nearest shade of a colour, same hue, that reaches `target` against every
 * surface — darker for a light theme, lighter for a dark one. Null when even
 * the end of the range does not.
 * @param hex - The brand colour.
 * @param surfaces - The theme's surfaces.
 * @param theme - Which way to move.
 * @param target - The contrast to reach.
 */
function nearestReadableShade(hex: string, surfaces: readonly string[], theme: ThemeName, target: number): string | null {
  const c = parseHex(hex)!;
  const o = rgbToOklab(c);
  const C = Math.hypot(o.a, o.b);
  const h = Math.atan2(o.b, o.a);
  const passes = (L: number) => worstContrast(toHex(oklchToRgb(L, C, h)), surfaces) >= target;
  // Search lightness between the colour's own and the end it moves toward.
  let lo = theme === 'light' ? 0 : o.L;
  let hi = theme === 'light' ? o.L : 1;
  const end = theme === 'light' ? lo : hi;
  if (!passes(end)) {
    return null;
  }
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2;
    if (theme === 'light') {
      // Darker passes: find the lightest L that still passes.
      if (passes(mid)) {
        lo = mid;
      } else {
        hi = mid;
      }
    } else if (passes(mid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  const L = theme === 'light' ? lo : hi;
  return toHex(oklchToRgb(L, C, h));
}

/** How one theme draws the accent as ink on its surfaces. */
export type ThemeAccent = {
  /** The colour used for links, the focus ring and the current page's mark. */
  ink: string;
  /** Text on `ink` when it is used as a fill (a selected chip). */
  inkForeground: string;
  /** True when `ink` is not the brand colour itself. */
  adjusted: boolean;
  /** Its worst contrast against the theme's surfaces. */
  contrast: number;
};

export type AccentTokens = {
  ok: true;
  /** The fill for buttons, badges and selected chips: the brand colour, or its nearest shade that carries text at AA (`readableFill`). */
  fill: string;
  /** Text on the fill, at least 4.5:1. */
  foreground: string;
  light: ThemeAccent;
  dark: ThemeAccent;
  /** What was changed and why, for the person: empty when nothing was. */
  notes: string[];
};

export type AccentRefusal = { ok: false; reason: string };

function ratio(n: number): string {
  return `${(Math.floor(n * 10) / 10).toFixed(1)}:1`;
}

/**
 * One theme's ink for a brand colour, or the reason there is none.
 * @param fill - The brand colour, normalised.
 * @param theme - The theme.
 */
function themeAccent(fill: string, theme: ThemeName): ThemeAccent | AccentRefusal {
  const surfaces = THEME_SURFACES[theme];
  const own = worstContrast(fill, surfaces);
  if (own >= AA_TEXT) {
    return { ink: fill, inkForeground: foregroundFor(fill), adjusted: false, contrast: own };
  }
  const o = rgbToOklab(parseHex(fill)!);
  if (Math.hypot(o.a, o.b) < ACHROMATIC_CHROMA) {
    const ink = THEME_INK[theme];
    return { ink, inkForeground: foregroundFor(ink), adjusted: true, contrast: worstContrast(ink, surfaces) };
  }
  const shade = nearestReadableShade(fill, surfaces, theme, AA_TEXT);
  const label = theme === 'light' ? 'light' : 'dark';
  if (!shade || colorDistance(fill, shade) > MAX_SHIFT) {
    return {
      ok: false,
      reason: `${fill.toUpperCase()} has ${ratio(own)} contrast on ${label} pages, and the nearest shade that reaches ${AA_TEXT}:1${shade ? ` (${shade.toUpperCase()})` : ''} no longer reads as the same colour. Pick a ${theme === 'light' ? 'deeper' : 'brighter'} shade of it.`,
    };
  }
  return { ink: shade, inkForeground: foregroundFor(shade), adjusted: true, contrast: worstContrast(shade, surfaces) };
}

/**
 * Everything the app needs to wear a brand colour readably, or why it cannot.
 * @param hex - The accent as the person or the brand guide gave it.
 */
export function accentTokens(hex: string): AccentTokens | AccentRefusal {
  const parsed = parseHex(hex);
  if (!parsed) {
    return { ok: false, reason: `"${hex}" is not a colour. Use a hex code like #1F6FEB.` };
  }
  if (parsed.a < 1) {
    return { ok: false, reason: `${hex} is see-through. The accent has to be a solid colour, so it reads the same on every page.` };
  }
  const fill = toHex(parsed);
  const light = themeAccent(fill, 'light');
  if ('ok' in light) {
    return light;
  }
  const dark = themeAccent(fill, 'dark');
  if ('ok' in dark) {
    return dark;
  }
  const notes: string[] = [];
  for (const [theme, t] of [['light', light], ['dark', dark]] as const) {
    if (t.adjusted) {
      notes.push(`On ${theme} pages, links and focus use ${t.ink.toUpperCase()} (${ratio(t.contrast)}) because ${fill.toUpperCase()} is too ${theme === 'light' ? 'light' : 'dark'} to read there.`);
    }
  }
  const filled = readableFill(fill);
  if (filled.adjusted) {
    notes.push(`Buttons and badges fill with ${filled.fill.toUpperCase()} so their ${filled.foreground === ON_FILL_LIGHT ? 'white' : 'dark'} text reads at ${ratio(contrastRatio(filled.fill, filled.foreground))}; ${fill.toUpperCase()} carries neither white nor dark text at ${AA_TEXT}:1.`);
  }
  return { ok: true, fill: filled.fill, foreground: filled.foreground, light, dark, notes };
}
