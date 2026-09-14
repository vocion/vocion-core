import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  actionRunSchema,
  agentSchema,
  missionRunSchema,
  userActivityEventSchema,
} = await import('@/models/Schema');
const {
  agentSlugFromPrincipal,
  bucketSnoozeHorizon,
  resolveRunAgentSlug,
  trackReviewDecision,
  trackReviewFeedback,
  trackReviewSnooze,
} = await import('./attribution');

const ORG_A = 'proj_attr_a';
const ORG_B = 'proj_attr_b';

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(actionRunSchema);
  await db.delete(missionRunSchema);
  await db.delete(agentSchema);
});

describe('agentSlugFromPrincipal', () => {
  it('parses agent principals and rejects everything else', () => {
    expect(agentSlugFromPrincipal('agent:revenue-lead')).toBe('revenue-lead');
    expect(agentSlugFromPrincipal('usr-123')).toBeNull();
    expect(agentSlugFromPrincipal('token:abc')).toBeNull();
    expect(agentSlugFromPrincipal(null)).toBeNull();
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
    const [run] = await db
      .insert(actionRunSchema)
      .values({ orgId: ORG_A, actionId: 'gmail.send', invokedBy: 'agent:outreach-drafter' })
      .returning({ id: actionRunSchema.id });

    await trackReviewDecision(
      { orgId: ORG_A, userId: 'usr-reviewer' },
      { kind: 'action', id: run!.id },
      'approved',
      { latencyMs: 12_000 },
    );

    const events = await db.select().from(userActivityEventSchema);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: ORG_A,
      userId: 'usr-reviewer',
      agentSlug: 'outreach-drafter',
      eventType: 'review.decided',
      resourceType: 'action_run',
      resourceId: String(run!.id),
      metadata: { kind: 'action', decision: 'approved', latencyMs: 12_000 },
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
    await trackReviewDecision(
      { orgId: ORG_A, userId: 'usr-1' },
      { kind: 'action', id: 999_999 },
      'rejected',
    );
    const events = await db.select().from(userActivityEventSchema);

    expect(events).toHaveLength(1);
    expect(events[0]!.agentSlug).toBeNull();
  });
});

describe('bucketSnoozeHorizon', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');
  const plus = (ms: number) => new Date(now.getTime() + ms);
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it('buckets each horizon by how far out the item was pushed', () => {
    expect(bucketSnoozeHorizon(plus(30 * 60 * 1000), now)).toBe('under_4h');
    expect(bucketSnoozeHorizon(plus(6 * HOUR), now)).toBe('up_to_1d');
    expect(bucketSnoozeHorizon(plus(3 * DAY), now)).toBe('up_to_1w');
    expect(bucketSnoozeHorizon(plus(30 * DAY), now)).toBe('over_1w');
  });

  it('keeps the UI presets on the inclusive side of each bound', () => {
    // Tomorrow, 3 days, next week — the three buttons the review card offers.
    expect(bucketSnoozeHorizon(plus(DAY), now)).toBe('up_to_1d');
    expect(bucketSnoozeHorizon(plus(3 * DAY), now)).toBe('up_to_1w');
    expect(bucketSnoozeHorizon(plus(7 * DAY), now)).toBe('up_to_1w');
    // And a hair past a bound falls into the next bucket.
    expect(bucketSnoozeHorizon(plus(DAY + 1), now)).toBe('up_to_1w');
    expect(bucketSnoozeHorizon(plus(7 * DAY + 1), now)).toBe('over_1w');
    expect(bucketSnoozeHorizon(plus(4 * HOUR), now)).toBe('up_to_1d');
  });

  it('treats a past or present snooze as the shortest horizon rather than failing', () => {
    expect(bucketSnoozeHorizon(now, now)).toBe('under_4h');
    expect(bucketSnoozeHorizon(plus(-DAY), now)).toBe('under_4h');
  });
});

describe('trackReviewSnooze', () => {
  it('records an agent-attributed deferral with kind and bucketed horizon', async () => {
    const [run] = await db
      .insert(actionRunSchema)
      .values({ orgId: ORG_A, actionId: 'gmail.send', invokedBy: 'agent:outreach-drafter' })
      .returning({ id: actionRunSchema.id });

    await trackReviewSnooze(
      { orgId: ORG_A, userId: 'usr-reviewer' },
      { kind: 'action', id: run!.id },
      new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    );

    const events = await db.select().from(userActivityEventSchema);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      orgId: ORG_A,
      userId: 'usr-reviewer',
      agentSlug: 'outreach-drafter',
      eventType: 'review.snoozed',
      resourceType: 'action_run',
      resourceId: String(run!.id),
      metadata: { kind: 'action', deferredFor: 'up_to_1w' },
    });
  });

  it('records one event per deferral instead of overwriting the last one', async () => {
    const [run] = await db
      .insert(missionRunSchema)
      .values({ orgId: ORG_A, title: 't', brief: 'b', team: { lead: 'revenue-lead', members: [] } })
      .returning({ id: missionRunSchema.id });
    const item = { kind: 'mission' as const, id: run!.id };

    await trackReviewSnooze({ orgId: ORG_A, userId: 'usr-1' }, item, new Date(Date.now() + 60_000));
    await trackReviewSnooze({ orgId: ORG_A, userId: 'usr-1' }, item, new Date(Date.now() + 30 * 86_400_000));

    const events = await db.select().from(userActivityEventSchema);

    expect(events).toHaveLength(2);
    expect(events.map(e => (e.metadata as { deferredFor: string }).deferredFor)).toEqual(['under_4h', 'over_1w']);
    expect(events.every(e => e.agentSlug === 'revenue-lead')).toBe(true);
  });

  it('drops the event for a system actor, since adoption measures humans', async () => {
    await trackReviewSnooze(
      { orgId: ORG_A, userId: 'web' },
      { kind: 'workflow', id: 1 },
      new Date(Date.now() + 60_000),
    );

    expect(await db.select().from(userActivityEventSchema)).toHaveLength(0);
  });

  it('leaves agentSlug null rather than guessing, and never throws', async () => {
    await trackReviewSnooze(
      { orgId: ORG_A, userId: 'usr-1' },
      { kind: 'action', id: 999_999 },
      new Date(Date.now() + 60_000),
    );
    const events = await db.select().from(userActivityEventSchema);

    expect(events).toHaveLength(1);
    expect(events[0]!.agentSlug).toBeNull();
  });
});
