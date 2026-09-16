/**
 * Human load — the fold from rows to per-team counts and rates, on
 * fixtures. Spec: docs/specs/team-report-v2.md §6.
 */
import type { HumanLoadRows } from './humanLoad';
import { describe, expect, it } from 'vitest';
import { DECISION_LATENCY_CAP_MS, deriveHumanLoad, emptyHumanLoadCounts, foldHumanLoad, sumHumanLoadCounts } from './humanLoad';

const NOW = new Date('2026-09-15T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const TEAMS = [
  { slug: 'gtm', agentSlugs: ['outreach', 'mapper'] },
  { slug: 'deal-desk', agentSlugs: ['proposals'] },
];

function rows(): HumanLoadRows {
  return {
    actions: [
      // gtm: approved clean after 10 min
      { id: 1, agentSlug: 'outreach', status: 'done', autoApproved: false, createdAt: minsAgo(60), decidedAt: minsAgo(50), executedAt: minsAgo(50) },
      // gtm: edited after 20 min
      { id: 2, agentSlug: 'outreach', status: 'done', autoApproved: false, createdAt: minsAgo(60), decidedAt: minsAgo(40), executedAt: minsAgo(40) },
      // gtm: rejected after 5 min
      { id: 3, agentSlug: 'mapper', status: 'rejected', autoApproved: false, createdAt: minsAgo(30), decidedAt: minsAgo(25), executedAt: minsAgo(25) },
      // gtm: auto-executed — no person
      { id: 4, agentSlug: 'mapper', status: 'done', autoApproved: true, createdAt: minsAgo(30), decidedAt: null, executedAt: minsAgo(29) },
      // gtm: still pending — needs a decision, not yet an intervention
      { id: 5, agentSlug: 'outreach', status: 'pending', autoApproved: false, createdAt: minsAgo(20), decidedAt: null, executedAt: null },
      // deal-desk: approved with no ledger row (pre-ledger), a full day later — capped
      { id: 6, agentSlug: 'proposals', status: 'done', autoApproved: false, createdAt: minsAgo(24 * 60 * 2), decidedAt: minsAgo(24 * 60), executedAt: minsAgo(24 * 60) },
      // nobody's: no agent
      { id: 7, agentSlug: null, status: 'done', autoApproved: true, createdAt: minsAgo(10), decidedAt: null, executedAt: minsAgo(9) },
    ],
    decisions: [
      { subjectId: 1, decision: 'approved' },
      { subjectId: 2, decision: 'approved' },
      { subjectId: 2, decision: 'edited' },
      { subjectId: 3, decision: 'rejected' },
    ],
    asks: [
      { agentSlug: 'outreach', teamSlug: null, status: 'approved', createdAt: minsAgo(90), decidedAt: minsAgo(60) },
      { agentSlug: null, teamSlug: 'deal-desk', status: 'open', createdAt: minsAgo(45), decidedAt: null },
    ],
    runs: [
      { agentSlug: 'outreach', status: 'completed', createdAt: minsAgo(100), completedAt: minsAgo(88) },
      { agentSlug: 'mapper', status: 'completed', createdAt: minsAgo(100), completedAt: minsAgo(70) },
      { agentSlug: 'proposals', status: 'paused', createdAt: minsAgo(15), completedAt: null },
    ],
    open: [
      { agentSlug: 'outreach', teamSlug: null, createdAt: minsAgo(20) },
      { agentSlug: null, teamSlug: 'deal-desk', createdAt: minsAgo(45) },
      { agentSlug: 'proposals', teamSlug: null, createdAt: minsAgo(15) },
    ],
  };
}

describe('foldHumanLoad', () => {
  it('counts work items, interventions, decision latency and what needed a person, per team', () => {
    const gtm = foldHumanLoad(rows(), TEAMS, NOW).get('gtm')!;

    // 5 proposals + 1 ask + 2 runs
    expect(gtm.workItems).toBe(8);
    expect(gtm.proposals).toBe(5);
    expect(gtm.runs).toBe(2);
    expect(gtm.completedRuns).toBe(2);
    // approved, edited, rejected, plus the ask
    expect(gtm.interventions).toBe(4);
    expect(gtm.approvedClean).toBe(1);
    expect(gtm.approvedEdited).toBe(1);
    expect(gtm.rejected).toBe(1);
    // 10 + 20 + 5 min on actions, 30 on the ask
    expect(gtm.decisionLatencyMs).toBe(65 * 60_000);
    // 4 non-auto proposals + 1 ask; the auto-executed one needed nobody
    expect(gtm.needingDecision).toBe(5);
    expect(gtm.executed).toBe(3);
    expect(gtm.autoExecuted).toBe(1);
    expect(gtm.escalations).toBe(1);
    // turnaround: actions 10, 20, 1 min; runs 12, 30 min → sorted 1,10,12,20,30 → 12
    expect(gtm.turnaroundMedianMs).toBe(12 * 60_000);
    expect(gtm.open).toEqual({ count: 1, oldestAt: minsAgo(20), blockedMs: 20 * 60_000 });
  });

  it('caps decision latency per item, attributes asks by team slug, counts paused runs as escalations', () => {
    const dd = foldHumanLoad(rows(), TEAMS, NOW).get('deal-desk')!;

    // 1 proposal + 1 ask + 1 run
    expect(dd.workItems).toBe(3);
    // the day-long approve counts once, capped
    expect(dd.interventions).toBe(1);
    expect(dd.approvedClean).toBe(1);
    expect(dd.decisionLatencyMs).toBe(DECISION_LATENCY_CAP_MS);
    // proposal + ask + paused run
    expect(dd.needingDecision).toBe(3);
    expect(dd.escalations).toBe(2);
    expect(dd.open.count).toBe(2);
    expect(dd.open.oldestAt).toEqual(minsAgo(45));
  });

  it('keeps unattributed work under the null key and gives every team a bucket', () => {
    const folded = foldHumanLoad(rows(), [...TEAMS, { slug: 'idle', agentSlugs: ['nobody'] }], NOW);

    expect(folded.get(null)!.proposals).toBe(1);
    expect(folded.get(null)!.autoExecuted).toBe(1);
    expect(folded.get('idle')).toEqual(emptyHumanLoadCounts());
  });
});

describe('deriveHumanLoad + sumHumanLoadCounts', () => {
  it('derives the rates, null over nothing', () => {
    const gtm = deriveHumanLoad(foldHumanLoad(rows(), TEAMS, NOW).get('gtm')!);

    expect(gtm.interventionRate).toBe(5 / 8);
    expect(gtm.autonomousCompletionRate).toBe(1 / 3);
    expect(gtm.escalationRate).toBe(1 / 8);
    expect(gtm.qualityRate).toBe(1 / 3);
    expect(gtm.unattendedRate).toBe(3 / 8);
    expect(deriveHumanLoad(emptyHumanLoadCounts())).toMatchObject({ interventionRate: null, autonomousCompletionRate: null, escalationRate: null, qualityRate: null, unattendedRate: null });
  });

  it('sums counts across teams for the headline, keeping the oldest open item', () => {
    const all = sumHumanLoadCounts([...foldHumanLoad(rows(), TEAMS, NOW).values()]);

    expect(all.workItems).toBe(8 + 3 + 1);
    expect(all.interventions).toBe(5);
    expect(all.open.count).toBe(3);
    expect(all.open.oldestAt).toEqual(minsAgo(45));
    expect(all.turnaroundMedianMs).toBeNull();
  });
});
