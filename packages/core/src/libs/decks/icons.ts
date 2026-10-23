/**
 * The icon map behind `<x-icon name="…">` — name to inline SVG.
 *
 * A deck renders without any icon runtime or network: the path data is
 * generated once from lucide (`iconData.ts`, by
 * `packages/core/scripts/generate-deck-icons.mjs`) and the render page inlines
 * only the icons a deck uses (`libs/decks/page.ts`). Names are matched
 * case-insensitively with punctuation ignored (`check-circle`, `CheckCircle`
 * and `checkcircle` are one icon), and the spellings an author reaches for
 * (`PaperPlane`, `Robot`, `Gear`) are aliases. An unknown name is never a
 * silent blank: `resolveIcon` returns null and the audit names it.
 *
 * Pure; importable from the server and from a client card alike.
 */

import type { IconNode } from './iconData';
import { ICON_ALIASES, ICON_NODES } from './iconData';

export { LUCIDE_VERSION } from './iconData';

/** Every canonical icon name, in the map's order. */
export const ICON_NAMES: readonly string[] = Object.keys(ICON_NODES);

/**
 * The key an author's spelling is matched by: lowercase letters and digits.
 * @param name - What was written in `name="…"`.
 */
export function iconKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BY_KEY: ReadonlyMap<string, string> = new Map([
  ...ICON_NAMES.map(n => [iconKey(n), n] as const),
  ...Object.entries(ICON_ALIASES),
]);

/**
 * The canonical icon name for what an author wrote, or null when Vocion has no such icon.
 * @param name - `name="…"` on an `<x-icon>`.
 */
export function resolveIcon(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  return BY_KEY.get(iconKey(name)) ?? null;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function nodeMarkup(node: IconNode): string {
  return node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}/>`).join('');
}

/**
 * The inner markup (paths, circles…) of one icon on lucide's 24×24 grid, or
 * null for an unknown name. The runtime wraps it in an `<svg>` sized to the
 * element.
 * @param name - Any accepted spelling.
 */
export function iconInner(name: string): string | null {
  const canonical = resolveIcon(name);
  return canonical ? nodeMarkup(ICON_NODES[canonical]!) : null;
}

/**
 * One icon as a complete inline SVG, stroked in `currentColor` so it takes the
 * text colour around it. Null for an unknown name.
 * @param name - Any accepted spelling.
 * @param opts - Size in px (default 24) and stroke width (default 2).
 * @param opts.size
 * @param opts.strokeWidth
 */
export function iconSvg(name: string, opts: { size?: number; strokeWidth?: number } = {}): string | null {
  const inner = iconInner(name);
  if (inner === null) {
    return null;
  }
  const size = opts.size ?? 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${opts.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/**
 * The icons a set of names needs, keyed the way the browser runtime looks
 * them up (`iconKey`), each the inner markup. Unknown names are left out, so
 * the runtime marks them.
 * @param names - Every `name="…"` in a deck.
 */
export function iconTable(names: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const inner = iconInner(n);
    if (inner !== null) {
      out[iconKey(n)] = inner;
    }
  }
  return out;
}
