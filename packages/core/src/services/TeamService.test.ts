/**
 * TeamService resolution logic — the accountability inheritance rule
 * (acceptance #6–7) and lead/member resolution, pure via buildTeamViews
 * and integration via listTeams/getTeam/getWorkspaceLead on PGlite.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, teamSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { buildTeamViews, getTeam, getWorkspaceLead, listTeams } = await import('@/services/TeamService');

const ORG = 'proj_teams_test';
const CHRIS = { id: 'usr-chris', name: 'Chris Fitkin', email: 'chris@metacto.com' };
const LILI = { id: 'usr-lili', name: 'Lili Chen', email: 'lili@metacto.com' };

const agentRow = (slug: string, name: string, teamSlug: string | null = null) => ({
  slug,
  name,
  description: null,
  icon: null,
  accent: null,
  teamSlug,
});

describe('buildTeamViews (pure)', () => {
  const usersById = new Map([[CHRIS.id, CHRIS], [LILI.id, LILI]]);
  const teamRow = (slug: string, name: string, leadAgentSlug: string | null, accountableUserId: string | null) =>
    ({ id: 1, orgId: ORG, projectId: null, slug, name, description: null, leadAgentSlug, accountableUserId, updatedAt: new Date(), createdAt: new Date() });

  it('resolves an explicit owner with source "team" and an inherited one with source "workspace"', () => {
    const views = buildTeamViews({
      teams: [
        teamRow('marketing', 'Marketing', 'marketing-lead', LILI.id),
        teamRow('revenue-ops', 'Revenue Ops', 'revenue-lead', null),
      ],
      agents: [agentRow('revenue-lead', 'Revenue Lead', 'revenue-ops'), agentRow('marketing-lead', 'Marketing Lead', 'marketing')],
      workspaceAccountableUserId: CHRIS.id,
      usersById,
    });

    expect(views.map(v => v.slug)).toEqual(['marketing', 'revenue-ops']);
    expect(views[0]!.accountable).toMatchObject({ email: LILI.email, source: 'team' });
    expect(views[1]!.accountable).toMatchObject({ email: CHRIS.email, source: 'workspace' });
  });

  it('returns null accountable when neither the team nor the workspace names one (acceptance #12)', () => {
    const [view] = buildTeamViews({
      teams: [teamRow('revenue-ops', 'Revenue Ops', null, null)],
      agents: [],
      workspaceAccountableUserId: null,
      usersById,
    });

    expect(view!.accountable).toBeNull();
  });

  it('resolves the lead, orders members lead-first, and tolerates a lead-less team', () => {
    const [noLead, withLead] = buildTeamViews({
      teams: [
        teamRow('deal-desk', 'Deal Desk', null, null),
        teamRow('revenue-ops', 'Revenue Ops', 'revenue-lead', null),
      ],
      agents: [
        agentRow('zeta-analyst', 'Zeta Analyst', 'revenue-ops'),
        agentRow('revenue-lead', 'Revenue Lead', 'revenue-ops'),
        agentRow('alpha-analyst', 'Alpha Analyst', 'revenue-ops'),
        agentRow('hiring-manager', 'Hiring Manager', null),
      ],
      workspaceAccountableUserId: null,
      usersById,
    });

    expect(withLead!.lead?.slug).toBe('revenue-lead');
    expect(withLead!.members.map(m => m.slug)).toEqual(['revenue-lead', 'alpha-analyst', 'zeta-analyst']);
    expect(noLead!.lead).toBeNull();
    expect(noLead!.members).toEqual([]);
  });

  it('treats a dangling leadAgentSlug as "no lead yet" instead of crashing', () => {
    const [view] = buildTeamViews({
      teams: [teamRow('revenue-ops', 'Revenue Ops', 'gone-agent', null)],
      agents: [],
      workspaceAccountableUserId: null,
      usersById,
    });

    expect(view!.lead).toBeNull();
    expect(view!.leadAgentSlug).toBe('gone-agent');
  });
});

describe('TeamService against the DB', () => {
  beforeEach(async () => {
    await db.delete(teamSchema);
    await db.delete(agentSchema);
    await db.delete(projectSchema);
    await db.delete(tenantAccountSchema);
    await db.delete(userSchema);

    await db.insert(userSchema).values([CHRIS, LILI]);
    await db.insert(tenantAccountSchema).values({ id: 'acct-1', name: 'MetaCTO', slug: 'metacto' });
    await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-1', slug: 'revenue', name: 'Revenue', leadAgentSlug: 'revenue-director', accountableUserId: CHRIS.id });
    await db.insert(agentSchema).values([
      { orgId: ORG, slug: 'revenue-director', name: 'Revenue Director', systemPrompt: 'x', teamSlug: null },
      { orgId: ORG, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'x', teamSlug: 'revenue-ops' },
      { orgId: ORG, slug: 'pipeline-analyst', name: 'Pipeline Analyst', systemPrompt: 'x', teamSlug: 'revenue-ops' },
      { orgId: ORG, slug: 'marketing-lead', name: 'Marketing Lead', systemPrompt: 'x', teamSlug: 'marketing' },
    ]);
    await db.insert(teamSchema).values([
      { orgId: ORG, slug: 'revenue-ops', name: 'Revenue Ops', leadAgentSlug: 'revenue-lead', accountableUserId: null },
      { orgId: ORG, slug: 'marketing', name: 'Marketing', leadAgentSlug: 'marketing-lead', accountableUserId: LILI.id },
    ]);
  });

  afterAll(async () => {
    await db.delete(teamSchema);
    await db.delete(agentSchema);
    await db.delete(projectSchema);
    await db.delete(tenantAccountSchema);
    await db.delete(userSchema);
  });

  it('listTeams resolves leads, members, and inherited vs explicit owners', async () => {
    const views = await listTeams(ORG);

    expect(views.map(v => v.slug)).toEqual(['marketing', 'revenue-ops']);

    const [marketing, revenueOps] = views;

    expect(marketing!.accountable).toMatchObject({ email: LILI.email, name: 'Lili Chen', source: 'team' });
    expect(revenueOps!.accountable).toMatchObject({ email: CHRIS.email, name: 'Chris Fitkin', source: 'workspace' });
    expect(revenueOps!.lead?.name).toBe('Revenue Lead');
    expect(revenueOps!.members.map(m => m.slug)).toEqual(['revenue-lead', 'pipeline-analyst']);
  });

  it('changing the workspace default re-resolves inheriting teams only (acceptance #7)', async () => {
    await db.update(projectSchema).set({ accountableUserId: LILI.id });
    const views = await listTeams(ORG);

    expect(views.find(v => v.slug === 'revenue-ops')!.accountable).toMatchObject({ email: LILI.email, source: 'workspace' });
    // The explicit override is untouched.
    expect(views.find(v => v.slug === 'marketing')!.accountable).toMatchObject({ email: LILI.email, source: 'team' });
  });

  it('getTeam returns one resolved view, and null for an unknown slug', async () => {
    const view = await getTeam(ORG, 'revenue-ops');

    expect(view).toMatchObject({ slug: 'revenue-ops', leadAgentSlug: 'revenue-lead' });
    expect(view!.accountable?.source).toBe('workspace');
    expect(await getTeam(ORG, 'nope')).toBeNull();
  });

  it('getWorkspaceLead resolves the project-level lead + default owner', async () => {
    const ws = await getWorkspaceLead(ORG);

    expect(ws.lead?.slug).toBe('revenue-director');
    expect(ws.accountable).toMatchObject({ email: CHRIS.email, source: 'workspace' });
  });

  it('is graceful for an org with no project row and no teams', async () => {
    expect(await listTeams('org_empty')).toEqual([]);
    expect(await getWorkspaceLead('org_empty')).toEqual({ lead: null, leadAgentSlug: null, accountable: null });
  });
});
