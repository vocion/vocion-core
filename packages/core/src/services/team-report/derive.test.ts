/**
 * Derivations — every number the report computes rather than declares, on
 * fixtures. Spec: docs/specs/team-report-v2.md §1, §3, §6.
 */
import type { MeasureReading, TeamMeasure } from './measures';
import { describe, expect, it } from 'vitest';
import { attainment, budgetVariance, costPerOutcomeCents, deriveReading, goalProgress, median, primaryOutcome, qualityRate, rate, targetMet, teamsOnTarget, trendOf } from './derive';
import { measureRange, priorRange, provenanceRank, windowMs, windowPhrase } from './measures';

const NOW = new Date('2026-09-15T12:00:00Z');

const higher: TeamMeasure = { key: 'referrals', label: 'Qualified referrals', dimension: 'outcome', target: 10, window: '7d', direction: 'higher', source: { kind: 'agent-reported', counts: 'referrals' } };
const lower: TeamMeasure = { key: 'turnaround', label: 'Turnaround', dimension: 'velocity', target: 30, unit: 'min', window: '7d', direction: 'lower', source: { kind: 'agent-reported', counts: 'turnaround' } };

function reading(measure: TeamMeasure, value: number | null, previous: number | null = null, extra: Partial<TeamMeasure> = {}): MeasureReading {
  return deriveReading({ measure: { ...measure, ...extra }, value, previous, provenance: measure.source.kind, sourceLabel: 'test', asOf: NOW, freshness: { asOf: NOW, ageMs: 0, stale: false, note: null }, unavailableReason: null, unavailableKind: null });
}

describe('attainment + targetMet', () => {
  it('higher-is-better: value / target from zero, capped, and from the baseline when set', () => {
    expect(attainment(higher, 0)).toBe(0);
    expect(attainment(higher, 8)).toBe(0.8);
    expect(attainment(higher, 12)).toBe(1);
    expect(attainment({ ...higher, baseline: 5 }, 5)).toBe(0);
    expect(attainment({ ...higher, baseline: 5 }, 7.5)).toBe(0.5);
    expect(attainment({ ...higher, baseline: 5 }, 3)).toBe(0);
    expect(targetMet(higher, 10)).toBe(true);
    expect(targetMet(higher, 9.9)).toBe(false);
  });

  it('lower-is-better: at or under target is 1; above, target / value, or from the baseline when set', () => {
    expect(attainment(lower, 30)).toBe(1);
    expect(attainment(lower, 12)).toBe(1);
    expect(attainment(lower, 60)).toBe(0.5);
    expect(attainment({ ...lower, baseline: 240 }, 135)).toBe(0.5);
    expect(attainment({ ...lower, baseline: 240 }, 300)).toBe(0);
    expect(targetMet(lower, 30)).toBe(true);
    expect(targetMet(lower, 31)).toBe(false);
  });

  it('a missing reading has no attainment and is not met', () => {
    expect(attainment(higher, null)).toBeNull();
    expect(targetMet(higher, null)).toBe(false);
    expect(attainment(higher, Number.NaN)).toBeNull();
  });
});

describe('trendOf', () => {
  it('reads direction and whether the move is an improvement', () => {
    expect(trendOf(8, 5, 'higher')).toEqual({ delta: 3, trend: 'up', improving: true });
    expect(trendOf(5, 8, 'higher')).toEqual({ delta: -3, trend: 'down', improving: false });
    expect(trendOf(18, 25, 'lower')).toEqual({ delta: -7, trend: 'down', improving: true });
    expect(trendOf(5, 5, 'higher')).toEqual({ delta: 0, trend: 'flat', improving: null });
    expect(trendOf(5, null, 'higher')).toEqual({ delta: null, trend: null, improving: null });
  });
});

describe('cost per outcome, rates, median, budget variance', () => {
  it('cost per outcome is cents per unit, and null with nothing produced or nothing spent', () => {
    expect(costPerOutcomeCents(14_200, 8)).toBe(1775);
    expect(costPerOutcomeCents(14_200, 0)).toBeNull();
    expect(costPerOutcomeCents(14_200, null)).toBeNull();
    expect(costPerOutcomeCents(0, 8)).toBeNull();
  });

  it('a rate over nothing is unknown, not zero', () => {
    expect(rate(3, 0)).toBeNull();
    expect(rate(3, 12)).toBe(0.25);
    expect(qualityRate(11, 12)).toBeCloseTo(0.9167, 3);
    expect(qualityRate(0, 0)).toBeNull();
  });

  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([1, 9, 3])).toBe(3);
    expect(median([1, 9, 3, 5])).toBe(4);
  });

  it('budget variance is spend over cap minus one; null with no cap', () => {
    expect(budgetVariance(1100, 1000)).toBeCloseTo(0.1, 5);
    expect(budgetVariance(600, 1000)).toBeCloseTo(-0.4, 5);
    expect(budgetVariance(600, null)).toBeNull();
    expect(budgetVariance(600, 0)).toBeNull();
  });
});

describe('goalProgress (spec §3)', () => {
  it('combines only measures that declare a weighted contribution, as Σ weight × attainment / Σ weight', () => {
    const a = reading(higher, 8, null, { contributesTo: 'workspace-goal', weight: 3 }); // 0.8
    const b = reading({ ...higher, key: 'mqls', target: 40 }, 10, null, { contributesTo: 'workspace-goal', weight: 1 }); // 0.25
    const c = reading({ ...higher, key: 'pitches' }, 100); // no contribution — ignored, however large

    expect(goalProgress([a, b, c])).toEqual({ progress: (3 * 0.8 + 1 * 0.25) / 4, measures: 2 });
  });

  it('is null — omitted, not zero — when no measure opts in or none can be read', () => {
    expect(goalProgress([reading(higher, 8)])).toBeNull();
    expect(goalProgress([reading(higher, null, null, { contributesTo: 'workspace-goal', weight: 1 })])).toBeNull();
    expect(goalProgress([])).toBeNull();
  });
});

describe('teamsOnTarget + primaryOutcome', () => {
  it('counts teams whose primary is met over teams with a readable primary', () => {
    expect(teamsOnTarget([reading(higher, 10), reading(higher, 4), null, reading(higher, null)])).toEqual({ onTarget: 1, measured: 2 });
  });

  it('the primary is the first outcome-dimension measure, else the first measure, else null', () => {
    const v = reading(lower, 12);
    const o = reading(higher, 8);

    expect(primaryOutcome([v, o])).toBe(o);
    expect(primaryOutcome([v])).toBe(v);
    expect(primaryOutcome([])).toBeNull();
  });
});

describe('deriveReading', () => {
  it('folds attainment, met and trend onto a raw reading', () => {
    const r = reading(higher, 8, 5);

    expect(r).toMatchObject({ attainment: 0.8, met: false, delta: 3, trend: 'up', improving: true, provenance: 'agent-reported' });
  });
});

describe('windows', () => {
  it('window lengths, ranges and phrases', () => {
    expect(windowMs('24h')).toBe(86_400_000);
    expect(windowMs('quarter')).toBe(91 * 86_400_000);
    expect(measureRange('7d', NOW)).toEqual({ since: new Date('2026-09-08T12:00:00Z'), until: NOW });
    expect(priorRange('7d', NOW)).toEqual({ since: new Date('2026-09-01T12:00:00Z'), until: new Date('2026-09-08T12:00:00Z') });
    expect(windowPhrase('30d')).toBe('last 30 days');
    expect(provenanceRank('verified')).toBe(0);
    expect(provenanceRank('agent-reported')).toBe(3);
  });
});
