/**
 * `initiative` — how much an agent volunteers. A leaf module: the harness,
 * the router and the event bus all read it, and none of them may import
 * the others to do so.
 */

export type Initiative = 'low' | 'normal' | 'high';

export const INITIATIVE_LEVELS: readonly Initiative[] = ['low', 'normal', 'high'];

/** Rank for tie-breaks: an agent that volunteers more takes an even match. */
export const INITIATIVE_RANK: Record<Initiative, number> = { low: 0, normal: 1, high: 2 };

/**
 * The stored value, or `normal` for a row from before the column and for
 * anything the constraint would not have let in.
 * @param raw - `agent.initiative` as read from the row.
 */
export function readInitiative(raw: unknown): Initiative {
  return raw === 'low' || raw === 'high' ? raw : 'normal';
}
