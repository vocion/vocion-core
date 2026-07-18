import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  actionRunSchema,
  agentSchema,
  missionRunSchema,
  skillRunSchema,
  skillSchema,
  userActivityEventSchema,
} = await import('@/models/Schema');
const {
  agentSlugFromPrincipal,
  resolveRunAgentSlug,
  resolveSkillAgentSlug,
  trackReviewDecision,
  trackReviewFeedback,
} = await import('./attribution');

const ORG_A = 'proj_attr_a';
const ORG_B = 'proj_attr_b';

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(actionRunSchema);
  await db.delete(missionRunSchema);
  await db.delete(skillRunSchema);
  await db.delete(skillSchema);
  await db.delete(agentSchema);
});

async function seedSkillWithOwners(orgId: string, skillSlug: string, ownerSlugs: string[]): Promise<number> {
  const [skill] = await db
    .insert(skillSchema)
    .values({ orgId, slug: skillSlug, name: skillSlug, promptTemplate: 'noop' })
    .returning({ id: skillSchema.id });
  for (const slug of ownerSlugs) {
    await db.insert(agentSchema).values({
      orgId,
      slug,
      name: slug,
      systemPrompt: 'noop',
      skillSlugs: [skillSlug],
    });
  }
  return skill!.id;
}

describe('agentSlugFromPrincipal', () => {
  it('parses agent principals and rejects everything else', () => {
    expect(agentSlugFromPrincipal('agent:revenue-lead')).toBe('revenue-lead');
    expect(agentSlugFromPrincipal('usr-123')).toBeNull();
    expect(agentSlugFromPrincipal('token:abc')).toBeNull();
    expect(agentSlugFromPrincipal(null)).toBeNull();
  });
});

describe('resolveSkillAgentSlug', () => {
  it('attributes a skill owned by exactly one agent', async () => {
    const skillId = await seedSkillWithOwners(ORG_A, 'draft-email', ['outreach-drafter']);
    expect(await resolveSkillAgentSlug(ORG_A, skillId)).toBe('outreach-drafter');
  });

  it('returns null when several agents share the skill (no guessing)', async () => {
    const skillId = await seedSkillWithOwners(ORG_A, 'shared-skill', ['agent-x', 'agent-y']);
    expect(await resolveSkillAgentSlug(ORG_A, skillId)).toBeNull();
  });

  it('never attributes across orgs', async () => {
    const skillId = await seedSkillWithOwners(ORG_A, 'draft-email', ['outreach-drafter']);
    // Same skill id queried under org B — the org filter must blank it.
    expect(await resolveSkillAgentSlug(ORG_B, skillId)).toBeNull();
  });
});

describe('resolveRunAgentSlug', () => {
  it('mission runs attribute to the team lead', async () => {
    const [run] = await db
      .insert(missionRunSchema)
      .values({ orgId: ORG_A, title: 't', brief: 'b', team: { lead: 'revenue-lead', members: [] } })
      .returning({ id: missionRunSchema.id });
    expect(await resolveRunAgentSlug(ORG_A, 'mission', run!.id)).toBe('revenue-lead');
    // Cross-org lookups return null, never another tenant's lead.
    expect(await resolveRunAgentSlug(ORG_B, 'mission', run!.id)).toBeNull();
  });

  it('action runs attribute to the proposing agent principal only', async () => {
    const [agentRun] = await db
      .insert(actionRunSchema)
      .values({ orgId: ORG_A, actionId: 'hubspot.update', invokedBy: 'agent:pipeline-analyst' })
      .returning({ id: actionRunSchema.id });
    const [userRun] = await db
      .insert(actionRunSchema)
      .values({ orgId: ORG_A, actionId: 'hubspot.update', invokedBy: 'usr-1' })
      .returning({ id: actionRunSchema.id });
    expect(await resolveRunAgentSlug(ORG_A, 'action', agentRun!.id)).toBe('pipeline-analyst');
    expect(await resolveRunAgentSlug(ORG_A, 'action', userRun!.id)).toBeNull();
  });

  it('workflow runs stay unattributed (multi-agent steps)', async () => {
    expect(await resolveRunAgentSlug(ORG_A, 'workflow', 1)).toBeNull();
  });
});

describe('trackReviewDecision / trackReviewFeedback', () => {
  it('records an agent-attributed decision with kind, decision, and latency', async () => {
    const skillId = await seedSkillWithOwners(ORG_A, 'draft-email', ['outreach-drafter']);
    const [run] = await db
      .insert(skillRunSchema)
      .values({ orgId: ORG_A, skillId, createdBy: 'usr-1' })
      .returning({ id: skillRunSchema.id });

    await trackReviewDecision(
      { orgId: ORG_A, userId: 'usr-reviewer' },
      { kind: 'skill', id: run!.id },
      'approved',
      { latencyMs: 12_000, skillId },
    );

    const events = await db.select().from(userActivityEventSchema);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: ORG_A,
      userId: 'usr-reviewer',
      agentSlug: 'outreach-drafter',
      eventType: 'review.decided',
      resourceType: 'skill_run',
      resourceId: String(run!.id),
      metadata: { kind: 'skill', decision: 'approved', latencyMs: 12_000 },
    });
  });

  it('records agent-attributed feedback for mission runs via the team lead', async () => {
    const [run] = await db
      .insert(missionRunSchema)
      .values({ orgId: ORG_A, title: 't', brief: 'b', team: { lead: 'revenue-lead', members: [] } })
      .returning({ id: missionRunSchema.id });

    await trackReviewFeedback(
      { orgId: ORG_A, userId: 'usr-1' },
      { kind: 'mission', id: run!.id },
      { rating: 'up', hasNote: false },
    );

    const events = await db.select().from(userActivityEventSchema);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agentSlug: 'revenue-lead',
      eventType: 'review.feedback',
      metadata: { kind: 'mission', rating: 'up', hasNote: false },
    });
  });

  it('leaves agentSlug null rather than guessing, and never throws', async () => {
    const skillId = await seedSkillWithOwners(ORG_A, 'shared-skill', ['agent-x', 'agent-y']);
    await trackReviewDecision(
      { orgId: ORG_A, userId: 'usr-1' },
      { kind: 'skill', id: 999_999 },
      'rejected',
      { skillId },
    );
    const events = await db.select().from(userActivityEventSchema);
    expect(events).toHaveLength(1);
    expect(events[0]!.agentSlug).toBeNull();
  });
});
