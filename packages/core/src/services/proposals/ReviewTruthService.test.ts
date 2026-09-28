/**
 * The Review queue stays true (backlog 039), against PGlite: each rule that
 * closes an undecided item whose reason is gone — expired, record deleted,
 * decided on its own record, a question whose subject settled, superseded by
 * a newer item — closes it with the reason and a link and never touches one
 * still true; a true item past the bound is surfaced once; and the proposal
 * limit counts only what is still true.
 *
 * Fixtures are fictional: Northwind's product team, an invented request.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { actionRunSchema, agentSchema, askSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const svc = await import('./ReviewTruthService');
const budget = await import('./ProposalBudgetService');

const ORG = 'org_review_truth';
const AGENT = 'product-manager';
const NOW = new Date('2026-09-28T19:30:00Z');
const DAY = 86_400_000;

async function wipe() {
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(agentSchema);
}

/** The two types the fixtures use: one that declares when it settles, one that says nothing. */
async function types() {
  const [request] = await db.insert(businessObjectTypeSchema).values({
    orgId: ORG,
    slug: 'request',
    label: 'Request',
    schema: { 'type': 'object', 'x-settled': { field: 'state', in: ['shipped', 'answered'] }, 'properties': { state: { type: 'string' } } },
  }).returning();
  const [plan] = await db.insert(businessObjectTypeSchema).values({
    orgId: ORG,
    slug: 'architecture_plan',
    label: 'Architecture plan',
    schema: { 'type': 'object', 'x-settled': { field: 'status', in: ['approved', 'rejected'] }, 'properties': { status: { type: 'string' } } },
  }).returning();
  const [note] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'note', label: 'Note', schema: { type: 'object' } }).returning();
  return { request: request!.id, plan: plan!.id, note: note!.id };
}

async function record(typeId: number, title: string, opts: { status?: string; metadata?: Record<string, unknown>; reviewRunId?: number } = {}) {
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId,
    title,
    status: opts.status ?? 'active',
    metadata: opts.metadata ?? {},
    ...(opts.reviewRunId ? { reviewActionRunId: opts.reviewRunId } : {}),
  } as never).returning({ id: businessObjectSchema.id });
  return row!.id;
}

async function run(actionId: string, input: Record<string, unknown>, opts: { dedupKey?: string; expiresAt?: Date; createdAt?: Date; agent?: string } = {}) {
  const [row] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId,
    input,
    status: 'pending',
    invokedBy: `agent:${opts.agent ?? AGENT}`,
    dedupKey: opts.dedupKey ?? null,
    expiresAt: opts.expiresAt ?? null,
    createdAt: opts.createdAt ?? new Date(NOW.getTime() - DAY),
  } as never).returning({ id: actionRunSchema.id });
  return row!.id;
}

async function ask(title: string, objectRefs: Array<{ type: string; id: string }>, opts: { createdAt?: Date; notified?: boolean } = {}) {
  const [row] = await db.insert(askSchema).values({
    orgId: ORG,
    kind: 'ruling',
    title,
    agentSlug: AGENT,
    status: 'open',
    options: [],
    objectRefs,
    notified: opts.notified ?? false,
    createdAt: opts.createdAt ?? new Date(NOW.getTime() - DAY),
  } as never).returning({ id: askSchema.id });
  return row!.id;
}

async function runRow(id: number) {
  const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));
  return row!;
}

async function askRow(id: number) {
  const [row] = await db.select().from(askSchema).where(eq(askSchema.id, id));
  return row!;
}

const sweep = () => svc.sweepReviewQueue({ now: NOW, orgId: ORG, stillWaitingAfterMs: 7 * DAY });

beforeEach(wipe);

afterAll(wipe);

describe('what the sweep closes, and why', () => {
  it('closes an expired run as closed, dated at its expiry, with the reason on the row', async () => {
    const expiresAt = new Date('2026-09-26T04:00:00Z');
    const id = await run('notify.requester', { title: 'Tell Northwind their export shipped' }, { expiresAt });

    const res = await sweep();

    const row = await runRow(id);

    expect(row.status).toBe('closed');
    expect(row.error).toBe('closed: it expired on 2026-09-26 and left Review then without a decision');
    expect(row.decidedBy).toBe(svc.REVIEW_SWEEPER);
    expect(row.decidedAt?.toISOString()).toBe(expiresAt.toISOString());
    expect(res.closed).toEqual([expect.objectContaining({ kind: 'run', id })]);
  });

  it('closes a candidate review decided on its own record, linking the record, and leaves one still proposed', async () => {
    const t = await types();
    const decided = await run('objects.propose_candidate', { objectType: 'architecture_plan', title: 'Plan: Export to CSV' });
    const open = await run('objects.propose_candidate', { objectType: 'architecture_plan', title: 'Plan: Shared folders' });
    const decidedPlan = await record(t.plan, 'Plan: Export to CSV', { status: 'candidate', metadata: { status: 'approved' }, reviewRunId: decided });
    await record(t.plan, 'Plan: Shared folders', { status: 'candidate', metadata: { status: 'proposed' }, reviewRunId: open });

    await sweep();

    const closed = await runRow(decided);

    expect(closed.status).toBe('closed');
    expect(closed.error).toBe(`closed: Architecture plan #${decidedPlan} was decided on its own record (approved) — /dashboard/objects/${decidedPlan}`);
    expect((await runRow(open)).status).toBe('pending');
  });

  it('closes a candidate whose record left `candidate` another way, and one whose record was deleted', async () => {
    const t = await types();
    const approved = await run('objects.propose_candidate', { objectType: 'request', title: 'Bulk invite' });
    await record(t.request, 'Bulk invite', { status: 'approved', reviewRunId: approved });
    const orphan = await run('objects.propose_candidate', { objectType: 'request', title: 'Dark mode' });

    await sweep();

    expect((await runRow(approved)).error).toContain('was decided on its own record (approved)');
    expect((await runRow(orphan)).error).toBe('closed: the request it proposed no longer exists');
  });

  it('closes a write whose record was deleted, and an ask about a deleted record', async () => {
    const t = await types();
    const kept = await record(t.note, 'Kickoff notes');
    const write = await run('objects.update_meta', { id: 999_999, set: { summary: 'x' } });
    const live = await run('objects.update_meta', { id: kept, set: { summary: 'y' } });
    const q = await ask('Is the Kestrel import still wanted?', [{ type: 'request', id: '999998' }]);

    await sweep();

    expect((await runRow(write)).error).toBe('closed: the record it is about (#999999) no longer exists');
    expect((await runRow(live)).status).toBe('pending');

    const a = await askRow(q);

    expect(a.status).toBe('superseded');
    expect(a.decisionNote).toBe('closed: the Request it is about (#999998) no longer exists');
    expect(a.decidedBy).toBe(svc.REVIEW_SWEEPER);
  });

  it('closes a question whose subject settled, but not a write that is still owed about it', async () => {
    const t = await types();
    const shipped = await record(t.request, 'Export to CSV', { metadata: { state: 'shipped' } });
    const question = await run('ask.file', { title: 'Build Export to CSV?', objectRefs: [{ type: 'request', id: String(shipped) }] });
    const owed = await run('objects.update_meta', { id: shipped, set: { told: true } });
    const askId = await ask('Approve build: Export to CSV', [{ type: 'request', id: String(shipped) }]);

    await sweep();

    expect((await runRow(question)).error).toBe(`closed: what it asked about has settled: Request #${shipped} is shipped — /dashboard/objects/${shipped}`);
    expect((await runRow(owed)).status).toBe('pending');
    expect((await askRow(askId)).decisionNote).toContain(`Request #${shipped} is shipped`);
  });

  it('keeps a question while any record it is about is still open, and never reads an unknown type as deleted', async () => {
    const t = await types();
    const shipped = await record(t.request, 'Export to CSV', { metadata: { state: 'shipped' } });
    const triaged = await record(t.request, 'Shared folders', { metadata: { state: 'triaged' } });
    const mixed = await ask('Sequence these two?', [{ type: 'request', id: String(shipped) }, { type: 'request', id: String(triaged) }]);
    const crm = await ask('Call the Contoso Supply buyer?', [{ type: 'deal', id: '4410' }]);

    await sweep();

    expect((await askRow(mixed)).status).toBe('open');
    expect((await askRow(crm)).status).toBe('open');
  });

  it('closes an older item superseded by a newer one with the same dedup key, linking the newer', async () => {
    const older = await run('ask.file', { title: 'Build bulk invite?' }, { dedupKey: 'ask.file:recommendation/7' });
    const newer = await run('ask.file', { title: 'Build bulk invite? (refreshed)' }, { dedupKey: 'ask.file:recommendation/7' });

    await sweep();

    expect((await runRow(older)).error).toBe(`closed: superseded by proposal #${newer}, filed later for the same thing — /dashboard/inbox/proposal-${newer}`);
    expect((await runRow(newer)).status).toBe('pending');
  });

  it('is never silent: the closed run is on the decided tab with its reason, and off the open one', async () => {
    const { listReviewRows } = await import('@/services/inbox/reviewRows');
    const id = await run('notify.requester', { title: 'Tell Northwind their export shipped' }, { expiresAt: new Date('2026-09-26T04:00:00Z') });

    await sweep();

    const decided = await listReviewRows(ORG, 'decided', { now: NOW });
    const open = await listReviewRows(ORG, 'open', { now: NOW });

    expect(decided.find(r => r.id === id)).toMatchObject({ status: 'closed', decidedBy: svc.REVIEW_SWEEPER, note: expect.stringMatching(/^closed: it expired on 2026-09-26/) });
    expect(open.find(r => r.id === id)).toBeUndefined();
  });

  it('never overwrites a decision a person made first', async () => {
    const id = await run('notify.requester', { title: 'x' }, { expiresAt: new Date(NOW.getTime() - DAY) });
    await db.update(actionRunSchema).set({ status: 'done' }).where(eq(actionRunSchema.id, id));

    const res = await sweep();

    expect(res.closed).toEqual([]);
    expect((await runRow(id)).status).toBe('done');
  });
});

describe('what the sweep surfaces instead', () => {
  it('surfaces a true run past the bound once, and leaves a fresh one alone', async () => {
    const since = new Date(NOW.getTime() - 9 * DAY);
    const old = await run('notify.requester', { title: 'Tell Bellwater Hall the page is live' }, { createdAt: since });
    const fresh = await run('notify.requester', { title: 'Tell Acme the fix is live' });

    const first = await sweep();
    const marked = (await runRow(old)).proposal as Record<string, unknown>;
    const second = await svc.sweepReviewQueue({ now: new Date(NOW.getTime() + DAY), orgId: ORG, stillWaitingAfterMs: 7 * DAY });

    expect(first.surfaced).toEqual([expect.objectContaining({ kind: 'run', id: old })]);
    expect(marked).toMatchObject({ stillWaitingSince: since.toISOString(), surfacedAt: NOW.toISOString() });
    expect(second.surfaced).toEqual([]);
    expect(((await runRow(old)).proposal as Record<string, unknown>).surfacedAt).toBe(NOW.toISOString());
    expect((await runRow(old)).status).toBe('pending');
    expect((await runRow(fresh)).proposal).toBeNull();
  });

  it('notifies an old true ask once more, and only once', async () => {
    const old = await ask('Which pricing page ships first?', [], { createdAt: new Date(NOW.getTime() - 10 * DAY), notified: true });

    await sweep();
    const after = await askRow(old);
    await db.update(askSchema).set({ notified: true }).where(eq(askSchema.id, old));
    const again = await sweep();

    expect(after.status).toBe('open');
    expect(after.notified).toBe(false);
    expect(after.notifyAt?.toISOString()).toBe(NOW.toISOString());
    expect(again.surfaced).toEqual([]);
  });
});

describe('the limit counts only what is still true', () => {
  it('does not refuse an agent whose undecided items are mostly gone', async () => {
    const t = await types();
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 2, weeklyMax: 10 } } } as never);
    const expiredAt = new Date(NOW.getTime() - 2 * DAY);
    await run('ask.file', { title: 'Build an admin panel?' }, { expiresAt: expiredAt });
    await run('notify.requester', { title: 'Reply on the dashboard pass' }, { expiresAt: expiredAt });
    const plan = await run('objects.propose_candidate', { objectType: 'architecture_plan', title: 'Plan: Export to CSV' });
    await record(t.plan, 'Plan: Export to CSV', { status: 'candidate', metadata: { status: 'approved' }, reviewRunId: plan });
    const live = await run('objects.update_meta', { id: await record(t.note, 'Release notes'), set: { announcement: 'Draft' } });

    const open = await budget.openProposals(ORG, AGENT, NOW);
    const verdict = await budget.checkProposalBudget({ orgId: ORG, agentSlug: AGENT, now: NOW });

    expect(open.map(o => o.id)).toEqual([live]);
    expect(verdict).toMatchObject({ ok: true, open: 1, openMax: 2 });
  });

  it('still refuses when the true items alone reach the limit', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 2, weeklyMax: 10 } } } as never);
    await run('notify.requester', { title: 'Tell Northwind' });
    await ask('Which pricing page ships first?', []);

    expect(await budget.checkProposalBudget({ orgId: ORG, agentSlug: AGENT, now: NOW })).toMatchObject({ ok: false, reason: 'open' });
  });
});

describe('the settled descriptor', () => {
  it('reads a well-formed x-settled and ignores a malformed one', () => {
    expect(svc.settledDescriptor({ 'x-settled': { field: 'state', in: ['shipped'] } })).toEqual({ field: 'state', in: ['shipped'] });
    expect(svc.settledDescriptor({ 'x-settled': { field: 'state', in: [] } })).toBeNull();
    expect(svc.settledDescriptor({ 'x-settled': 'shipped' })).toBeNull();
    expect(svc.settledDescriptor(null)).toBeNull();
  });
});
