/**
 * Funnel steps as the analytics family reports them, from the people each
 * step counted — computed here, once, rather than trusting each vendor's own
 * ratios and rounding, so a Mixpanel funnel and an Amplitude funnel read the
 * same way.
 */

import type { AnalyticsFunnelStep } from '../provider';

/**
 * Four places: 0.1234 is 12.34%.
 * @param part - The step's people.
 * @param whole - The people it is a share of.
 */
function share(part: number, whole: number): number {
  return whole > 0 ? Math.round(part / whole * 10_000) / 10_000 : 0;
}

/**
 * The family's steps from people per step, in order.
 * @param steps - Each step's event and the people who reached it.
 */
export function funnelSteps(steps: ReadonlyArray<{ event: string; count: number }>): AnalyticsFunnelStep[] {
  const first = steps[0]?.count ?? 0;
  return steps.map((step, i) => ({
    event: step.event,
    count: step.count,
    fromPrevious: i === 0 ? null : share(step.count, steps[i - 1]!.count),
    fromStart: i === 0 ? (first > 0 ? 1 : 0) : share(step.count, first),
  }));
}
