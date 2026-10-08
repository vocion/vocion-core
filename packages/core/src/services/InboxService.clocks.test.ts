/**
 * Needs you carries each decision's clock on its row, says "applied by
 * default" on the decided tab where the deadline answered, and shows a run
 * parked on its questions once — as its gate ask, not also as a paused run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [], skipped: [] })) }));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { askSchema, decisionDeadlineSchema, missionRunSchema, resumeGateSchema, workerRunSchema } = await import('@/models/Schema');
const { upsertAsk } = await import('@/services/AskService');
const { listInbox } = await import('@/services/InboxService');
const { DEFAULT_DECIDER } = await import('@/libs/needsYou/deadlines');

const ORG = 'org_inbox_clock';
const OTHER = 'org_inbox_clock_other';

beforeEach(async () => {
  await db.delete(askSchema);
  await db.delete(decisionDeadlineSchema);
  await db.delete(resumeGateSchema);
  await db.delete(workerRunSchema);
  await db.delete(missionRunSchema);
});

describe('clocks on Needs you', () => {
  it('puts the deadline and its default on the row, and never another workspace\'s clock', async () => {
    const { ask } = await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Renew Northwind?', options: [{ id: 'yes', label: 'Approve', recommended: true }] } });
    const at = new Date('2026-10-09T15:00:00.000Z');
    await db.insert(decisionDeadlineSchema).values([
      { orgId: ORG, subjectKind: 'ask', subjectId: ask.id, deadlineAt: at, escalateAt: at, nextAt: at, defaultOption: 'yes', defaultLabel: 'Approve' },
      // Same id in another workspace: a different decision, never this row's clock.
      { orgId: OTHER, subjectKind: 'ask', subjectId: ask.id + 1000, deadlineAt: at, escalateAt: at, nextAt: at, defaultOption: 'x', defaultLabel: 'Theirs' },
    ]);

    const inbox = await listInbox(ORG);

    expect(inbox.items[0]).toMatchObject({ askId: ask.id, deadline: { at, defaultLabel: 'Approve', status: 'open', reason: null } });
  });

  it('says "applied by default" on the decided tab, with Undo, where the deadline answered', async () => {
    const { ask } = await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Renew Northwind?', options: [{ id: 'yes', label: 'Approve', recommended: true }] } });
    await db.update(askSchema).set({ status: 'done', decision: 'yes', decidedBy: DEFAULT_DECIDER, decidedAt: new Date() }).where(eq(askSchema.id, ask.id));

    const inbox = await listInbox(ORG, { tab: 'decided' });

    expect(inbox.items[0]).toMatchObject({ askId: ask.id, decision: 'applied by default', undoable: true });
  });

  it('shows a parked run once — as its gate ask — not also as a paused run', async () => {
    const [worker] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'migrator', status: 'paused' }).returning();
    const [loose] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'migrator', status: 'paused' }).returning();
    await db.insert(resumeGateSchema).values({ orgId: ORG, subjectKind: 'worker_run', subjectRef: String(worker!.id), waitingOn: [1] });

    const inbox = await listInbox(ORG);
    const runRows = inbox.items.filter(i => i.kind === 'run').map(i => i.ref);

    expect(runRows).toEqual([{ kind: 'worker', id: loose!.id }]);
  });
});
