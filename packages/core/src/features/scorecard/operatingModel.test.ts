import type { OperatingItem } from './operatingModel';
import { describe, expect, it } from 'vitest';
import { operatingPath, operatingPeriod, operatingTotals } from './operatingModel';

const item = (changes: Partial<OperatingItem> = {}): OperatingItem => ({ id: 'one', title: 'Example', agentSlug: 'writer', workflow: 'multi-agent', status: 'open', evidenceChanged: false, firstPassAccepted: null, activeEffortMinutes: null, effortCoverage: 'partial', linked: true, completed: true, rubricPresent: true, ...changes });

describe('operating review semantics', () => {
  it('never counts completed execution as accepted work', () => {
    expect(operatingTotals([item()])).toMatchObject({ items: 1, accepted: 0, reviewed: 0, completedUnreviewed: 1, effort: null });
  });

  it('excludes stale and reopened acceptance; retains their reported human burden', () => {
    const total = operatingTotals([
      item({ status: 'accepted', evidenceChanged: true, firstPassAccepted: true, activeEffortMinutes: 4 }),
      item({ status: 'reopened', firstPassAccepted: true, activeEffortMinutes: 3 }),
      item({ status: 'corrected', firstPassAccepted: false, activeEffortMinutes: 2, effortCoverage: 'reported' }),
      item({ status: 'rejected', firstPassAccepted: false }),
    ]);

    expect(total).toMatchObject({ items: 4, accepted: 1, reviewed: 2, firstPass: 0, stale: 1, effort: 9, effortReported: 1 });
  });

  it('does not average per-agent percentages or treat missing effort as measured zero', () => {
    expect(operatingTotals([item({ status: 'accepted', firstPassAccepted: true, activeEffortMinutes: 0, effortCoverage: 'reported' }), item({ status: 'blocked', firstPassAccepted: false })])).toMatchObject({ reviewed: 2, firstPass: 1, effort: 0, effortReported: 1 });
    expect(operatingTotals([])).toMatchObject({ accepted: 0, reviewed: 0, effort: null });
  });
});

describe('operating navigation', () => {
  it('round-trips a team, window and item without losing workspace identity', () => {
    const path = operatingPath('/w/finance/dashboard/scorecard', 30, 'workspace-id', 'a & b', 'work-id');
    const url = new URL(path, 'https://example.test');

    expect(url.pathname).toBe('/w/finance/dashboard/scorecard');
    expect(Object.fromEntries(url.searchParams)).toEqual({ days: '30', scope: 'workspace-id', team: 'a & b', work: 'work-id' });
  });

  it('distinguishes unassigned from all teams and clears child selections at the root', () => {
    expect(new URLSearchParams(operatingPath('/dashboard/scorecard', 7, 'workspace', '').split('?')[1]).has('team')).toBe(true);
    expect(operatingPath('/dashboard/scorecard', 7, null, 'old-team', 'old-item')).toBe('/dashboard/scorecard?days=7');
  });

  it('bounds invalid or hostile period values', () => {
    for (const value of [null, '', '-1', '999', '7<script>']) {
      expect(operatingPeriod(value)).toBe(7);
    }

    expect(operatingPeriod('1')).toBe(1);
    expect(operatingPeriod('90')).toBe(90);
  });
});
