/**
 * Batches on Needs you: the rows in view that recommend the same thing,
 * accepted in one move — each one decided as recommended, as the person, and
 * nothing that changed since they saw it, nothing from another workspace.
 */
import type { InboxItem } from '@/services/InboxService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [], skipped: [] })) }));

const review = vi.hoisted(() => ({
  outcome: { execution: { status: 'done', error: null } } as { execution: { status: string; error: string | null } | null },
  decide: vi.fn(),
}));
vi.mock('@/services/ReviewService', () => ({
  decide: review.decide.mockImplementation(async () => review.outcome),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { acceptBatch, recommendationBatches } = await import('./batches');

const ORG = 'org_batch_a';
const OTHER = 'org_batch_b';

async function fileAsk(orgId: string, title: string, recommended: string | null) {
  const [row] = await db.insert(askSchema).values({
    orgId,
    kind: 'approval',
    title,
    options: recommended ? [{ id: 'yes', label: recommended, recommended: true }, { id: 'no', label: 'No' }] : [],
  }).returning();
  return row!;
}

async function propose(orgId: string, suggestedDecision: 'approve' | 'reject' | 'snooze') {
  const [row] = await db.insert(actionRunSchema).values({ orgId, actionId: 'ask.file', input: { title: 'x' }, status: 'pending', proposal: { confidence: 0.8, suggestedDecision } }).returning();
  return row!;
}

function askRow(a: { id: number; title: string }, over: Partial<InboxItem> = {}): InboxItem {
  return { key: `ask:${a.id}`, kind: 'approval', shape: 'single', title: a.title, agentSlug: null, teamSlug: null, risk: null, status: 'open', at: new Date(), href: `/dashboard/inbox/${a.id}`, askId: a.id, ...over };
}

function proposalRow(r: { id: number }, over: Partial<InboxItem> = {}): InboxItem {
  return { key: `review:action:${r.id}`, kind: 'proposal', shape: 'single', title: `Run ${r.id}`, agentSlug: null, teamSlug: null, risk: null, status: 'pending', at: new Date(), href: `/dashboard/inbox/proposal-${r.id}`, reviewId: r.id, ...over };
}

beforeEach(async () => {
  vi.clearAllMocks();
  review.outcome = { execution: { status: 'done', error: null } };
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
});

describe('recommendationBatches', () => {
  it('gathers asks and proposals whose recommendation reads the same, largest first', async () => {
    const a1 = await fileAsk(ORG, 'Renew Northwind?', 'Approve');
    const a2 = await fileAsk(ORG, 'Publish the Contoso case study?', 'approve');
    const a3 = await fileAsk(ORG, 'Which venue?', 'Bellwater Hall');
    const p1 = await propose(ORG, 'approve');
    const p2 = await propose(ORG, 'reject');
    const p3 = await propose(ORG, 'reject');
    const p4 = await propose(ORG, 'snooze');

    const batches = await recommendationBatches(ORG, [askRow(a1), askRow(a2), askRow(a3), proposalRow(p1), proposalRow(p2), proposalRow(p3), proposalRow(p4)]);

    expect(batches.map(b => [b.key, b.label, b.count])).toEqual([['approve', 'Approve', 3], ['decline', 'Decline', 2]]);
    expect(batches[0]!.items.map(i => i.ref)).toEqual([`ask:${a1.id}`, `ask:${a2.id}`, `proposal:${p1.id}`]);
  });

  it('leaves out sheets, rows from another workspace, items with no recommendation, and anything not in this workspace', async () => {
    const a1 = await fileAsk(ORG, 'One', 'Approve');
    const a2 = await fileAsk(ORG, 'Two', null);
    const theirs = await fileAsk(OTHER, 'Theirs', 'Approve');
    const sheet: InboxItem = { ...askRow(a1), key: 'sheet:g', shape: 'sheet', askId: undefined, groupKey: 'g' };
    const elsewhere = askRow(a1, { key: 'x', workspace: { id: OTHER, slug: 'k', name: 'Kestrel', kind: 'shared' } });

    const batches = await recommendationBatches(ORG, [askRow(a1), askRow(a2), askRow(theirs), sheet, elsewhere]);

    expect(batches).toEqual([]);
  });
});

describe('acceptBatch', () => {
  it('decides each as recommended, as the person — asks through decideAsk, proposals through ReviewService.decide', async () => {
    const a1 = await fileAsk(ORG, 'Renew Northwind?', 'Approve');
    const p1 = await propose(ORG, 'approve');

    const r = await acceptBatch({ orgId: ORG, userId: 'usr-ada', key: 'approve', refs: [`ask:${a1.id}`, `proposal:${p1.id}`] });

    expect(r).toMatchObject({ accepted: 2, skipped: 0, failed: 0 });
    expect((await db.select().from(askSchema).where(eq(askSchema.id, a1.id)))[0]).toMatchObject({ status: 'done', decision: 'yes', decidedBy: 'usr-ada' });
    expect(review.decide).toHaveBeenCalledWith({ kind: 'action', id: p1.id }, 'approve', ORG, { reviewedBy: 'usr-ada' });
  });

  it('skips what changed since the person saw it, and what is not in this workspace — and says why', async () => {
    const decided = await fileAsk(ORG, 'Already done', 'Approve');
    await db.update(askSchema).set({ status: 'approved' }).where(eq(askSchema.id, decided.id));
    const moved = await fileAsk(ORG, 'Recommendation moved', 'Decline');
    const theirs = await fileAsk(OTHER, 'Kestrel question', 'Approve');
    const theirRun = await propose(OTHER, 'approve');

    const r = await acceptBatch({ orgId: ORG, userId: 'usr-ada', key: 'approve', refs: [`ask:${decided.id}`, `ask:${moved.id}`, `ask:${theirs.id}`, `proposal:${theirRun.id}`, 'nonsense'] });

    expect(r.accepted).toBe(0);
    expect(r.results.map(x => x.reason)).toEqual([
      'already approved',
      'its recommendation changed since you saw it',
      'not in this workspace',
      'not in this workspace',
      'not an item this batch can decide',
    ]);
    expect((await db.select().from(askSchema).where(eq(askSchema.id, theirs.id)))[0]!.status).toBe('open');
    expect(review.decide).not.toHaveBeenCalled();
  });

  it('reports an approval whose execution failed, and carries on with the rest', async () => {
    const p1 = await propose(ORG, 'approve');
    const a1 = await fileAsk(ORG, 'Renew Northwind?', 'Approve');
    review.outcome = { execution: { status: 'failed', error: 'HubSpot answered 400' } };

    const r = await acceptBatch({ orgId: ORG, userId: 'usr-ada', key: 'approve', refs: [`proposal:${p1.id}`, `ask:${a1.id}`] });

    expect(r).toMatchObject({ accepted: 1, failed: 1 });
    expect(r.results[0]).toMatchObject({ outcome: 'failed', reason: 'HubSpot answered 400' });
  });

  it('refuses an empty or oversized batch', async () => {
    await expect(acceptBatch({ orgId: ORG, userId: 'usr-ada', key: 'approve', refs: [] })).rejects.toThrow(/named no items/);
    await expect(acceptBatch({ orgId: ORG, userId: 'usr-ada', key: 'approve', refs: Array.from({ length: 101 }, (_, i) => `ask:${i + 1}`) })).rejects.toThrow(/at most 100/);
  });
});
