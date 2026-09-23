/**
 * What the scorecard shows for a rate the agent has not earned yet.
 *
 * Spelled out rather than a dash because this screen is read by clients, not
 * by the team that built the agent: a dash reads as "broken", and 0% reads as
 * "always wrong" — the single most damaging thing this screen could say about
 * an agent nobody has judged yet (#342).
 */
export const NOT_ENOUGH_DATA = 'Not enough data';

/**
 * A 0–1 rate as a whole percentage, or {@link NOT_ENOUGH_DATA} when there is
 * no rate. A real 0 still renders as "0%" — only a missing value is empty.
 * @param rate - Between 0 and 1, or null when nothing has been decided.
 */
export function formatScore(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) {
    return NOT_ENOUGH_DATA;
  }
  return `${Math.round(rate * 100)}%`;
}
