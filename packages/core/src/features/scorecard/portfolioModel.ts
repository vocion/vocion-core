import type { OperatingItem } from './operatingModel';
import type { PortfolioData } from '@/services/workforce/portfolioContract';
import { operatingTotals } from './operatingModel';

/**
 * Deterministic next steps based on explicit evidence, never projected ROI.
 * @param data - Owner-authored workflow.
 * @param items - Linked, non-synthetic work in the selected window.
 * @param today - UTC date for follow-up checks.
 */
export function portfolioNextStep(data: PortfolioData, items: OperatingItem[], today: string) {
  const totals = operatingTotals(items);
  if (data.stage === 'retired' || data.stage === 'paused') {
    return 'inactive' as const;
  }
  if (data.improvements.some(i => i.status !== 'closed' && i.followUp < today)) {
    return 'followUp' as const;
  }
  if (!data.owner || !data.objective || !data.successMeasure) {
    return 'define' as const;
  }
  if (totals.blocked || totals.stale) {
    return 'resolve' as const;
  }
  if (!items.length) {
    return data.stage === 'discovery' ? 'pilot' as const : 'instrument' as const;
  }
  if (totals.completedUnreviewed || totals.pending) {
    return 'review' as const;
  }
  if (totals.reviewed < 5 || totals.linked < items.length || totals.effortReported < items.length || !data.baseline) {
    return 'measure' as const;
  }
  if (totals.firstPass / totals.reviewed < 0.8) {
    return 'improve' as const;
  }
  return 'assess' as const;
}
