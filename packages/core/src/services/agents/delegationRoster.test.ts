/**
 * Routing is delegation (agent-chat-surface.md §9): a lead's roster derives
 * from the registry — children, then (for the workspace lead) every team's
 * lead and members, then (for a team lead) its own team's members — never
 * from a hand-written `subagents` list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, teamSchema, tenantAccountSchema } = await import('@/models/Schema');
const { buildDelegationRoster, deriveDelegationRoster } = await import('@/services/agents/delegationRoster');

const ORG = 'proj_roster_test';

async function seed() {
  await db.delete(agentSchema);
  await db.delete(teamSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct_roster', name: 'Metacto', slug: 'metacto-roster' } as never);
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_roster', slug: 'roster', name: 'Roster', leadAgentSlug: 'revenue-director' } as never);
  const agent = (slug: string, name: string, extra: Record<string, unknown> = {}) => ({ orgId: ORG, projectId: ORG, slug, name, systemPrompt: `You are ${name}.`, ...extra });
  await db.insert(agentSchema).values([
    agent('revenue-director', 'Revenue Director'),
    agent('revenue-lead', 'RevOps Lead', { teamSlug: 'revops' }),
    agent('pipeline-analyst', 'Pipeline Analyst', { teamSlug: 'revops', description: 'Pipeline health' }),
    agent('proposal-writer', 'Proposal Writer', { teamSlug: 'deal-desk' }),
    agent('ghost-writer', 'Ghost Writer', { parentAgentSlug: 'revenue-director' }),
    agent('marketing-intern', 'Marketing Intern', { teamSlug: 'marketing' }),
  ] as never[]);
  await db.insert(teamSchema).values([
    { orgId: ORG, projectId: ORG, slug: 'revops', name: 'RevOps', leadAgentSlug: 'revenue-lead', description: 'pipeline and follow-ups' },
    { orgId: ORG, projectId: ORG, slug: 'deal-desk', name: 'Deal Desk', leadAgentSlug: 'proposal-writer' },
    { orgId: ORG, projectId: ORG, slug: 'marketing', name: 'Marketing', leadAgentSlug: null },
  ] as never[]);
}

beforeEach(seed);

describe('deriveDelegationRoster', () => {
  it('the workspace lead reaches its children, every team lead, and every team member — once each — and names lead-less teams', async () => {
    const [lead] = await db.select().from(agentSchema).where((await import('drizzle-orm')).eq(agentSchema.slug, 'revenue-director'));
    const roster = await deriveDelegationRoster(ORG, lead!);

    expect(roster.isWorkspaceLead).toBe(true);
    expect(roster.delegates.map(d => `${d.slug}:${d.source}`)).toEqual([
      'ghost-writer:child',
      'revenue-lead:team-lead',
      'proposal-writer:team-lead',
      'pipeline-analyst:team-member',
      'marketing-intern:team-member',
    ]);
    expect(roster.delegates.find(d => d.slug === 'revenue-lead')!.description).toContain('lead of the RevOps team');
    expect(roster.delegates.find(d => d.slug === 'pipeline-analyst')!.description).toContain('RevOps team');
    expect(roster.leadlessTeams).toEqual(['Marketing']);
  });

  it('a team lead reaches only its own team members, and is not the workspace lead', async () => {
    const [lead] = await db.select().from(agentSchema).where((await import('drizzle-orm')).eq(agentSchema.slug, 'revenue-lead'));
    const roster = await deriveDelegationRoster(ORG, lead!);

    expect(roster.isWorkspaceLead).toBe(false);
    expect(roster.delegates.map(d => d.slug)).toEqual(['pipeline-analyst']);
    expect(roster.leadlessTeams).toEqual([]);
  });

  it('a specialist with no team and no children has nobody to delegate to', async () => {
    const [lead] = await db.select().from(agentSchema).where((await import('drizzle-orm')).eq(agentSchema.slug, 'marketing-intern'));
    const roster = await deriveDelegationRoster(ORG, lead!);

    expect(roster.delegates).toEqual([]);
  });
});

describe('buildDelegationRoster (pure)', () => {
  it('never lists the lead itself and prefers the child entry when a member is also a child', () => {
    const lead = { slug: 'boss' } as never;
    const child = { slug: 'x', name: 'X', description: 'child desc', systemPrompt: null, teamSlug: 't', parentAgentSlug: 'boss' } as never;
    const roster = buildDelegationRoster({
      lead,
      children: [child],
      teams: [{ slug: 't', name: 'T', leadAgentSlug: 'boss', description: null } as never],
      teamAgents: [child, { slug: 'boss', name: 'Boss', teamSlug: 't' } as never],
      isWorkspaceLead: false,
    });

    expect(roster.delegates).toHaveLength(1);
    expect(roster.delegates[0]).toMatchObject({ slug: 'x', source: 'child', description: 'child desc', systemPrompt: 'You are X.' });
  });
});
