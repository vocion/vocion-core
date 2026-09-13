/**
 * The regenerating stamp's staleness window, shared by every reader: the
 * decide/regenerate guards server-side and the card's banner client-side.
 * ~3x the worst observed full agent pass (4m57s on prod), so a wedged run
 * re-enables on its own instead of blocking the card forever.
 */
export const REGENERATING_STALE_MS = 15 * 60_000;

/**
 * Whether a regenerating stamp still holds: present and younger than the
 * staleness window. Past it the guards expire and the card re-enables with a
 * caution.
 * @param since - `action_run.regenerating_since` (Date server-side, ISO string across the RPC boundary).
 * @param now
 */
export function isRegeneratingFresh(since: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (since == null) {
    return false;
  }
  const at = typeof since === 'string' ? new Date(since) : since;
  const t = at.getTime();
  return !Number.isNaN(t) && now.getTime() - t < REGENERATING_STALE_MS;
}
