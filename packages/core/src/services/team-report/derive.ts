/**
 * Derivations — everything the team report computes rather than declares.
 *
 * The spec's rule (docs/specs/team-report-v2.md, "The metric architecture"):
 * a team DECLARES mission, measures, targets and sources; Vocion DERIVES
 * goal attainment, trend, cost per outcome, quality rate, human load and
 * budget variance. All pure, all unit-tested without a database.
 */

import type { MeasureReading, TeamMeasure, TrendDirection } from './measures';

/**
 * Attainment 0..1, capped, direction-aware, from the baseline when one is
 * set. `higher`: (value − baseline) / (target − baseline). `lower` with a
 * baseline: (baseline − value) / (baseline − target); without one, target /
 * value — a 30-minute target hit at 60 minutes is half attained.
 * @param measure - The declared measure.
 * @param value - The reading.
 */
export function attainment(measure: Pick<TeamMeasure, 'target' | 'baseline' | 'direction'>, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  if (measure.direction === 'lower') {
    if (value <= measure.target) {
      return 1;
    }
    if (measure.baseline !== undefined && measure.baseline > measure.target) {
      return clamp((measure.baseline - value) / (measure.baseline - measure.target));
    }
    return value > 0 ? clamp(measure.target / value) : 1;
  }
  const base = measure.baseline ?? 0;
  const span = measure.target - base;
  if (span <= 0) {
    return value >= measure.target ? 1 : 0;
  }
  return clamp((value - base) / span);
}

/**
 * The uncapped truth — is the target met?
 * @param measure - The declared measure.
 * @param value - The reading.
 */
export function targetMet(measure: Pick<TeamMeasure, 'target' | 'direction'>, value: number | null): boolean {
  if (value === null) {
    return false;
  }
  return measure.direction === 'lower' ? value <= measure.target : value >= measure.target;
}

/**
 * The trend between this window and the one before it.
 * @param value - This window's reading.
 * @param previous - The prior window's reading.
 * @param direction - Which way is better.
 */
export function trendOf(value: number | null, previous: number | null, direction: TeamMeasure['direction']): { delta: number | null; trend: TrendDirection | null; improving: boolean | null } {
  if (value === null || previous === null) {
    return { delta: null, trend: null, improving: null };
  }
  const delta = value - previous;
  const trend: TrendDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const improving = delta === 0 ? null : direction === 'lower' ? delta < 0 : delta > 0;
  return { delta, trend, improving };
}

/**
 * Cents per unit of outcome — "$17.75 / referral". Null when nothing was
 * produced (spend with no outcome is a number on its own, not a ratio) and
 * null when nothing was spent (an outcome that cost $0.00 is a gap in the
 * cost record, not a bargain). Both sides must be read over the SAME window
 * — the measure's — or the ratio compares a day of spend with a week of
 * outcomes.
 * @param cents - The team's operating cost in the measure's window.
 * @param outcomeValue - The primary outcome's reading in that window.
 */
export function costPerOutcomeCents(cents: number, outcomeValue: number | null): number | null {
  if (outcomeValue === null || outcomeValue <= 0 || cents <= 0) {
    return null;
  }
  return cents / outcomeValue;
}

/**
 * A share, or null when the denominator is zero — a rate over nothing is
 * not 0%, it is unknown.
 * @param part
 * @param whole
 */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/**
 * Quality rate: approved without an edit, over everything a person decided.
 * An edit-then-approve counts as decided but not clean — the reviewer had to
 * change the work.
 * @param clean - Approved as proposed.
 * @param decided - Approved, edited or rejected.
 */
export function qualityRate(clean: number, decided: number): number | null {
  return rate(clean, decided);
}

/**
 * The median of a list, or null for an empty one.
 * @param values
 */
export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Spend against the cap: 0.1 = 10% over, −0.4 = 40% under. Null with no cap.
 * @param spentCents - Current-period spend.
 * @param limitCents - The hard cap, when one is set.
 */
export function budgetVariance(spentCents: number, limitCents: number | null): number | null {
  if (limitCents === null || limitCents <= 0) {
    return null;
  }
  return spentCents / limitCents - 1;
}

/**
 * Normalized workspace goal progress (spec §3): ONLY measures that declare
 * `contributesTo: workspace-goal` with a `weight` are combined, as
 * Σ weight × attainment / Σ weight. Heterogeneous units are never summed.
 * Null when no measure opts in — the headline then omits the figure rather
 * than pretending.
 * @param readings - Every measure reading on the report.
 */
export function goalProgress(readings: MeasureReading[]): { progress: number; measures: number } | null {
  const contributing = readings.filter(r => r.measure.contributesTo === 'workspace-goal' && r.measure.weight !== undefined && r.measure.weight > 0 && r.attainment !== null);
  const weightTotal = contributing.reduce((sum, r) => sum + r.measure.weight!, 0);
  if (contributing.length === 0 || weightTotal <= 0) {
    return null;
  }
  return {
    progress: contributing.reduce((sum, r) => sum + r.measure.weight! * r.attainment!, 0) / weightTotal,
    measures: contributing.length,
  };
}

/**
 * "Teams on target — 2 / 4": a team counts when its primary outcome's
 * target is met; only teams with a readable primary are in the denominator.
 * @param primaries - Each team's primary reading, or null when it has none.
 */
export function teamsOnTarget(primaries: Array<MeasureReading | null>): { onTarget: number; measured: number } {
  const measured = primaries.filter((p): p is MeasureReading => p !== null && p.value !== null);
  return { onTarget: measured.filter(p => p.met).length, measured: measured.length };
}

/**
 * The team's primary outcome: the first `outcome`-dimension measure, else
 * the first measure of any dimension. Null when nothing is declared.
 * @param readings - The team's readings, in authored order.
 */
export function primaryOutcome(readings: MeasureReading[]): MeasureReading | null {
  return readings.find(r => r.measure.dimension === 'outcome') ?? readings[0] ?? null;
}

/**
 * Fold a raw reading into its derived fields. One place, so the page, the
 * mail and the lineage sheet agree on every number.
 * @param base - The reading without derived fields.
 */
export function deriveReading(base: Omit<MeasureReading, 'attainment' | 'met' | 'delta' | 'trend' | 'improving'>): MeasureReading {
  return {
    ...base,
    attainment: attainment(base.measure, base.value),
    met: targetMet(base.measure, base.value),
    ...trendOf(base.value, base.previous, base.measure.direction),
  };
}
