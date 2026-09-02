import type { ConfidenceLevel } from '@/types/Status';

/**
 * The one place the confidence ladder lives. `lead_brief.confidence` stores
 * the raw 0..1 score and nothing else, so moving these cut points re-labels
 * the whole queue without a backfill.
 * @param score - raw agent confidence, 0..1, or null when unscored
 */
export function confidenceLevel(score: number | null): ConfidenceLevel | null {
  if (score === null) {
    return null;
  }
  if (score >= 0.8) {
    return 'confident';
  }
  if (score >= 0.55) {
    return 'uncertain';
  }
  return 'speculative';
}
