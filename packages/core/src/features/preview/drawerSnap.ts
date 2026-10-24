/**
 * Where the phone drawer rests, and where a drag lets go of it.
 *
 * Chris, 2026-10-24: "I can't drag drawer full height." The drawer rests at
 * three heights — folded to its bar (`peek`), half the screen, and the whole
 * screen below its top edge — and a drag settles on the one the finger was
 * heading for, so a flick carries past the nearest.
 */

export type DrawerSnap = 'peek' | 'half' | 'full';

/** The folded bar's height with its grab handle, px. */
export const PEEK_HEIGHT = 56;

/** Air left above the drawer at full height, px. */
export const FULL_GAP = 12;

/** Half of the host's height, as a share. */
const HALF = 0.6;

/** How far a flick carries the drawer past where the finger let go, ms of travel. */
const PROJECTION_MS = 180;

/**
 * The height of each rest, px, for a host this tall.
 * @param hostHeight - The height the drawer can use, px.
 */
export function snapHeights(hostHeight: number): Record<DrawerSnap, number> {
  const full = Math.max(PEEK_HEIGHT, Math.round(hostHeight - FULL_GAP));
  return { peek: PEEK_HEIGHT, half: Math.min(full, Math.max(PEEK_HEIGHT, Math.round(hostHeight * HALF))), full };
}

/**
 * The rest a drag settles on: the nearest to where the drawer would have
 * carried on to at the speed it was let go.
 * @param height - The drawer's height when the finger lifted, px.
 * @param velocity - The finger's speed, px/ms; positive is downward (the drawer shrinking).
 * @param heights - The rests (`snapHeights`).
 */
export function resolveSnap(height: number, velocity: number, heights: Record<DrawerSnap, number>): DrawerSnap {
  const projected = height - velocity * PROJECTION_MS;
  const order: DrawerSnap[] = ['peek', 'half', 'full'];
  return order.reduce((best, s) => (Math.abs(heights[s] - projected) < Math.abs(heights[best] - projected) ? s : best), 'half' as DrawerSnap);
}

/**
 * What the handle's tap does: the next rest up, and from the top back to the bar.
 * @param snap - Where the drawer rests now.
 */
export function nextSnap(snap: DrawerSnap): DrawerSnap {
  return snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek';
}

/**
 * Clamp a dragged height to what the drawer can be.
 * @param height - Where the finger has it, px.
 * @param heights - The rests.
 */
export function clampHeight(height: number, heights: Record<DrawerSnap, number>): number {
  return Math.min(heights.full, Math.max(heights.peek, height));
}
