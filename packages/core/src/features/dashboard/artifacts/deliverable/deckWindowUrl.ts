/**
 * A deck in its own browser window: the route, the slide it opens on, and the
 * window's size.
 *
 * Chris, 2026-10-27: *"when looking at a presentation, give me a full/breakout
 * new window view (not full screen)"*. Present mode takes the whole screen;
 * this is the deck in a window of its own that a person can put on a second
 * monitor, resize, or share into a call, with present mode's slide view and
 * keys (`PresentMode`, `display="window"`), and the current slide in the URL
 * so a reload keeps the place.
 *
 * Pure: no DOM, so the sizing and the URL are testable without a browser.
 */

/** The query parameter that carries the slide, 1-based, as a person reads it. */
export const SLIDE_PARAM = 'slide';

/**
 * The window's name, so opening the same deck twice brings its window forward rather than stacking a second one.
 * @param artifactId - The deck.
 */
export function deckWindowName(artifactId: number): string {
  return `vocion-deck-${artifactId}`;
}

/**
 * Where the deck's window lives. An app path: the caller canonicalises it
 * with the workspace (`canonicalise`), exactly as a `Link` would.
 * @param artifactId - The deck.
 * @param slide - The 1-based slide to open on; the first when omitted.
 */
export function deckWindowPath(artifactId: number, slide?: number): string {
  const base = `/dashboard/artifacts/${artifactId}/window`;
  return slide && slide > 1 ? `${base}?${SLIDE_PARAM}=${Math.floor(slide)}` : base;
}

/**
 * The 0-based slide index a `?slide=` value names, clamped to the deck. Junk,
 * a missing value or a number past the end falls back to a real slide rather
 * than a blank window.
 * @param raw - The parameter as read from the URL.
 * @param total - How many slides the deck has.
 */
export function slideIndexFromParam(raw: string | string[] | null | undefined, total: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(total - 1, n - 1));
}

/** The part of `window.screen` the sizing reads. */
export type ScreenBox = { availWidth: number; availHeight: number; availLeft?: number; availTop?: number };

/** Room for the slide controls beneath the slide, and for the browser's own title bar. */
const CONTROLS_HEIGHT = 48;
const TITLE_BAR = 32;
/** How much of the screen the window takes: large, never the whole of it — that is present mode. */
const SCREEN_SHARE = 0.8;
const MIN_WIDTH = 480;

/**
 * The `window.open` features for a 16:9 deck window that fits this screen:
 * 80% of the larger dimension the slide allows, centred, with the slide
 * controls' height added beneath the 16:9 slide so the slide itself is 16:9.
 * @param screen - The screen the opener is on.
 */
export function deckWindowFeatures(screen: ScreenBox): string {
  const maxWidth = Math.max(MIN_WIDTH, screen.availWidth * SCREEN_SHARE);
  const maxSlideHeight = Math.max(MIN_WIDTH * 9 / 16, screen.availHeight * SCREEN_SHARE - CONTROLS_HEIGHT - TITLE_BAR);
  const width = Math.round(Math.min(maxWidth, maxSlideHeight * 16 / 9));
  const height = Math.round(width * 9 / 16 + CONTROLS_HEIGHT);
  const left = Math.round((screen.availLeft ?? 0) + Math.max(0, (screen.availWidth - width) / 2));
  const top = Math.round((screen.availTop ?? 0) + Math.max(0, (screen.availHeight - height - TITLE_BAR) / 2));
  return `popup,width=${width},height=${height},left=${left},top=${top}`;
}
