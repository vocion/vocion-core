import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `team.hire_agent` — the team extending itself, and the two things that stop
 * it running away: the allowance every hire carries, and the workspace's own
 * spend. The interesting assertions here are the refusals, because an action
 * that can add capability is only as safe as the cases where it declines.
 */

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema, agentSchema, projectSchema, teamSchema, tenantAccountSchema } = await import('@/models/Schema');
const { teamHireAgentAction: hireAction } = await import('./team-hire-agent');
const { setLimits, workspaceHeadroom } = await import('@/services/BudgetService');

const ORG = 'org_hire_test';
const ctx = { orgId: ORG, invokedBy: 'agent:growth-lead' };

/** A catalog role that ships today and is not in the base pack, so nothing else hires it. */
const ROLE = 'seo-specialist';

async function agents(): Promise<string[]> {
  const rows = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(eq(agentSchema.orgId, ORG));
  return rows.map(r => r.slug).sort();
}

async function teams(): Promise<string[]> {
  const rows = await db.select({ slug: teamSchema.slug }).from(teamSchema).where(eq(teamSchema.orgId, ORG));
  return rows.map(r => r.slug).sort();
}

beforeAll(async () => {
  // `team.project_id` is a real foreign key, and a hire creates a team row.
  await db.insert(tenantAccountSchema).values({ id: 'acct-hire', name: 'Northwind', slug: 'northwind-hire' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-hire', slug: 'northwind-growth', name: 'Northwind Growth' });
});

beforeEach(async () => {
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.delete(teamSchema).where(eq(teamSchema.orgId, ORG));
  await db.delete(agentBudgetSchema).where(eq(agentBudgetSchema.orgId, ORG));
});

describe('what the hire refuses before a person is ever asked', () => {
  it('refuses a role the catalog does not ship, and names some that it does', async () => {
    const refusal = await hireAction.precheck!(ctx, { slug: 'chief-vibes-officer', dailyCentsLimit: 500, reason: 'vibes' });

    expect(refusal).toContain('no catalog role "chief-vibes-officer"');
    expect(refusal).toContain('the catalogue has');
  });

  it('refuses a role already on the team rather than proposing a duplicate', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, projectId: ORG, slug: ROLE, name: 'SEO Specialist', systemPrompt: 'x' });

    const refusal = await hireAction.precheck!(ctx, { slug: ROLE, dailyCentsLimit: 500, reason: 'we need search' });

    expect(refusal).toContain('already on this team');
  });

  it('refuses while the workspace has already spent its committed allowance', async () => {
    await setLimits({ orgId: ORG, agentSlug: 'growth-lead', softCentsLimit: 1000, hardCentsLimit: 5000 });
    await db.update(agentBudgetSchema).set({ currentCents: 1000 }).where(eq(agentBudgetSchema.orgId, ORG));

    const refusal = await hireAction.precheck!(ctx, { slug: ROLE, dailyCentsLimit: 200, reason: 'we need search' });

    expect(refusal).toContain('$10.00 of its $10.00 daily allowance');
    expect(refusal).toContain('Raise the allowance');
  });

  it('refuses an allowance bigger than what is left of the workspace\'s own', async () => {
    await setLimits({ orgId: ORG, agentSlug: 'growth-lead', softCentsLimit: 1000, hardCentsLimit: 5000 });
    await db.update(agentBudgetSchema).set({ currentCents: 800 }).where(eq(agentBudgetSchema.orgId, ORG));

    const refusal = await hireAction.precheck!(ctx, { slug: ROLE, dailyCentsLimit: 500, reason: 'we need search' });

    expect(refusal).toContain('$5.00 a day and only $2.00');
  });

  it('lets a hire through when the workspace has set no budgets at all — opt-in, and it says so', async () => {
    const refusal = await hireAction.precheck!(ctx, { slug: ROLE, dailyCentsLimit: 500, reason: 'we need search' });

    expect(refusal).toBeUndefined();

    const card = await hireAction.reviewCard!(ctx, { slug: ROLE, dailyCentsLimit: 500, reason: 'we need search' });

    expect(card.fields.find(f => f.label === 'Allowance')!.value).toContain('No other agent here has a budget');
  });
});

describe('the card a person decides on', () => {
  it('leads with the role, the team and what it costs a day', async () => {
    const card = await hireAction.reviewCard!(ctx, { slug: ROLE, dailyCentsLimit: 750, reason: 'nobody owns which page answers which question' });

    expect(card.title).toBe('Hire SEO Specialist');
    expect(card.headline).toContain('$7.50 a day');
    expect(card.summary).toBe('nobody owns which page answers which question');
    expect(card.badges?.map(b => b.label)).toContain('Reversible');
    expect(card.nextAction).toContain('Undo removes all three');
  });
});

describe('hiring, and putting it back', () => {
  it('creates the agent, its team and its daily cap', async () => {
    const input = { slug: ROLE, dailyCentsLimit: 750, reason: 'search has no owner' };
    const result = await hireAction.execute(ctx, input);

    expect(result).toMatchObject({ status: 'hired', hired: true, slug: ROLE, dailyCentsLimit: 750 });
    expect(await agents()).toEqual([ROLE]);
    // The entry's team comes with it, so the org chart has no orphan strip.
    expect(result.teamCreated).toBe('ai-visibility');
    expect(await teams()).toEqual(['ai-visibility']);

    const headroom = await workspaceHeadroom(ORG);

    expect(headroom).toMatchObject({ agents: 1, committedCents: 750, spentCents: 0, overSoft: false });
  });

  it('undo removes the agent, the budget and the team the hire created', async () => {
    const input = { slug: ROLE, dailyCentsLimit: 750, reason: 'search has no owner' };
    const result = await hireAction.execute(ctx, input);

    await hireAction.undo!(ctx, input, result);

    expect(await agents()).toEqual([]);
    expect(await teams()).toEqual([]);
    expect(await workspaceHeadroom(ORG)).toMatchObject({ agents: 0, committedCents: 0 });
  });

  it('undo leaves a team the hire did NOT create alone', async () => {
    await db.insert(teamSchema).values({ orgId: ORG, projectId: ORG, slug: 'ai-visibility', name: 'AI Visibility' });
    const input = { slug: ROLE, dailyCentsLimit: 750, reason: 'search has no owner' };
    const result = await hireAction.execute(ctx, input);

    expect(result.teamCreated).toBeNull();

    await hireAction.undo!(ctx, input, result);

    expect(await agents()).toEqual([]);
    expect(await teams()).toEqual(['ai-visibility']);
  });
});

describe('where it stands on the ladder', () => {
  it('is reversible and internal, and never claims the learning dial', async () => {
    const { isSelfUpdate, selfUpdateKind } = await import('./selfUpdate');

    expect(hireAction.external).toBe(false);
    expect(hireAction.undo).toBeTypeOf('function');
    expect(hireAction.selfImproving).toBeUndefined();
    expect(isSelfUpdate('team.hire_agent')).toBe(true);
    expect(selfUpdateKind('team.hire_agent')!.onTheDial).toBe(false);
  });

  it('is registered, so propose_action and a trust rule both reach it', async () => {
    const { getAction } = await import('./registry');

    expect(getAction('team.hire_agent')).toBe(hireAction);
  });

  it('asks about a role once a month, not once a week', () => {
    expect(hireAction.dedupKeyFor!({ slug: ROLE, dailyCentsLimit: 1, reason: 'x' })).toBe(`team.hire_agent:${ROLE}`);
    expect(hireAction.dedupAgainstDecided).toMatchObject({ reproposeAfterDays: 30 });
  });
});
