/**
 * TeamReportService — weighting, kind flags, KPI readings and the member
 * detail, on PGlite; plus the pure `buildTeamReport` arithmetic.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema, agentSchema, missionSchema, projectSchema, teamSchema, tenantAccountSchema, trustRuleSchema, userSchema, workerRunSchema } = await import('@/models/Schema');
const { buildTeamReport, kpiProgress, memberReport, parseReportWindow, permissionKeys, teamReport, windowStart } = await import('@/services/TeamReportService');

const ORG = 'proj_team_report_test';
const NOW = new Date('2026-09-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

const CHRIS = { id: 'usr-tr-chris', name: 'Chris Fitkin', email: 'chris@example.com' };
const LILI = { id: 'usr-tr-lili', name: 'Lili Chen', email: 'lili@example.com' };

async function wipe() {
  await db.delete(workerRunSchema);
  await db.delete(agentBudgetSchema);
  await db.delete(missionSchema);
  await db.delete(trustRuleSchema);
  await db.delete(agentSchema);
  await db.delete(teamSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
}

async function seed() {
  await wipe();

  await db.insert(userSchema).values([CHRIS, LILI]);
  await db.insert(tenantAccountSchema).values({ id: 'acct-tr', name: 'MetaCTO', slug: 'metacto-tr' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-tr', slug: 'workforce', name: 'Workforce', leadAgentSlug: 'ceo', accountableUserId: CHRIS.id, goal: 'Be found first for AI-workforce-in-production.' });
  await db.insert(teamSchema).values([
    { orgId: ORG, slug: 'engineering', name: 'Engineering', leadAgentSlug: 'core-engineer', goal: 'Merged-quality PRs.', accountableUserId: LILI.id, kpis: [
      { key: 'prs_merged', label: 'Merged PRs', target: 4, unit: 'PRs', source: 'counts.prs_merged', window: 'all' },
      { key: 'prs_24h', label: 'PRs opened today', target: 2, source: 'counts.prs_opened', window: '24h' },
    ] },
    { orgId: ORG, slug: 'content', name: 'Content', leadAgentSlug: 'writer', kpis: [] },
    { orgId: ORG, slug: 'board', name: 'Board', leadAgentSlug: 'board', kpis: [] },
  ]);
  await db.insert(missionSchema).values([
    { orgId: ORG, slug: 'keep-main-releasable', name: 'Keep main releasable', goal: 'g', agentSlug: 'core-engineer', autonomyPolicy: { level: 3 } },
    { orgId: ORG, slug: 'docs-sync', name: 'Docs sync', goal: 'g', agentSlug: 'docs-engineer', autonomyPolicy: { level: 2 } },
    { orgId: ORG, slug: 'retired', name: 'Retired', goal: 'g', agentSlug: 'writer', status: 'disabled', autonomyPolicy: { level: 5 } },
  ]);
  await db.insert(trustRuleSchema).values([
    { orgId: ORG, actionId: 'hubspot.update', threshold: 0.9, enabled: 'true' },
    { orgId: ORG, actionId: 'gmail.send', threshold: 0.99, enabled: 'false' },
  ]);
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'ceo', name: 'CEO', systemPrompt: 'x', teamSlug: null, accent: 'amber' },
    { orgId: ORG, slug: 'board', name: 'Board', systemPrompt: 'x', teamSlug: 'board', accent: 'violet' },
    { orgId: ORG, slug: 'core-engineer', name: 'Core Engineer', description: 'Framework changes, PR only.', systemPrompt: 'x', teamSlug: 'engineering', accent: 'teal', approvalPolicy: { 'github.merge': 'always' } },
    { orgId: ORG, slug: 'docs-engineer', name: 'Docs Engineer', systemPrompt: 'x', teamSlug: 'engineering' },
    { orgId: ORG, slug: 'writer', name: 'Writer', systemPrompt: 'x', teamSlug: 'content' },
    { orgId: ORG, slug: 'red-team', name: 'Red Team', systemPrompt: 'x', teamSlug: 'content' },
  ]);
  await db.insert(agentBudgetSchema).values({ orgId: ORG, agentSlug: 'core-engineer', period: 'daily', currentCents: 1234, currentTokens: 9000, hardCentsLimit: 5000 });

  const run = (agentSlug: string, kind: string, cents: number, tokens: number, at: Date, extra: Partial<typeof workerRunSchema.$inferInsert> = {}) => ({
    orgId: ORG,
    agentSlug,
    kind,
    cents,
    tokens,
    status: 'completed',
    createdAt: at,
    claimedAt: at,
    completedAt: new Date(at.getTime() + 600_000),
    ...extra,
  });
  await db.insert(workerRunSchema).values([
    run('ceo', 'lead', 4000, 100_000, hoursAgo(2), { model: 'claude-opus-5', summary: 'Planned the cycle.' }),
    run('board', 'board', 2000, 50_000, hoursAgo(3), { model: 'claude-fable-5-1', summary: 'Board review 064.' }),
    run('core-engineer', 'worker', 1500, 40_000, hoursAgo(4), { model: 'claude-sonnet-5', counts: { prs_merged: 3, prs_opened: 1 } }),
    run('core-engineer', 'worker', 500, 10_000, hoursAgo(30), { model: 'claude-sonnet-5', counts: { prs_merged: 2, prs_opened: 2 } }), // outside 24h, inside 7d
    run('docs-engineer', 'worker', 1000, 20_000, hoursAgo(5), { status: 'failed', error: 'boom', counts: { prs_opened: 1 } }),
    run('writer', 'worker', 800, 30_000, hoursAgo(6), { model: 'claude-sonnet-5' }),
    run('red-team', 'red-team', 200, 5_000, hoursAgo(6), { model: 'gpt-5' }),
    run('writer', 'worker', 0, 0, hoursAgo(1), { status: 'running', completedAt: null }),
    run('writer', 'worker', 9999, 1, hoursAgo(24 * 20)), // outside 7d
  ]);
}

describe('TeamReportService (PGlite)', () => {
  beforeEach(seed);

  afterAll(wipe);

  it('anchors on the workspace goal and totals the window', async () => {
    const r = await teamReport(ORG, '7d', NOW);

    expect(r.goal).toBe('Be found first for AI-workforce-in-production.');
    expect(r.totals.runs).toBe(8);
    expect(r.totals.cents).toBe(4000 + 2000 + 1500 + 500 + 1000 + 800 + 200);
    expect(r.totals.active).toBe(1);
    expect(r.totals.failed).toBe(1);
    expect(r.totals.byKind).toEqual({ 'lead': 1, 'board': 1, 'worker': 5, 'red-team': 1 });
    // Judgement spend = board + red team, carried separately from output.
    expect(r.totals.judgementCents).toBe(2200);
    expect(r.totals.centsByKind).toMatchObject({ 'board': 2000, 'red-team': 200 });
  });

  it('states the workspace contract: owner, permission posture, mean attainment', async () => {
    const r = await teamReport(ORG, '7d', NOW);

    expect(r.owner).toMatchObject({ email: CHRIS.email, source: 'workspace' });
    expect(r.autoExecuteActions).toBe(1);
    // Only engineering measures anything: prs_merged 5/4 → 1, prs_24h 2/2 → 1.
    expect(r.attainment).toBe(1);
  });

  it('states each team\'s contract: purpose, owner with provenance, autonomy, permissions, attainment', async () => {
    const r = await teamReport(ORG, '7d', NOW);
    const eng = r.teams.find(t => t.slug === 'engineering')!;
    const content = r.teams.find(t => t.slug === 'content')!;

    expect(eng.contract.purpose).toBe('Merged-quality PRs.');
    expect(eng.contract.owner).toMatchObject({ email: LILI.email, source: 'team' });
    expect(eng.contract.autonomyLevel).toBe(3);
    expect(eng.contract.permissions).toEqual(['github.merge']);
    expect(eng.contract.attainment).toBe(1);
    expect(eng.contract.kpis.map(k => k.key)).toEqual(['prs_merged', 'prs_24h']);

    // Inherits the workspace owner; the disabled level-5 mission does not count.
    expect(content.contract.owner).toMatchObject({ email: CHRIS.email, source: 'workspace' });
    expect(content.contract.autonomyLevel).toBeNull();
    expect(content.contract.permissions).toEqual([]);
    expect(content.contract.attainment).toBeNull();
  });

  it('weighs each member\'s spend share against its outcome share of the team\'s KPIs', async () => {
    const r = await teamReport(ORG, '7d', NOW);
    const eng = r.teams.find(t => t.slug === 'engineering')!;
    const core = eng.members.find(m => m.slug === 'core-engineer')!;
    const docs = eng.members.find(m => m.slug === 'docs-engineer')!;

    // KPI readings: prs_merged (all) core 5 / docs 0; prs_24h core 1 / docs 1 → core 6 of 7, docs 1 of 7.
    expect(core.outcomeShare).toBeCloseTo(6 / 7, 5);
    expect(docs.outcomeShare).toBeCloseTo(1 / 7, 5);
    expect(core.shareOfCents).toBeCloseTo(0.2, 5);
    expect(core.contract).toMatchObject({ purpose: 'Framework changes, PR only.', autonomyLevel: 3, permissions: ['github.merge'] });
    expect(core.contract.owner).toMatchObject({ email: LILI.email });
    expect(docs.contract.autonomyLevel).toBe(2);

    // A team with no KPIs has no outcome to share.
    const writer = r.teams.find(t => t.slug === 'content')!.members.find(m => m.slug === 'writer')!;

    expect(writer.outcomeShare).toBeNull();
  });

  it('weights teams and members by spend, teams highest first, lead first within a team', async () => {
    const r = await teamReport(ORG, '7d', NOW);

    expect(r.teams.map(t => t.slug)).toEqual(['engineering', 'board', 'content']);

    const eng = r.teams[0]!;

    expect(eng.cents).toBe(3000);
    expect(eng.shareOfCents).toBeCloseTo(3000 / 10000, 5);
    expect(eng.accent).toBe('teal');
    expect(eng.members.map(m => m.slug)).toEqual(['core-engineer', 'docs-engineer']);
    expect(eng.members[0]!.isLead).toBe(true);
    expect(eng.members[0]!.models).toEqual(['claude-sonnet-5']);
    expect(eng.members[0]!.budget).toMatchObject({ period: 'daily', currentCents: 1234, hardCentsLimit: 5000 });
    expect(eng.members[1]!.failed).toBe(1);
    expect(eng.members[1]!.budget).toBeNull();
  });

  it('flags board and red-team runs on the team and member that produced them', async () => {
    const r = await teamReport(ORG, '7d', NOW);
    const board = r.teams.find(t => t.slug === 'board')!;
    const content = r.teams.find(t => t.slug === 'content')!;

    expect(board.byKind).toEqual({ board: 1 });
    expect(content.byKind).toEqual({ 'worker': 2, 'red-team': 1 });
    expect(content.members.find(m => m.slug === 'red-team')!.byKind).toEqual({ 'red-team': 1 });
    expect(content.members.find(m => m.slug === 'writer')!.active).toBe(1);
  });

  it('reads each KPI in its OWN window, summed over the team, regardless of the page window', async () => {
    const r = await teamReport(ORG, '24h', NOW);
    const eng = r.teams.find(t => t.slug === 'engineering')!;
    const merged = eng.contract.kpis.find(k => k.key === 'prs_merged')!;
    const opened = eng.contract.kpis.find(k => k.key === 'prs_24h')!;

    // all-time: 3 + 2 (the 30h-old run counts) → target 4 met
    expect(merged.value).toBe(5);
    expect(merged.progress).toBe(1);
    expect(merged.met).toBe(true);
    // 24h: core-engineer 1 + docs-engineer 1; the 30h-old run's 2 do not count
    expect(opened.value).toBe(2);
    expect(opened.met).toBe(true);
    // and the page window narrowed the spend
    expect(eng.cents).toBe(2500);
  });

  it('keeps agents on no team visible, never dropped', async () => {
    const r = await teamReport(ORG, '7d', NOW);

    expect(r.ungrouped.map(m => m.slug)).toEqual(['ceo']);
    expect(r.ungrouped[0]!.byKind).toEqual({ lead: 1 });
    expect(r.ungrouped[0]!.shareOfCents).toBeCloseTo(0.4, 5);
    expect(r.ungrouped[0]!.outcomeShare).toBeNull();
    // No team → the workspace default owner.
    expect(r.ungrouped[0]!.contract.owner).toMatchObject({ email: CHRIS.email, source: 'workspace' });
  });

  it('all-time window includes everything; 24h excludes the day-old runs', async () => {
    const all = await teamReport(ORG, 'all', NOW);
    const day = await teamReport(ORG, '24h', NOW);

    expect(all.totals.runs).toBe(9);
    expect(all.totals.cents).toBe(10000 + 9999);
    expect(day.totals.runs).toBe(7);
  });

  it('member detail lists runs newest first with summed counts, and null for a stranger', async () => {
    const d = await memberReport(ORG, 'core-engineer', { window: '7d' });

    expect(d).not.toBeNull();
    expect(d!.team).toMatchObject({ slug: 'engineering', goal: 'Merged-quality PRs.' });
    expect(d!.runs.map(r => r.cents)).toEqual([1500, 500]);
    expect(d!.counts).toEqual({ prs_merged: 5, prs_opened: 3 });
    expect(d!.member.shareOfCents).toBeCloseTo(0.2, 5);

    expect(await memberReport(ORG, 'nobody')).toBeNull();
  });
});

describe('buildTeamReport (pure) + helpers', () => {
  it('computes shares against the org total, measures from the baseline, and folds unknown team slugs into ungrouped', () => {
    const r = buildTeamReport({
      window: 'all',
      goal: null,
      teams: [{ id: 1, orgId: 'o', projectId: null, slug: 'a', name: 'A', description: 'desc', leadAgentSlug: 'x', accountableUserId: null, goal: null, kpis: [{ key: 'k', label: 'K', target: 10, baseline: 2, source: 'counts.k', window: 'all' }], createdAt: new Date(), updatedAt: new Date() }],
      agents: [
        { slug: 'x', name: 'X', description: null, icon: null, accent: null, teamSlug: 'a', approvalPolicy: {} },
        { slug: 'y', name: 'Y', description: null, icon: null, accent: null, teamSlug: 'gone', approvalPolicy: null },
      ],
      agg: [
        { agentSlug: 'x', kind: 'worker', runs: 2, cents: 300, tokens: 30, active: 0, failed: 0, lastActivity: null },
        { agentSlug: 'y', kind: 'board', runs: 1, cents: 100, tokens: 10, active: 0, failed: 0, lastActivity: null },
      ],
      models: [],
      kpiValues: { byTeam: new Map([['a/k', 4]]), byAgent: new Map([['a/k', new Map([['x', 4]])]]) },
      budgets: [],
      owners: { byTeam: new Map(), workspace: null },
      autonomy: new Map(),
      autoExecuteActions: 0,
    });

    expect(r.totals.cents).toBe(400);
    expect(r.totals.judgementCents).toBe(100);
    expect(r.teams[0]!.shareOfCents).toBe(0.75);
    // baseline 2 → target 10: a reading of 4 is 25% of the way.
    expect(r.teams[0]!.contract.kpis[0]).toMatchObject({ value: 4, progress: 0.25, met: false });
    expect(r.teams[0]!.contract.attainment).toBe(0.25);
    expect(r.teams[0]!.contract.purpose).toBe('desc');
    expect(r.teams[0]!.members[0]!.outcomeShare).toBe(1);
    expect(r.ungrouped.map(m => m.slug)).toEqual(['y']);
    expect(r.ungrouped[0]!.byKind).toEqual({ board: 1 });
    expect(r.attainment).toBe(0.25);
  });

  it('kpiProgress and permissionKeys', () => {
    const k = { key: 'k', label: 'K', target: 10, source: 'counts.k' };

    expect(kpiProgress(k, 0)).toBe(0);
    expect(kpiProgress(k, 5)).toBe(0.5);
    expect(kpiProgress(k, 12)).toBe(1);
    expect(kpiProgress({ ...k, baseline: 5 }, 5)).toBe(0);
    expect(kpiProgress({ ...k, baseline: 5 }, 3)).toBe(0);
    expect(kpiProgress({ ...k, baseline: 5 }, 7.5)).toBe(0.5);
    expect(permissionKeys(null)).toEqual([]);
    expect(permissionKeys({ b: 1, a: 2 })).toEqual(['a', 'b']);
  });

  it('windowStart and parseReportWindow', () => {
    expect(windowStart('all')).toBeNull();
    expect(windowStart('24h', NOW)!.toISOString()).toBe('2026-09-14T12:00:00.000Z');
    expect(windowStart('7d', NOW)!.toISOString()).toBe('2026-09-08T12:00:00.000Z');
    expect(parseReportWindow('24h')).toBe('24h');
    expect(parseReportWindow('bogus')).toBe('7d');
    expect(parseReportWindow(undefined)).toBe('7d');
  });
});
