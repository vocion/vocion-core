/**
 * The rail's geometry: how wide it is and where that memory lives.
 *
 * Width is clamped to a range that keeps both the page and the rail usable
 * — never narrower than a phone-width column, never more than half the
 * viewport. localStorage is the fast path (synchronous, this browser); the
 * `chat_widget_state` row is what a new device reads.
 */

export const RAIL_MIN_WIDTH = 320;
export const RAIL_MAX_FRACTION = 0.5;
/** The old dock's width: a third of the viewport, never under 384px. */
export const RAIL_DEFAULT_MIN = 384;
/** Below this viewport width the rail covers the page as a sheet instead of narrowing it. */
export const RAIL_SHEET_BREAKPOINT = 1200;
/**
 * Below this RAIL width the header's autonomy chip drops its label and shows
 * its icon alone. Measured, not guessed: at 400px the title plus four 32px
 * controls plus a ~150px label is the point where the workspace name starts
 * truncating to nothing.
 */
export const RAIL_COMPACT_HEADER_WIDTH = 400;

const WIDTH_KEY = 'vocion_chat_rail_width';
export const COLLAPSE_KEY = 'vocion_chat_dock_collapsed';

/**
 * Keep a requested width inside [320px, 50vw].
 * @param width - The requested width in px.
 * @param viewportWidth - `window.innerWidth`, or a test value.
 */
export function clampRailWidth(width: number, viewportWidth: number): number {
  const max = Math.max(RAIL_MIN_WIDTH, Math.floor(viewportWidth * RAIL_MAX_FRACTION));
  if (!Number.isFinite(width)) {
    return Math.min(max, Math.max(RAIL_MIN_WIDTH, defaultRailWidth(viewportWidth)));
  }
  return Math.min(max, Math.max(RAIL_MIN_WIDTH, Math.round(width)));
}

/**
 * The width a rail opens at when nothing was ever saved — the same third of
 * the screen the dock used.
 * @param viewportWidth
 */
export function defaultRailWidth(viewportWidth: number): number {
  return Math.max(RAIL_DEFAULT_MIN, Math.floor(viewportWidth / 3));
}

export function readStoredRailWidth(): number | null {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeStoredRailWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Whether the rail is collapsed, as this browser last left it; `fallback`
 * when it never said.
 * @param fallback
 */
export function readCollapsed(fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

export function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — state still holds for this session */
  }
}

/**
 * The split between the column's two panes: preview on top, chat below.
 *
 * Stored as the preview pane's fraction of the column, not a pixel height, so
 * the same memory survives a window resize and a different screen. Neither
 * pane may be dragged into uselessness — a pane you cannot read is a pane you
 * would have closed.
 */
export const RAIL_SPLIT_DEFAULT = 0.5;
/** Neither pane goes below this fraction of the column. */
export const RAIL_SPLIT_MIN = 0.2;

const SPLIT_KEY = 'vocion_rail_split';

/**
 * Keep a requested split inside [0.2, 0.8].
 * @param fraction - The preview pane's share of the column height.
 */
export function clampRailSplit(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    return RAIL_SPLIT_DEFAULT;
  }
  return Math.min(1 - RAIL_SPLIT_MIN, Math.max(RAIL_SPLIT_MIN, fraction));
}

export function readStoredRailSplit(): number | null {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    const n = raw ? Number.parseFloat(raw) : Number.NaN;
    return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
  } catch {
    return null;
  }
}

export function writeStoredRailSplit(fraction: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, clampRailSplit(fraction).toFixed(3));
  } catch {
    /* storage unavailable — the split still holds for this session */
  }
}
