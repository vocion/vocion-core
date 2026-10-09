/**
 * The clock on Needs you, against a real (PGlite) database: deadlines open,
 * the owner hears before the deadline, the default applies only where the
 * trust ladder allows it or it can be undone, everything else is held and
 * escalated again, and nothing crosses a workspace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const emitted = vi.hoisted(() => [] as Array<{ orgId: string; type: string; payload: Record<string, unknown> }>);
vi.mock('@/services/EventService', () => ({
  ASK_DECIDED: 'ask.decided',
  emitEvent: vi.fn(async (e: { orgId: string; type: string; payload: Record<string, unknown> }) => {
    emitted.push(e);
    return { eventId: emitted.length, deduped: false, triggered: [], skipped: [] };
  }),
}));

const people = vi.hoisted(() => new Map<string, Array<{ userId: string; email: string; name: string | null; role: 'admin' | 'member' }>>());
vi.mock('@/services/notifications/people', () => ({ workspacePeople: vi.fn(async (orgId: string) => people.get(orgId) ?? []) }));

const paused = vi.hoisted(() => ({ value: null as null | { by: string } }));
vi.mock('@/services/workspacePause', () => ({
  readWorkspacePause: vi.fn(async () => paused.value),
  assertWorkspaceRunning: vi.fn(async () => {}),
}));

const actions = vi.hoisted(() => ({
  executeAction: vi.fn(async (runId: number) => ({ runId, status: 'done', result: {} })),
  rejectAction: vi.fn(async () => {}),
  proposeAction: vi.fn(async () => ({ runId: 999, status: 'done' })),
}));
vi.mock('@/services/ActionService', () => actions);

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, conversationSchema, decisionDeadlineSchema, projectSchema, teamSchema, tenantAccountSchema, userSchema, agentSchema } = await import('@/models/Schema');
const { and, eq } = await import('drizzle-orm');
const svc = await import('./DecisionClockService');
const { DEFAULT_DECIDER } = await import('@/libs/needsYou/deadlines');

const ORG = 'org_clock_a';
const OTHER = 'org_clock_b';
const H = 60 * 60_000;
const T0 = new Date('2026-10-01T09:00:00.000Z');

async function seedWorkspace(orgId: string, accountable: string | null) {
  await db.insert(tenantAccountSchema).values({ id: `acct_${orgId}`, name: orgId, slug: `acct-${orgId}` }).onConflictDoNothing();
  await db.insert(projectSchema).values({ id: orgId, accountId: `acct_${orgId}`, slug: orgId, name: `Workspace ${orgId}`, accountableUserId: accountable }).onConflictDoNothing();
}

async function fileAsk(orgId: string, over: Partial<typeof askSchema.$inferInsert> = {}) {
  const [row] = await db.insert(askSchema).values({
    orgId,
    kind: 'approval',
    title: 'Renew the Northwind support contract?',
    options: [{ id: 'renew', label: 'Approve', recommended: true }, { id: 'decline', label: 'Decline' }],
    risk: 'low',
    createdAt: T0,
    updatedAt: T0,
    ...over,
  }).returning();
  return row!;
}

async function propose(orgId: string, actionId: string, suggestedDecision: 'approve' | 'reject' | null, input: Record<string, unknown> = {}) {
  const [row] = await db.insert(actionRunSchema).values({
    orgId,
    actionId,
    input,
    status: 'pending',
    invokedBy: 'agent:ops-lead',
    proposal: { confidence: 0.7, agentSlug: 'ops-lead', ...(suggestedDecision ? { suggestedDecision, suggestedDecisionReason: 'fits the rule' } : {}) },
    createdAt: T0,
  }).returning();
  return row!;
}

async function clockOf(kind: 'ask' | 'proposal', id: number, orgId = ORG) {
  return (await svc.getDecisionClock(orgId, kind, id))!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  emitted.length = 0;
  paused.value = null;
  await db.delete(decisionDeadlineSchema);
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
  await db.delete(teamSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values([
    { id: 'usr-ada', email: 'ada@northwind.example', name: 'Ada' },
    { id: 'usr-ben', email: 'ben@northwind.example', name: 'Ben' },
    { id: 'usr-cy', email: 'cy@kestrel.example', name: 'Cy' },
  ]);
  await seedWorkspace(ORG, 'usr-ada');
  await seedWorkspace(OTHER, 'usr-cy');
  people.set(ORG, [
    { userId: 'usr-ada', email: 'ada@northwind.example', name: 'Ada', role: 'admin' },
    { userId: 'usr-ben', email: 'ben@northwind.example', name: 'Ben', role: 'member' },
  ]);
  people.set(OTHER, [{ userId: 'usr-cy', email: 'cy@kestrel.example', name: 'Cy', role: 'admin' }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('opening clocks', () => {
  it('opens one per open ask and pending proposal, with the recommended option as the default', async () => {
    const ask = await fileAsk(ORG);
    const bare = await fileAsk(ORG, { title: 'Which venue for the Acme offsite?', kind: 'input', options: [] });
    const decided = await fileAsk(ORG, { title: 'Old question', status: 'approved', decision: 'approve' });
    const run = await propose(ORG, 'ask.file', 'reject');

    const opened = await svc.openClocks({ now: T0 });

    expect(opened).toBe(3);
    expect(await clockOf('ask', ask.id)).toMatchObject({ defaultOption: 'renew', defaultLabel: 'Approve', status: 'open' });
    expect(await clockOf('ask', bare.id)).toMatchObject({ defaultOption: null, defaultLabel: null });
    expect(await svc.getDecisionClock(ORG, 'ask', decided.id)).toBeNull();
    expect(await clockOf('proposal', run.id)).toMatchObject({ defaultOption: 'reject', defaultLabel: 'Decline' });

    // Run again: nothing moves.
    expect(await svc.openClocks({ now: new Date(T0.getTime() + H) })).toBe(0);
  });

  it('opens only the workspace it is asked about', async () => {
    await fileAsk(ORG);
    const theirs = await fileAsk(OTHER);

    await svc.openClocks({ orgId: ORG, now: T0 });

    expect(await svc.getDecisionClock(OTHER, 'ask', theirs.id)).toBeNull();
    expect((await svc.runningClocks(OTHER)).size).toBe(0);
    expect((await svc.runningClocks(ORG)).size).toBe(1);
  });
});

/**
 * Founder, 2026-10-09: "Default in 23h: Connect GitHub" on a setup step. A
 * setup step, and a question asked mid-objective, wait for their person: no
 * clock, no default that applies itself — unless the asker set a close date.
 */
describe('a setup step waits for its person', () => {
  it('opens no clock on a setup step, nor on a question in a conversation mid-objective', async () => {
    const setup = await fileAsk(ORG, { title: 'Connect GitHub', kind: 'setup' });
    const [conv] = await db.insert(conversationSchema).values({ orgId: ORG, projectId: ORG, agentSlug: 'lead', title: 'setup my software factory', objective: { kind: 'setup', plugin: 'software-factory', state: 'running', startedAt: T0.toISOString() } }).returning({ id: conversationSchema.id });
    const midObjective = await fileAsk(ORG, { title: 'Which repositories should the factory include?', conversationId: conv!.id });
    const plain = await fileAsk(ORG);

    await svc.openClocks({ now: T0 });

    expect(await svc.getDecisionClock(ORG, 'ask', setup.id)).toBeNull();
    expect(await svc.getDecisionClock(ORG, 'ask', midObjective.id)).toBeNull();
    expect(await clockOf('ask', plain.id)).toMatchObject({ defaultOption: 'renew' });

    await db.delete(conversationSchema);
  });

  it('keeps a clock where a policy set one explicitly', async () => {
    const due = await fileAsk(ORG, { title: 'Connect GitHub before the audit', kind: 'setup', dueAt: new Date(T0.getTime() + 48 * H) });

    await svc.openClocks({ now: T0 });

    expect(await clockOf('ask', due.id)).toMatchObject({ status: 'open' });
  });

  it('never applies a default to a setup step whose clock was opened before this rule', async () => {
    const setup = await fileAsk(ORG, { title: 'Connect GitHub', kind: 'setup' });
    await db.insert(decisionDeadlineSchema).values({ orgId: ORG, subjectKind: 'ask', subjectId: setup.id, deadlineAt: new Date(T0.getTime() + H), escalateAt: T0, nextAt: T0, defaultOption: 'renew', defaultLabel: 'Approve', escalations: 1, createdAt: T0, updatedAt: T0 });

    await svc.sweepDecisionClocks({ now: new Date(T0.getTime() + 2 * H) });

    const [row] = await db.select().from(askSchema).where(eq(askSchema.id, setup.id));

    expect(row!.status).toBe('open');
    expect((await clockOf('ask', setup.id)).status).toBe('held');
  });
});

describe('escalation before the deadline', () => {
  it('tells the accountable owner once, in one event covering every decision due', async () => {
    await fileAsk(ORG);
    await fileAsk(ORG, { title: 'Publish the Contoso case study?' });
    await svc.sweepDecisionClocks({ now: T0 });

    // A low-risk ask is due 24h after it was filed; its owner hears 6h before.
    const at = new Date(T0.getTime() + 18 * H);
    const r = await svc.sweepDecisionClocks({ now: at });

    expect(r.escalated).toBe(2);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ orgId: ORG, type: 'decision.escalated', payload: { ownerUserId: 'usr-ada', ownerSource: 'workspace', count: 2, dueSoon: 2 } });
    expect(String(emitted[0]!.payload.body)).toMatch(/then Approve applies unless you answer/);

    // The same sweep again finds nothing due before the deadline.
    emitted.length = 0;
    await svc.sweepDecisionClocks({ now: new Date(at.getTime() + 60_000) });

    expect(emitted).toHaveLength(0);
  });

  it('goes to the asking team\'s accountable human ahead of the workspace\'s', async () => {
    await db.insert(teamSchema).values({ orgId: ORG, slug: 'ops', name: 'Ops', accountableUserId: 'usr-ben' });
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'ops-lead', name: 'Ops lead', systemPrompt: 'You run ops.', teamSlug: 'ops' } as never);
    await propose(ORG, 'ask.file', 'approve', { title: 'Ask the board', kind: 'approval' });
    await svc.sweepDecisionClocks({ now: T0 });

    await svc.sweepDecisionClocks({ now: new Date(T0.getTime() + 20 * H) });

    expect(emitted[0]?.payload).toMatchObject({ ownerUserId: 'usr-ben', ownerSource: 'team' });
  });
});

describe('at the deadline', () => {
  /** Open every clock, tell every owner, then sweep a minute past the last deadline. */
  async function toDeadline() {
    await svc.sweepDecisionClocks({ now: T0 });
    const clocks = await db.select().from(decisionDeadlineSchema);
    const escalate = Math.max(...clocks.map(c => c.escalateAt.getTime()));
    const deadline = Math.max(...clocks.map(c => c.deadlineAt.getTime()));
    await svc.sweepDecisionClocks({ now: new Date(escalate) });
    emitted.length = 0;
    return svc.sweepDecisionClocks({ now: new Date(deadline + 60_000) });
  }

  it('applies a reversible recommended answer as a recorded decision, never as a person, and says so', async () => {
    const ask = await fileAsk(ORG);

    const r = await toDeadline();

    expect(r.applied).toBe(1);

    const [row] = await db.select().from(askSchema).where(eq(askSchema.id, ask.id));

    expect(row).toMatchObject({ status: 'done', decision: 'renew', decidedBy: DEFAULT_DECIDER });
    expect(row!.decisionNote).toMatch(/Applied by default at its deadline .*Undo reopens it/);
    expect(await clockOf('ask', ask.id)).toMatchObject({ status: 'applied', outcomeReason: expect.stringMatching(/reversible/) });
    expect(emitted.find(e => e.type === 'decision.escalated')?.payload).toMatchObject({ applied: 1, ownerUserId: 'usr-ada' });
    // The deadline is not a person: the answer still announces itself, as `by-default`.
    expect(emitted.find(e => e.type === 'ask.decided')?.payload).toMatchObject({ askId: ask.id, decidedBy: DEFAULT_DECIDER });
  });

  it('holds a high-risk question, leaves it on Needs you and escalates it again tomorrow', async () => {
    const ask = await fileAsk(ORG, { risk: 'high', createdAt: new Date(T0.getTime() - 200 * H) });
    // High-risk: due a week after filing, so it is already past — the clock gives it a full notice first.
    await svc.sweepDecisionClocks({ now: T0 });
    const clock = await clockOf('ask', ask.id);
    const r = await svc.sweepDecisionClocks({ now: new Date(clock.deadlineAt.getTime() + 60_000) });

    expect(r.held).toBe(1);
    expect((await db.select().from(askSchema).where(eq(askSchema.id, ask.id)))[0]!.status).toBe('open');

    const held = await clockOf('ask', ask.id);

    expect(held).toMatchObject({ status: 'held', outcomeReason: expect.stringMatching(/high-risk/), escalations: 2 });
    expect(held.nextAt.getTime() - clock.deadlineAt.getTime()).toBeGreaterThanOrEqual(24 * H);
    expect((await svc.runningClocks(ORG)).get(`ask:${ask.id}`)).toMatchObject({ status: 'held', reason: expect.stringMatching(/high-risk/) });
  });

  it('holds a question with no recommended answer', async () => {
    const ask = await fileAsk(ORG, { options: [] });

    await toDeadline();

    expect(await clockOf('ask', ask.id)).toMatchObject({ status: 'held', outcomeReason: expect.stringMatching(/no recommended answer/) });
  });

  it('never applies a default nobody was told about: it escalates and moves the deadline', async () => {
    const ask = await fileAsk(ORG);
    await svc.openClocks({ now: T0 });

    // The first sweep to see it is already past the deadline.
    const late = new Date(T0.getTime() + 30 * H);
    const r = await svc.sweepDecisionClocks({ now: late });

    expect(r.applied).toBe(0);
    expect(r.escalated).toBe(1);

    const clock = await clockOf('ask', ask.id);

    expect(clock.status).toBe('open');
    expect(clock.deadlineAt.getTime()).toBeGreaterThan(late.getTime());
    expect((await db.select().from(askSchema).where(eq(askSchema.id, ask.id)))[0]!.status).toBe('open');
  });

  it('turns down a proposal the agent itself advised against, as recommended — nothing runs', async () => {
    const run = await propose(ORG, 'ask.file', 'reject', { title: 'Ask the board', kind: 'approval' });

    await toDeadline();

    expect(actions.rejectAction).toHaveBeenCalledWith(run.id, ORG, expect.stringMatching(/Declined by default/), { reviewedBy: DEFAULT_DECIDER });
    expect(actions.executeAction).not.toHaveBeenCalled();
    expect(await clockOf('proposal', run.id)).toMatchObject({ status: 'applied' });
  });

  it('leaves a candidate of a listed type for a person when the agent advised declining it', async () => {
    vi.stubEnv('VOCION_HOLD_DECLINES', 'objects.propose_candidate.event-candidate');
    const run = await propose(ORG, 'objects.propose_candidate', 'reject', { objectType: 'event-candidate', title: 'Baby Time' });

    await toDeadline();

    expect(actions.rejectAction).not.toHaveBeenCalled();
    expect(await clockOf('proposal', run.id)).toMatchObject({ status: 'held', outcomeReason: expect.stringMatching(/keeps declines for a person/) });
  });

  it.each([
    ['nothing is listed', undefined],
    ['only another type is listed', 'objects.propose_candidate.event-candidate'],
  ])('still declines a candidate the agent advised against by default when %s', async (_why, listed) => {
    if (listed) {
      vi.stubEnv('VOCION_HOLD_DECLINES', listed);
    }
    const run = await propose(ORG, 'objects.propose_candidate', 'reject', { objectType: 'request', title: 'Dark mode' });

    await toDeadline();

    expect(actions.rejectAction).toHaveBeenCalledWith(run.id, ORG, expect.stringMatching(/Declined by default/), { reviewedBy: DEFAULT_DECIDER });
    expect(await clockOf('proposal', run.id)).toMatchObject({ status: 'applied' });
  });

  it('still turns down a never-auto send the agent advised against', async () => {
    const run = await propose(ORG, 'gmail.send', 'reject', { to: 'buyer@acme.example', subject: 'Hello', body: 'Hi' });

    await toDeadline();

    expect(actions.rejectAction).toHaveBeenCalledWith(run.id, ORG, expect.stringMatching(/Declined by default/), { reviewedBy: DEFAULT_DECIDER });
    expect(await clockOf('proposal', run.id)).toMatchObject({ status: 'applied' });
  });

  it('releases a reversible, low-risk proposal and stamps it as applied by default', async () => {
    const run = await propose(ORG, 'ask.file', 'approve', { title: 'Ask the board', kind: 'approval' });

    await toDeadline();

    expect(actions.executeAction).toHaveBeenCalledWith(run.id, ORG, { reviewedBy: DEFAULT_DECIDER });

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, run.id));

    expect(row).toMatchObject({ decidedBy: DEFAULT_DECIDER, approvedByAgent: true });
    expect(row!.proposal).toMatchObject({ autoApprovedBy: 'deadline' });
  });

  it('never auto-runs what trust forbids: an irreversible hand-off and a never-auto send both stay', async () => {
    const release = await propose(ORG, 'deploy.release', 'approve', { title: 'Release 3.2', summary: 'Ship it.', recipe: 'deploy' });
    const send = await propose(ORG, 'gmail.send', 'approve', { to: 'buyer@acme.example', subject: 'Hello', body: 'Hi' });

    const r = await toDeadline();

    expect(r.held).toBe(2);
    expect(actions.executeAction).not.toHaveBeenCalled();
    expect(await clockOf('proposal', release.id)).toMatchObject({ status: 'held', outcomeReason: expect.stringMatching(/cannot be undone|high-risk/) });
    expect(await clockOf('proposal', send.id)).toMatchObject({ status: 'held', outcomeReason: expect.stringMatching(/held at approval by the platform/) });
  });

  it('holds everything while the workspace is paused', async () => {
    const ask = await fileAsk(ORG);
    await svc.sweepDecisionClocks({ now: T0 });
    await svc.sweepDecisionClocks({ now: new Date(T0.getTime() + 18 * H) });
    paused.value = { by: 'usr-ada' };

    await svc.sweepDecisionClocks({ now: new Date(T0.getTime() + 25 * H) });

    expect(await clockOf('ask', ask.id)).toMatchObject({ status: 'held', outcomeReason: expect.stringMatching(/workspace is paused/) });
  });

  it('settles the clock when a person decided first', async () => {
    const ask = await fileAsk(ORG);
    await svc.sweepDecisionClocks({ now: T0 });
    await db.update(askSchema).set({ status: 'approved', decision: 'approve', decidedBy: 'usr-ada' }).where(eq(askSchema.id, ask.id));

    const r = await svc.sweepDecisionClocks({ now: new Date(T0.getTime() + 18 * H) });

    expect(r.settled).toBe(1);
    expect(r.escalated).toBe(0);
    expect(await clockOf('ask', ask.id)).toMatchObject({ status: 'settled' });
  });
});

describe('undoAskDefault', () => {
  it('reopens an answer the deadline gave, and its default never applies again', async () => {
    const ask = await fileAsk(ORG);
    await svc.sweepDecisionClocks({ now: T0 });
    await svc.sweepDecisionClocks({ now: new Date(T0.getTime() + 18 * H) });
    await svc.sweepDecisionClocks({ now: new Date(T0.getTime() + 24 * H) });

    const reopened = await svc.undoAskDefault({ orgId: ORG, askId: ask.id, by: 'usr-ada', now: new Date(T0.getTime() + 25 * H) });

    expect(reopened).toMatchObject({ status: 'open', decision: null, decidedBy: null });
    expect(await clockOf('ask', ask.id)).toMatchObject({ status: 'held', undoneBy: 'usr-ada' });

    await svc.sweepDecisionClocks({ now: new Date(T0.getTime() + 60 * H) });

    expect((await db.select().from(askSchema).where(eq(askSchema.id, ask.id)))[0]!.status).toBe('open');
    expect(await clockOf('ask', ask.id)).toMatchObject({ status: 'held', outcomeReason: expect.stringMatching(/took the default back/) });
  });

  it('refuses a person\'s own answer, and another workspace\'s ask reads as missing', async () => {
    const mine = await fileAsk(ORG, { status: 'approved', decision: 'approve', decidedBy: 'usr-ada' });
    const theirs = await fileAsk(OTHER, { status: 'done', decision: 'approve', decidedBy: DEFAULT_DECIDER });

    await expect(svc.undoAskDefault({ orgId: ORG, askId: mine.id, by: 'usr-ada' })).rejects.toMatchObject({ status: 409 });
    await expect(svc.undoAskDefault({ orgId: ORG, askId: theirs.id, by: 'usr-ada' })).rejects.toMatchObject({ status: 404 });
    expect((await db.select().from(askSchema).where(and(eq(askSchema.orgId, OTHER), eq(askSchema.id, theirs.id))))[0]!.status).toBe('done');
  });
});
