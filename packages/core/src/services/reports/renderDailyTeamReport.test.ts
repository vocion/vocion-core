import type { DailyTeamReportData } from './dailyTeamReportShape';
import { describe, expect, it } from 'vitest';
import { shapeDailyTeamReport } from './dailyTeamReportShape';
import { compactTokens, performanceLine, renderDailyTeamReport, reportSections, reviewTime, subjectFor, usd } from './renderDailyTeamReport';

const T0 = new Date('2026-09-15T13:00:00Z');
const T_MINUS_24H = new Date('2026-09-14T13:00:00Z');

function fixture(): DailyTeamReportData {
  const shaped = shapeDailyTeamReport({
    agents: [
      { slug: 'ceo', name: 'CEO', teamSlug: 'executive', active: true },
      { slug: 'board', name: 'Board', teamSlug: 'board', active: true },
      { slug: 'writer', name: 'Writer', teamSlug: 'content', active: true },
      { slug: 'red-team', name: 'Red Team', teamSlug: 'quality-and-ops', active: true },
      { slug: 'idle-role', name: 'Idle Role', teamSlug: 'content', active: true },
      { slug: 'retired', name: 'Retired', teamSlug: 'content', active: false },
      { slug: 'stray', name: 'Stray', teamSlug: null, active: true },
    ],
    teams: [
      { slug: 'board', name: 'Board', leadAgentSlug: 'board' },
      { slug: 'executive', name: 'Executive', leadAgentSlug: 'ceo' },
      { slug: 'content', name: 'Content', leadAgentSlug: 'writer' },
      { slug: 'quality-and-ops', name: 'Quality & Ops', leadAgentSlug: null },
    ],
    budgets: [
      { agentSlug: 'ceo', period: 'daily', currentCents: 12_000, currentTokens: 3_000_000, hardCentsLimit: 40_000 },
    ],
    runs: [
      { agentSlug: 'board', status: 'completed', kind: 'board', tokens: 400_000, cents: 2_000, createdAt: T0 },
      { agentSlug: 'board', status: 'completed', kind: 'final', tokens: 800_000, cents: 1_130, createdAt: T0 },
      { agentSlug: 'ceo', status: 'completed', kind: 'lead', tokens: 5_000_000, cents: 9_000, createdAt: T0 },
      { agentSlug: 'ceo', status: 'failed', kind: 'lead', tokens: 100_000, cents: 300, createdAt: T0 },
      { agentSlug: 'writer', status: 'completed', kind: 'worker', tokens: 900_000, cents: 1_400, createdAt: T0 },
      { agentSlug: 'red-team', status: 'completed', kind: 'red-team', tokens: 12_000, cents: 170, createdAt: T0 },
      { agentSlug: 'stray', status: 'lost', kind: null, tokens: 0, cents: 0, createdAt: T0 },
    ],
  });
  return {
    workspace: { id: 'proj-x', name: 'Vocion Workforce', slug: 'vocion-workforce', accountableEmail: 'chris@example.com' },
    window: { since: T_MINUS_24H, until: T0 },
    ...shaped,
    performance: {
      goal: 'Be found first for AI-workforce-in-production.',
      setupNeeded: false,
      teamsOnTarget: { onTarget: 1, measured: 2 },
      goalProgress: 0.875,
      humanReviewMs: 138 * 60_000,
      autoCompletedRate: 0.78,
      needsAttention: 3,
      teams: [
        {
          slug: 'executive',
          name: 'Executive',
          mission: 'Ship the record every cycle.',
          primary: { label: 'Merged PRs', value: 8, target: 10, unit: 'PRs', attainment: 0.8, met: false, provenance: 'human-confirmed', trend: 'up', delta: 3, window: '7d' },
          humanLoad: { interventions: 12, reviewMs: 17 * 60_000, interventionRate: 0.14, autonomousCompletionRate: 0.5 },
          cents: 4_912,
          costPerOutcomeCents: 614,
          needsYou: 2,
        },
        {
          slug: 'content',
          name: 'Content',
          mission: 'Posts that rank.',
          primary: { label: 'Posts published', value: 3, target: 3, unit: 'posts', attainment: 1, met: true, provenance: 'agent-reported', trend: 'flat', delta: 0, window: '7d' },
          humanLoad: { interventions: 0, reviewMs: 0, interventionRate: 0, autonomousCompletionRate: null },
          cents: 1_400,
          costPerOutcomeCents: 1_400 / 3,
          needsYou: 0,
        },
        { slug: 'board', name: 'Board', mission: null, primary: null, humanLoad: { interventions: 0, reviewMs: 0, interventionRate: null, autonomousCompletionRate: null }, cents: 3_130, costPerOutcomeCents: null, needsYou: 1 },
      ],
    },
    needsYou: { pendingActions: 2, runsAwaitingReview: 1, runsPaused: 0, pendingLearningCandidates: 3, openAsks: 7, total: 13 },
    rollup: {
      id: 41,
      title: 'Workspace rollup — Mon, Sep 14',
      content: '## Priorities\n\n- Merge the **four** clean PRs\n- Rule on `032` <Slack granularity>\n\n| PR | State |\n|---|---|\n| #33 | clean |',
      createdAt: new Date('2026-09-14T13:05:00Z'),
      full: false,
      label: 'workspace briefing',
    },
    links: { inbox: 'https://agents.example.com/w/vocion-workforce/dashboard/inbox', teamReport: 'https://agents.example.com/w/vocion-workforce/dashboard/team-report', briefings: 'https://agents.example.com/w/vocion-workforce/dashboard/briefings' },
    generatedAt: T0,
  };
}

describe('shapeDailyTeamReport', () => {
  it('groups members under teams, weights by spend, flags board and red-team, keeps idle roles, drops inactive ones', () => {
    const d = fixture();

    expect(d.totals).toEqual({ runs: 7, completed: 5, failed: 2, tokens: 7_212_000, cents: 14_000, boardRuns: 2, redTeamRuns: 1, kindsKnown: true });
    expect(d.teams.map(t => t.name)).toEqual(['Executive', 'Board', 'Content', 'Quality & Ops', 'Unassigned']);

    const exec = d.teams[0]!;

    expect(exec.weightPct).toBe(66.4);
    expect(exec.members[0]).toMatchObject({ agentSlug: 'ceo', runs: 2, completed: 1, failed: 1, cents: 9_300, weightPct: 66.4, budgetCents: 12_000, budgetHardCentsLimit: 40_000 });

    const board = d.teams[1]!.members[0]!;

    expect(board.byKind).toEqual({ board: 2 });

    const content = d.teams[2]!;

    expect(content.members.map(m => m.agentSlug)).toEqual(['writer', 'idle-role']);
    expect(content.members[1]).toMatchObject({ runs: 0, cents: 0, weightPct: 0 });
    expect(d.teams.flatMap(t => t.members).some(m => m.agentSlug === 'retired')).toBe(false);
    expect(d.teams[4]).toMatchObject({ teamSlug: null, name: 'Unassigned' });
    expect(d.teams[4]!.members[0]).toMatchObject({ agentSlug: 'stray', failed: 1 });
  });

  it('reports kinds as unknown when no run carries one', () => {
    const shaped = shapeDailyTeamReport({
      agents: [],
      teams: [],
      budgets: [],
      runs: [{ agentSlug: 'a', status: 'completed', kind: null, tokens: 1, cents: 1, createdAt: T0 }],
    });

    expect(shaped.totals.kindsKnown).toBe(false);
    expect(shaped.totals.boardRuns).toBe(0);
  });
});

describe('renderDailyTeamReport', () => {
  it('formats money and tokens the way the mail shows them', () => {
    expect(usd(14_000)).toBe('$140');
    expect(usd(1_130)).toBe('$11.30');
    expect(compactTokens(7_212_000)).toBe('7.2M');
    expect(compactTokens(12_000)).toBe('12k');
    expect(compactTokens(950)).toBe('950');
  });

  it('names the workspace and the day in the subject', () => {
    expect(subjectFor(fixture())).toBe('Team report — Vocion Workforce — Tuesday, Sep 15');
  });

  it('leads with performance, then answers the manifesto\'s four questions, before the table and the evidence', () => {
    const r = renderDailyTeamReport(fixture());
    const order = ['Performance', 'What changed', 'What needs me', 'Are we on track', 'What happens next', 'From the workspace briefing', 'Teams and members', 'Evidence']
      .map(h => r.markdown.indexOf(`## ${h}`));

    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // tokens / cents are evidence, not the lead
    expect(r.markdown.indexOf('7.2M')).toBeGreaterThan(r.markdown.indexOf('## Evidence'));
    expect(r.markdown.indexOf('$140')).toBeGreaterThan(r.markdown.indexOf('## Evidence'));
    // no file paths in the mail
    expect(r.markdown).not.toContain('kpis:');
    expect(r.markdown).not.toContain('.yaml');
  });

  it('performance: goal attainment per team with provenance, human load, cost per outcome, needs-attention count', () => {
    const s = reportSections(fixture());

    expect(s.performance.setup).toBeNull();
    expect(s.performance.headline).toEqual([
      'Goal: Be found first for AI-workforce-in-production.',
      '**1 / 2** teams on target · **88%** goal progress · **2h 18m** human review · **78%** of work needed nobody · **3** need attention',
    ]);
    expect(s.performance.teams[0]).toBe('**Executive** — 8 / 10 Merged PRs · 80% of weekly target · ↑3 vs prior · human-confirmed · 17 min review over 12 interventions · $6.14/PR · **2 items need you**');
    expect(s.performance.teams[1]).toBe('**Content** — 3 / 3 Posts published · 100% of weekly target ✓ · agent-reported — the worker\'s own count · no human interventions · $4.67/post');
    expect(s.performance.teams[2]).toBe('**Board** — no measure yet · no human interventions · $31.30 operating cost · **1 item needs you**');
    expect(performanceLine({ slug: 'q', name: 'Quiet', mission: null, primary: null, humanLoad: { interventions: 0, reviewMs: 0, interventionRate: null, autonomousCompletionRate: null }, cents: 0, costPerOutcomeCents: null, needsYou: 0 })).toBe('**Quiet** — no measure yet · no human interventions · no spend in the window');
    expect(reviewTime(0)).toBe('0');
    expect(reviewTime(20_000)).toBe('<1 min');
    expect(reviewTime(46 * 60_000)).toBe('46 min');
    expect(performanceLine({ slug: 'x', name: 'X', mission: null, primary: { label: 'Pipeline', value: 417_000, target: 1_500_000, unit: '$', attainment: 0.278, met: false, provenance: 'verified', trend: null, delta: null, window: 'quarter' }, humanLoad: { interventions: 1, reviewMs: 60_000, interventionRate: null, autonomousCompletionRate: null }, cents: 38_400, costPerOutcomeCents: null, needsYou: 0 }))
      .toBe('**X** — $417,000 / $1,500,000 Pipeline · 28% of quarterly target · verified · 1 min review over 1 intervention · $384 operating cost');
  });

  it('performance: setup copy when the workspace is not measured, and when the read failed', () => {
    const d = fixture();
    d.performance = { ...d.performance!, setupNeeded: true, goal: null };

    expect(reportSections(d).performance.setup).toMatch(/state the workspace outcome/);

    delete d.performance;

    expect(reportSections(d).performance.setup).toBe('Team performance could not be read for this window.');
    expect(renderDailyTeamReport(d).markdown).toContain('_Team performance could not be read for this window._');
  });

  it('derives outcome-first sections from the data', () => {
    const s = reportSections(fixture());

    expect(s.changed[0]).toBe('**5 runs completed** across 4 teams — most by Board (2), CEO (1), Writer (1).');
    expect(s.changed[1]).toBe('**2 board-level reviews** and **1 red-team grade** ran — the oversight loop is turning.');
    expect(s.changed[2]).toBe('**2 runs failed or went lost** — CEO (1), Stray (1).');
    expect(s.needsMe).toEqual({
      total: 13,
      lines: ['2 proposed actions awaiting approval', '1 run awaiting review', '3 learning candidates to adopt or reject', '7 open asks — decisions, inputs, credentials'],
    });
    expect(s.onTrack.status).toBe('off-track');
    expect(s.onTrack.lines).toEqual([
      '29% of runs failed or went lost (2 of 7).',
      '1 run is stalled on a person — work is waiting, not moving.',
      'CEO carried 66.4% of the spend — one role is most of the bill.',
      '1 team is under target — Executive.',
    ]);
    expect(s.next[0]).toContain('[inbox](https://agents.example.com/w/vocion-workforce/dashboard/inbox)');
    expect(s.next[1]).toContain('next report lands in 24 hours');
    expect(s.rollup).toMatchObject({ title: 'Workspace rollup — Mon, Sep 14', truncated: false });
    expect(s.evidence.map(e => e.label)).toEqual(['Runs', 'Completed', 'Failed / lost', 'Spend', 'Tokens', 'Board runs', 'Red-team runs', 'Needs you']);
  });

  it('is calm when nothing is wrong, and honest when nothing ran', () => {
    const quiet = fixture();
    quiet.teams = quiet.teams.map(t => ({ ...t, members: t.members.map(m => ({ ...m, failed: 0, weightPct: 20 })) }));
    quiet.totals = { ...quiet.totals, failed: 0 };
    quiet.needsYou = { pendingActions: 0, runsAwaitingReview: 0, runsPaused: 0, pendingLearningCandidates: 0, openAsks: 0, total: 0 };
    quiet.performance = { ...quiet.performance!, teams: quiet.performance!.teams.map(t => (t.primary ? { ...t, primary: { ...t.primary, met: true } } : t)) };
    const s = reportSections(quiet);

    expect(s.onTrack.status).toBe('on-track');
    expect(s.onTrack.lines[0]).toBe('Nothing failed, nothing is stalled, no budget is near its cap.');
    expect(s.needsMe.lines).toEqual([]);
    expect(s.next[0]).toBe('Nothing is waiting on you; the team keeps running on its schedule.');

    const idle = fixture();
    idle.totals = { ...idle.totals, runs: 0, completed: 0, failed: 0 };
    idle.teams = [];

    expect(reportSections(idle).changed).toEqual(['No runs in this window — the team was idle.']);
  });

  it('flags a member near or over its hard budget cap', () => {
    const d = fixture();
    const exec = d.teams.find(t => t.teamSlug === 'executive')!;
    exec.members[0] = { ...exec.members[0]!, budgetCents: 36_000, budgetHardCentsLimit: 40_000 };

    expect(reportSections(d).onTrack.lines).toContain('CEO is at 90% of its budget cap ($360 of $400).');

    exec.members[0] = { ...exec.members[0]!, budgetCents: 40_000 };

    expect(reportSections(d).onTrack.lines).toContain('CEO has hit its hard budget cap ($400 of $400) — new runs will be refused.');
  });

  it('renders a selected team briefing in full and makes its title the subject', () => {
    const d = fixture();
    d.rollup = { ...d.rollup!, title: 'Revenue Briefing — Tue, Sep 15', content: `## Pipeline\n\n${'word '.repeat(600)}`, full: true, label: 'revops briefing' };
    const r = renderDailyTeamReport(d);
    const s = reportSections(d);

    expect(r.subject).toBe('Revenue Briefing — Tue, Sep 15');
    expect(s.rollup).toMatchObject({ truncated: false, label: 'revops briefing' });
    expect(s.rollup!.excerpt.length).toBeGreaterThan(2000);
    expect(r.markdown).toContain('## From the revops briefing');
    expect(r.html).not.toContain('Read the full briefing');
    // the four questions still lead
    expect(r.markdown.indexOf('## What needs me')).toBeLessThan(r.markdown.indexOf('## From the revops briefing'));
  });

  it('excerpts a long briefing and links to the rest', () => {
    const d = fixture();
    d.rollup = { ...d.rollup!, content: `## Long\n\n${'word '.repeat(600)}` };
    const s = reportSections(d);

    expect(s.rollup!.truncated).toBe(true);
    expect(s.rollup!.excerpt.length).toBeLessThanOrEqual(1201);
    expect(s.rollup!.excerpt.endsWith('…')).toBe(true);
    expect(renderDailyTeamReport(d).html).toContain('Read the full briefing');
  });

  it('carries every member, the flags, the links, and escapes the briefing', () => {
    const r = renderDailyTeamReport(fixture());

    expect(r.subject).toBe('Team report — Vocion Workforce — Tuesday, Sep 15');
    expect(r.html).toContain('Open the inbox → 13 waiting');
    expect(r.html).toContain('href="https://agents.example.com/w/vocion-workforce/dashboard/inbox"');
    expect(r.html).toContain('href="https://agents.example.com/w/vocion-workforce/dashboard/team-report"');

    // Every link in the mail carries the workspace: none may fall back to a
    // bare `/dashboard/...` that opens whatever project the reader last had active.
    const hrefs = [...r.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]!);

    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every(h => h.includes('/w/vocion-workforce/'))).toBe(true);
    expect(r.html).not.toContain('agents.example.com/dashboard/');

    for (const slug of ['ceo', 'board', 'writer', 'red-team', 'idle-role', 'stray']) {
      expect(r.html).toContain(`>${slug}</span>`);
    }

    expect(r.html).not.toContain('retired');
    expect(r.html).toContain('board×2');
    expect(r.html).toContain('red-team×1');
    expect(r.html).toContain('7 open asks');
    expect(r.html).toContain('Merge the <strong>four</strong> clean PRs');
    expect(r.html).toContain('&lt;Slack granularity&gt;');
    expect(r.html).not.toContain('<Slack granularity>');
    expect(r.html).toMatch(/color-scheme:\s*light dark/);
    expect(r.html).not.toMatch(/<img|<link|<script/);
    expect(r.text).toContain('What needs me — 13');
    expect(r.text).toContain('Open the inbox (https://agents.example.com/w/vocion-workforce/dashboard/inbox)');
    expect(r.markdown.startsWith('# Team report — Vocion Workforce — Tuesday, Sep 15')).toBe(true);
  });

  it('hides the asks line when the deployment has no ask table, and the board/red-team tiles when kinds are unknown', () => {
    const d = fixture();
    d.needsYou = { ...d.needsYou, openAsks: null, total: 6 };
    d.totals = { ...d.totals, kindsKnown: false };
    d.rollup = null;
    const r = renderDailyTeamReport(d);

    expect(r.html).not.toContain('open ask');
    expect(r.html).not.toContain('From the workspace briefing');
    expect(r.markdown).not.toContain('board-level review');
    expect(reportSections(d).evidence.find(e => e.label === 'Board runs')!.value).toBe('—');
  });

  it('is stable — snapshot of the whole mail', () => {
    expect(renderDailyTeamReport(fixture())).toMatchSnapshot();
  });
});
