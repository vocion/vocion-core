/**
 * Setup-state detection — when the page is a checklist and when it is a
 * report. Spec: docs/specs/team-report-v2.md §10.
 */
import type { TeamMeasure } from './measures';
import { describe, expect, it } from 'vitest';
import { detectSetupState } from './setup';

const measure: TeamMeasure = { key: 'k', label: 'K', dimension: 'outcome', target: 1, window: '7d', direction: 'higher', source: { kind: 'agent-reported', counts: 'k' } };

describe('detectSetupState', () => {
  it('needs setup when the goal, every measure, or all work is missing — and says which', () => {
    const s = detectSetupState({ goal: null, teams: [{ slug: 'a', measures: [] }, { slug: 'b', measures: [] }], unassignedAgents: 2, completedWorkEver: 0, autoExecuteActions: 0 });

    expect(s.needed).toBe(true);
    expect(s.reasons).toEqual(['no-goal', 'no-measures', 'no-work']);
    expect(s.missing).toBe(2);
    expect(s.items).toEqual([
      { key: 'goal', label: 'Workspace outcome', status: 'missing', detail: 'Missing' },
      { key: 'measures', label: 'Team measures', status: 'missing', detail: '0 of 2 configured' },
      { key: 'unassigned', label: 'Unassigned agents', status: 'info', detail: '2' },
      { key: 'autonomy', label: 'Autonomy policy', status: 'info', detail: 'Human approval default' },
    ]);
  });

  it('one measured team and any completed work is enough to graduate; partial coverage is informational', () => {
    const s = detectSetupState({ goal: 'Pipeline.', teams: [{ slug: 'a', measures: [measure] }, { slug: 'b', measures: [] }], unassignedAgents: 0, completedWorkEver: 1, autoExecuteActions: 2 });

    expect(s.needed).toBe(false);
    expect(s.reasons).toEqual([]);
    expect(s.measured).toEqual({ configured: 1, total: 2 });
    expect(s.items.find(i => i.key === 'measures')).toMatchObject({ status: 'info', detail: '1 of 2 configured' });
    expect(s.items.find(i => i.key === 'autonomy')).toMatchObject({ detail: '2 action kinds auto-execute' });
    expect(s.items.find(i => i.key === 'unassigned')).toMatchObject({ status: 'ok', detail: 'None' });
  });

  it('a configured workforce with no work yet is still setup — the report would be all zeroes', () => {
    const s = detectSetupState({ goal: 'G', teams: [{ slug: 'a', measures: [measure] }], unassignedAgents: 0, completedWorkEver: 0, autoExecuteActions: 0 });

    expect(s.needed).toBe(true);
    expect(s.reasons).toEqual(['no-work']);
    expect(s.missing).toBe(0);
  });

  it('no teams at all reads as such', () => {
    expect(detectSetupState({ goal: null, teams: [], unassignedAgents: 3, completedWorkEver: 0, autoExecuteActions: 0 }).items[1]).toMatchObject({ detail: 'No teams yet' });
  });
});
