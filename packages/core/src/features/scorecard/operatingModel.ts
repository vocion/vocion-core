import type { operatingEvidence } from '@/services/workforce/operating';

type Evidence = ReturnType<typeof operatingEvidence>;
export type OperatingItem = Evidence['items'][number];

/**
 * Current outcomes in the updated-item cohort; never sums attempts or estimates savings.
 * @param items - Selected business items, with no attempt duplication.
 */
export function operatingTotals(items: OperatingItem[]) {
  const current = items.filter(item => !item.evidenceChanged);
  const reviewed = current.filter(item => item.firstPassAccepted !== null && !['open', 'reopened'].includes(item.status));
  const effort = items.filter(item => item.activeEffortMinutes !== null);
  return {
    items: items.length,
    accepted: current.filter(item => ['accepted', 'corrected'].includes(item.status)).length,
    reviewed: reviewed.length,
    firstPass: reviewed.filter(item => item.firstPassAccepted).length,
    pending: current.filter(item => ['open', 'reopened'].includes(item.status)).length,
    completedUnreviewed: current.filter(item => item.completed && ['open', 'reopened'].includes(item.status)).length,
    blocked: current.filter(item => item.status === 'blocked').length,
    stale: items.filter(item => item.evidenceChanged).length,
    effort: effort.length ? effort.reduce((sum, item) => sum + item.activeEffortMinutes!, 0) : null,
    effortReported: items.filter(item => item.effortCoverage === 'reported').length,
    linked: items.filter(item => item.linked).length,
  };
}

/**
 * Parse only supported period values. Invalid links never widen the reporting window.
 * @param value - Untrusted period query parameter.
 */
export function operatingPeriod(value: string | null): 1 | 7 | 30 | 90 {
  return value === '1' ? 1 : value === '30' ? 30 : value === '90' ? 90 : 7;
}

/**
 * URL-backed selection; empty team is the explicit unassigned group, null means all teams.
 * @param base - Canonical workspace scorecard path.
 * @param days - Validated reporting period.
 * @param scope - Accessible workspace identity, or organization overview.
 * @param team - Selected team slug, including the empty unassigned group.
 * @param work - Selected business item identity.
 */
export function operatingPath(base: string, days: number, scope: string | null, team: string | null = null, work: string | null = null) {
  const query = new URLSearchParams({ days: String(days) });
  if (scope !== null) {
    query.set('scope', scope);
    if (team !== null) {
      query.set('team', team);
    }
    if (work !== null) {
      query.set('work', work);
    }
  }
  return `${base}?${query}`;
}
