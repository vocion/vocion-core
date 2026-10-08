/**
 * Tints — the six soft colour blocks a front door wears (an app, a catalog
 * card, an empty state). The palette is the marketing site's warm one; the
 * values are CSS custom properties in `styles/global.css` (`--tint-*`), with
 * dark variants that keep `--ink-secondary` at AA. See
 * `docs/design/patterns.md` § Front doors.
 *
 * Pure data: the app manifest schema reads the names, the components read the
 * classes.
 */

export const TINTS = ['violet', 'sky', 'mint', 'peach', 'butter', 'rose'] as const;

export type Tint = (typeof TINTS)[number];

/** Tailwind background class per tint — listed whole so Tailwind sees them. */
export const TINT_BG: Record<Tint, string> = {
  violet: 'bg-tint-violet',
  sky: 'bg-tint-sky',
  mint: 'bg-tint-mint',
  peach: 'bg-tint-peach',
  butter: 'bg-tint-butter',
  rose: 'bg-tint-rose',
};

/**
 * Whether a value names a tint.
 * @param value - Anything read from a manifest or a prop.
 */
export function isTint(value: unknown): value is Tint {
  return typeof value === 'string' && (TINTS as readonly string[]).includes(value);
}

/**
 * The tint a thing wears when it names none: stable for its id, so an app
 * keeps its colour across renders, workspaces and deploys.
 * @param id - A stable id (an app id, a slug).
 */
export function defaultTint(id: string): Tint {
  let h = 0;
  for (const ch of id) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return TINTS[h % TINTS.length]!;
}

/**
 * The tint to draw: the one named, else the stable default for the id.
 * @param tint - The authored tint, if any.
 * @param id - The id to derive a default from.
 */
export function resolveTint(tint: string | null | undefined, id: string): Tint {
  return isTint(tint) ? tint : defaultTint(id);
}
