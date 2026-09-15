import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  actionRunSchema,
  agentSchema,
  briefingSchema,
  learningCandidateSchema,
  projectSchema,
  teamSchema,
  tenantAccountSchema,
  userSchema,
  workerRunSchema,
} = await import('@/models/Schema');
const { collectDailyTeamReport, DAILY_TEAM_REPORT_PUBLISHER } = await import('@/services/reports/dailyTeamReport');
const { runDailyTeamReportJob } = await import('@/services/jobs/dailyTeamReport');
const { isBuiltInJob, runBuiltInJob } = await import('@/services/jobs/registry');

const ORG = 'proj-report-test';
const OTHER = 'proj-other';
const NOW = new Date('2026-09-15T13:00:00Z');
const IN_WINDOW = new Date('2026-09-15T02:00:00Z');
const OUT_OF_WINDOW = new Date('2026-09-13T02:00:00Z');

beforeEach(async () => {
  delete process.env.VOCION_MAIL_ENABLED;
  process.env.NEXT_PUBLIC_APP_URL = 'https://agents.example.com/';
  await db.delete(workerRunSchema);
  await db.delete(briefingSchema);
  await db.delete(actionRunSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(agentSchema);
  await db.delete(teamSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(userSchema).values({ id: 'user-chris', email: 'chris@example.com', name: 'Chris' });
  await db.insert(tenantAccountSchema).values({ id: 'acct-1', name: 'Metacto', slug: 'metacto' });
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct-1', slug: 'vocion-workforce', name: 'Vocion Workforce', accountableUserId: 'user-chris' },
    { id: OTHER, accountId: 'acct-1', slug: 'other', name: 'Other' },
  ]);
  await db.insert(teamSchema).values([
    { orgId: ORG, projectId: ORG, slug: 'executive', name: 'Executive', leadAgentSlug: 'ceo' },
    { orgId: ORG, projectId: ORG, slug: 'content', name: 'Content', leadAgentSlug: 'writer' },
  ]);
  await db.insert(agentSchema).values([
    { orgId: ORG, projectId: ORG, slug: 'ceo', name: 'CEO', systemPrompt: 'x', teamSlug: 'executive' },
    { orgId: ORG, projectId: ORG, slug: 'writer', name: 'Writer', systemPrompt: 'x', teamSlug: 'content' },
    { orgId: OTHER, projectId: OTHER, slug: 'ceo', name: 'Other CEO', systemPrompt: 'x' },
  ]);
  await db.insert(workerRunSchema).values([
    { orgId: ORG, agentSlug: 'ceo', status: 'completed', tokens: 1000, cents: 900, createdAt: IN_WINDOW },
    { orgId: ORG, agentSlug: 'writer', status: 'completed', tokens: 500, cents: 100, createdAt: IN_WINDOW },
    { orgId: ORG, agentSlug: 'writer', status: 'awaiting_review', tokens: 10, cents: 5, createdAt: IN_WINDOW },
    { orgId: ORG, agentSlug: 'ceo', status: 'completed', tokens: 99_999, cents: 99_999, createdAt: OUT_OF_WINDOW },
    { orgId: OTHER, agentSlug: 'ceo', status: 'completed', tokens: 77_777, cents: 77_777, createdAt: IN_WINDOW },
  ]);
  await db.insert(actionRunSchema).values([
    { orgId: ORG, actionId: 'gmail.send', status: 'pending' },
    { orgId: ORG, actionId: 'gmail.send', status: 'done' },
    { orgId: OTHER, actionId: 'gmail.send', status: 'pending' },
  ]);
  await db.insert(learningCandidateSchema).values({ orgId: ORG, projectId: ORG, stepName: 'global', ruleText: 'cite it', status: 'pending' });
  await db.insert(briefingSchema).values([
    { orgId: ORG, title: 'Workspace rollup — Mon', content: '## Priorities\n\n- ship', teamSlug: null, agentSlug: 'ceo', createdAt: new Date('2026-09-14T12:00:00Z') },
    { orgId: ORG, title: 'Team report — Vocion Workforce — Monday, Sep 14', content: 'old report', teamSlug: null, agentSlug: DAILY_TEAM_REPORT_PUBLISHER, createdAt: new Date('2026-09-14T13:00:00Z') },
    { orgId: ORG, title: 'Content brief', content: 'team only', teamSlug: 'content', agentSlug: 'writer', createdAt: new Date('2026-09-15T12:00:00Z') },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('collectDailyTeamReport', () => {
  it('scopes to the org and the window, joins agents to teams, counts what needs a person, and picks the real rollup', async () => {
    const d = await collectDailyTeamReport(ORG, { since: new Date(NOW.getTime() - 24 * 3_600_000), until: NOW });

    expect(d.workspace).toEqual({ id: ORG, name: 'Vocion Workforce', slug: 'vocion-workforce', accountableEmail: 'chris@example.com' });
    expect(d.totals).toMatchObject({ runs: 3, completed: 2, failed: 0, tokens: 1510, cents: 1005, kindsKnown: false });
    expect(d.teams.map(t => [t.name, t.cents])).toEqual([['Executive', 900], ['Content', 105]]);
    expect(d.teams[1]!.members[0]).toMatchObject({ agentSlug: 'writer', runs: 2, completed: 1, weightPct: 10.4 });
    expect(d.needsYou).toEqual({ pendingActions: 1, runsAwaitingReview: 1, runsPaused: 0, pendingLearningCandidates: 1, openAsks: null, total: 3 });
    expect(d.rollup).toMatchObject({ title: 'Workspace rollup — Mon' });
    expect(d.links.inbox).toBe('https://agents.example.com/dashboard/inbox');
  });

  it('throws for an unknown project', async () => {
    await expect(collectDailyTeamReport('proj-nope')).rejects.toThrow(/no project/);
  });
});

describe('daily-team-report job', () => {
  it('is registered', () => {
    expect(isBuiltInJob('daily-team-report')).toBe(true);
  });

  it('stores the report as a workspace briefing and reports mail as skipped when the flag is off', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = (await runBuiltInJob('daily-team-report', ORG, {})) as Awaited<ReturnType<typeof runDailyTeamReportJob>>;

    expect(result.subject).toMatch(/^Team report — Vocion Workforce — /);
    expect(result.recipients).toEqual(['chris@example.com']);
    expect(result.mail).toEqual({ sent: false, reason: 'VOCION_MAIL_ENABLED is not 1' });
    expect(result.briefingId).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    const [row] = await db.select().from(briefingSchema).where((await import('drizzle-orm')).eq(briefingSchema.id, result.briefingId!));

    expect(row).toMatchObject({ orgId: ORG, teamSlug: null, agentSlug: DAILY_TEAM_REPORT_PUBLISHER, publishedBy: 'job:daily-team-report' });
    expect(row!.content).toContain('## Teams and members');

    // A second run must not pick its own previous report as "the rollup".
    const again = await collectDailyTeamReport(ORG);

    expect(again.rollup?.title).toBe('Workspace rollup — Mon');
  });

  it('mails through the transport when enabled, honours input.to, and survives a provider rejection', async () => {
    process.env.VOCION_MAIL_ENABLED = '1';
    process.env.RESEND_API_KEY = 're_test';
    process.env.VOCION_MAIL_FROM = 'Vocion <reports@example.com>';
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_9' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const ok = await runDailyTeamReportJob(ORG, { to: 'a@example.com, b@example.com', publish: false });

    expect(ok.mail).toEqual({ sent: true, id: 'msg_9' });
    expect(ok.recipients).toEqual(['a@example.com', 'b@example.com']);
    expect(ok.briefingId).toBeNull();

    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

    expect(body.subject).toMatch(/^Team report — Vocion Workforce — /);
    expect(body.html).toContain('<!DOCTYPE html>');
    expect(body.text).toContain('Teams and members');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"domain not verified"}', { status: 403 })));
    const bad = await runDailyTeamReportJob(ORG, { publish: false });

    expect(bad.mail).toMatchObject({ sent: false, reason: expect.stringContaining('PROVIDER') });

    delete process.env.RESEND_API_KEY;
    delete process.env.VOCION_MAIL_FROM;
  });

  it('input.mail=false skips mail even when enabled', async () => {
    process.env.VOCION_MAIL_ENABLED = '1';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await runDailyTeamReportJob(ORG, { mail: false, publish: false });

    expect(r.mail).toEqual({ sent: false, reason: 'input.mail=false' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
