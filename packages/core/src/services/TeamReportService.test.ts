/**
 * TeamReportService — the pure `buildTeamReport` assembly and its helpers.
 * The database-backed composition (measures, human load, chains, lineage)
 * is covered on PGlite in `services/team-report/teamReport.pglite.test.ts`.
 */
import type { MeasureReading } from '@/services/team-report';
import { describe, expect, it } from 'vitest';
import { deriveHumanLoad, deriveReading, emptyHumanLoadCounts } from '@/services/team-report';
import { buildTeamReport, mergeAutonomy, parseReportWindow, permissionKeys, windowStart } from './TeamReportService';

const NOW = new Date('2026-09-15T12:00:00Z');
const RANGE = { since: new Date('2026-09-08T12:00:00Z'), until: NOW };

const teamRow = (slug: string, extra: Partial<Parameters<typeof buildTeamReport>[0]['teams'][number]> = {}) => ({
  id: 1,
  orgId: 'o',
  projectId: null,
  slug,
  name: slug.toUpperCase(),
  description: 'desc',
  leadAgentSlug: null,
  accountableUserId: null,
  goal: null,
  kpis: [],
  measures: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

const measure = { key: 'k', label: 'K', dimension: 'outcome' as const, target: 10, window: '7d' as const, direction: 'higher' as const, source: { kind: 'agent-reported' as const, counts: 'k' } };

function reading(value: number | null, previous: number | null = null): MeasureReading {
  return deriveReading({ measure, value, previous, provenance: 'agent-reported', sourceLabel: 'worker reports', asOf: NOW, freshness: { asOf: NOW, ageMs: 0, stale: false, note: null }, unavailableReason: null, unavailableKind: null });
}

const base = () => ({
  window: '7d' as const,
  range: RANGE,
  workspaceName: 'W',
  goal: 'G',
  teams: [] as ReturnType<typeof teamRow>[],
  agents: [] as Parameters<typeof buildTeamReport>[0]['agents'],
  agg: [] as Parameters<typeof buildTeamReport>[0]['agg'],
  models: [],
  measures: new Map<string, MeasureReading>(),
  humanLoad: new Map(),
  chains: new Map(),
  budgets: [],
  owners: { byTeam: new Map(), workspace: null },
  autonomy: new Map(),
  policies: new Map(),
  autoExecuteActions: 0,
  completedWorkEver: 1,
});

describe('buildTeamReport (pure)', () => {
  it('computes shares against the org total, judgement spend apart, and folds unknown team slugs into ungrouped', () => {
    const r = buildTeamReport({
      ...base(),
      teams: [teamRow('a', { leadAgentSlug: 'x', measures: [measure] })],
      agents: [
        { slug: 'x', name: 'X', description: null, icon: null, accent: 'teal', teamSlug: 'a', approvalPolicy: {} },
        { slug: 'y', name: 'Y', description: null, icon: null, accent: null, teamSlug: 'gone', approvalPolicy: null },
      ],
      agg: [
        { agentSlug: 'x', kind: 'worker', runs: 2, cents: 300, tokens: 30, active: 0, failed: 0, lastActivity: null },
        { agentSlug: 'y', kind: 'board', runs: 1, cents: 100, tokens: 10, active: 0, failed: 0, lastActivity: null },
      ],
      measures: new Map([['a/k', reading(4, 2)]]),
    });

    expect(r.totals.cents).toBe(400);
    expect(r.totals.judgementCents).toBe(100);
    expect(r.teams[0]!.shareOfCents).toBe(0.75);
    expect(r.teams[0]!.accent).toBe('teal');
    expect(r.teams[0]!.primary).toMatchObject({ value: 4, attainment: 0.4, met: false, trend: 'up' });
    expect(r.teams[0]!.economics.costPerOutcomeCents).toBe(75);
    expect(r.teams[0]!.contract.attainment).toBe(0.4);
    expect(r.teams[0]!.mission).toBe('desc');
    expect(r.ungrouped.map(m => m.slug)).toEqual(['y']);
    expect(r.ungrouped[0]!.byKind).toEqual({ board: 1 });
    expect(r.attainment).toBe(0.4);
    expect(r.headline.teamsOnTarget).toEqual({ onTarget: 0, measured: 1 });
    expect(r.headline.goalProgress).toBeNull();
    expect(r.setup.needed).toBe(false);
  });

  it('a team with no measures has no primary and no cost per outcome; a team with no human load reads zeros, not nulls', () => {
    const r = buildTeamReport({ ...base(), teams: [teamRow('a')], agents: [{ slug: 'x', name: 'X', description: null, icon: null, accent: null, teamSlug: 'a', approvalPolicy: null }] });
    const t = r.teams[0]!;

    expect(t.primary).toBeNull();
    expect(t.economics.costPerOutcomeCents).toBeNull();
    expect(t.humanLoad).toEqual(deriveHumanLoad(emptyHumanLoadCounts()));
    expect(t.needsYou).toEqual({ count: 0, oldestAt: null, href: '/dashboard/inbox?agents=x' });
    expect(t.control).toEqual({ actionTypes: 0, autoExecute: 0, approvalRequired: true, topRung: null });
  });

  it('setup: no goal, no measures or no work ever flips the page to the checklist', () => {
    expect(buildTeamReport({ ...base(), goal: null, teams: [teamRow('a', { measures: [measure] })] }).setup.reasons).toEqual(['no-goal']);
    expect(buildTeamReport({ ...base(), teams: [teamRow('a')] }).setup.reasons).toEqual(['no-measures']);
    expect(buildTeamReport({ ...base(), teams: [teamRow('a', { measures: [measure] })], completedWorkEver: 0 }).setup.reasons).toEqual(['no-work']);
  });

  it('members are lead first then by spend; teams by spend', () => {
    const r = buildTeamReport({
      ...base(),
      teams: [teamRow('a', { leadAgentSlug: 'lead' }), teamRow('b')],
      agents: [
        { slug: 'big', name: 'Big', description: null, icon: null, accent: null, teamSlug: 'a', approvalPolicy: null },
        { slug: 'lead', name: 'Lead', description: null, icon: null, accent: null, teamSlug: 'a', approvalPolicy: null },
        { slug: 'b1', name: 'B1', description: null, icon: null, accent: null, teamSlug: 'b', approvalPolicy: null },
      ],
      agg: [
        { agentSlug: 'big', kind: 'worker', runs: 1, cents: 900, tokens: 1, active: 0, failed: 0, lastActivity: null },
        { agentSlug: 'lead', kind: 'lead', runs: 1, cents: 100, tokens: 1, active: 0, failed: 0, lastActivity: null },
        { agentSlug: 'b1', kind: 'worker', runs: 1, cents: 5000, tokens: 1, active: 0, failed: 0, lastActivity: null },
      ],
    });

    expect(r.teams.map(t => t.slug)).toEqual(['b', 'a']);
    expect(r.teams[1]!.members.map(m => m.slug)).toEqual(['lead', 'big']);
  });
});

describe('helpers', () => {
  it('mergeAutonomy pools agreement per action kind across members', () => {
    const merged = mergeAutonomy([
      [{ actionId: 'hubspot.update', rung: 'execute-with-approval', riskTier: 'low', agreementRate: 1, n: 2 }],
      [{ actionId: 'hubspot.update', rung: 'execute-with-approval', riskTier: 'low', agreementRate: 0.5, n: 2 }, { actionId: 'gmail.send', rung: 'autonomous', riskTier: 'medium', agreementRate: null, n: 0 }],
    ]);

    expect(merged.map(m => m.actionId)).toEqual(['gmail.send', 'hubspot.update']);
    expect(merged[1]).toMatchObject({ n: 4, agreementRate: 0.75 });
  });

  it('permissionKeys, windowStart and parseReportWindow', () => {
    expect(permissionKeys(null)).toEqual([]);
    expect(permissionKeys({ b: 1, a: 2 })).toEqual(['a', 'b']);
    expect(windowStart('24h', NOW).toISOString()).toBe('2026-09-14T12:00:00.000Z');
    expect(windowStart('7d', NOW).toISOString()).toBe('2026-09-08T12:00:00.000Z');
    expect(windowStart('30d', NOW).toISOString()).toBe('2026-08-16T12:00:00.000Z');
    expect(parseReportWindow('30d')).toBe('30d');
    expect(parseReportWindow('all')).toBe('7d');
    expect(parseReportWindow(undefined)).toBe('7d');
  });
});
