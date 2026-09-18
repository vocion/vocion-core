/**
 * The logic behind a `ScoreChip`: a 0..1 score read against the threshold it
 * was decided under. Pure, so the ledger page and its tests agree on what
 * "passed" means without rendering anything.
 */

export type ScoreVerdict = 'pass' | 'fail' | 'none';

/**
 * Pass when the score meets the threshold (`>=`, the same inequality the
 * router applies); `none` when there is no threshold to read against.
 * @param value - The score, 0..1.
 * @param threshold - The cut-off in force, 0..1, or undefined when none was recorded.
 */
export function scoreVerdict(value: number, threshold: number | null | undefined): ScoreVerdict {
  if (threshold == null || Number.isNaN(threshold)) {
    return 'none';
  }
  return value >= threshold ? 'pass' : 'fail';
}

/**
 * Two decimals, clamped to 0..1, so `0.9` and `0.90` render the same width.
 * @param value - The score.
 */
export function formatScore(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped.toFixed(2);
}

/**
 * The meter's fill as a CSS percentage, clamped.
 * @param value - The score, 0..1.
 */
export function scorePercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}
