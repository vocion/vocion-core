/**
 * Undoing a rejection over the write API, end to end on PGlite: a candidate
 * record is proposed, a person rejects it, reopens it, and it is back in the
 * queue as a candidate a person can decide again. Auth stubbed at the door.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/adoption/attribution', () => ({ trackReviewDecision: vi.fn(async () => {}), trackReviewSnooze: vi.fn(async () => {}), agentSlugFromPrincipal: (id: string) => (id.startsWith('agent:') ? id.slice(6) : null) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn(), listMissionRuns: vi.fn(async () => []) }));
vi.mock('@/services/WorkflowService', () => ({ resumeWorkflow: vi.fn(), cancelWorkflow: vi.fn(), getWorkflowRun: vi.fn(), listWorkflowRuns: vi.fn(async () => []), submitWorkflowRunFeedback: vi.fn(), WorkflowRunNotResumableError: class extends Error {} }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, decisionAlignmentSchema, reviewAssignmentSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { POST: REOPEN } = await import('./route');
const { POST: DECIDE } = await import('../decide/route');
const { POST: PROPOSE } = await import('../propose/route');
const { GET: LIST } = await import('../route');
const { eq } = await import('drizzle-orm');

const ORG = 'org_reviews_reopen';
const OTHER_ORG = 'org_someone_else';

function tokenPrincipal(orgId: string, grants: string[] = ['*'], role: 'owner' | undefined = 'owner') {
  return { orgId, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', ...(role ? { role } : {}), scope: { orgId }, grants } };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://vocion.test${path}`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`https://vocion.test${path}`, { headers: { authorization: 'Bearer vcn_live_fake_token' } });
}

function candidate(title: string) {
  return {
    actionId: 'objects.propose_candidate',
    input: {
      objectType: 'event_candidate',
      title,
      fields: { title, start: '2026-12-05T19:30', venue: 'Bellwater Hall' },
      dedupOn: ['title', 'start', 'venue'],
    },
    agentSlug: 'ingestion-lead',
    confidence: 0.8,
    suggestedDecision: 'approve',
    suggestedDecisionReason: 'complete listing',
  };
}

async function propose(title: string): Promise<number> {
  const res = await PROPOSE(post('/api/v1/reviews/propose', candidate(title)));

  expect(res.status).toBe(200);

  return (await res.json()).runId;
}

const reject = (id: number) => DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id, action: 'reject', reason: 'bulk reject', learn: false }));
const reopen = (id: number, kind = 'action') => REOPEN(post('/api/v1/reviews/reopen', { kind, id }));
const objectFor = async (runId: number) => (await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.reviewActionRunId, runId)))[0];
const runOf = async (runId: number) => (await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId)))[0]!;

async function clean() {
  await db.delete(decisionAlignmentSchema);
  await db.delete(reviewAssignmentSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(actionRunSchema);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  vi.mocked(authenticateBearer).mockResolvedValue(tokenPrincipal(ORG) as never);
  await clean();
  forgetCachedObjectTypes();
  await db.insert(businessObjectTypeSchema).values({
    orgId: ORG,
    slug: 'event_candidate',
    label: 'Event candidate',
    schema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, venue: { type: 'string' } } },
  });
});

afterAll(clean);

describe('reopening a rejected review', () => {
  it('reject → reopen → pending, a candidate again, on the queue, and decidable', async () => {
    const runId = await propose('Winter Lantern Walk');

    expect((await reject(runId)).status).toBe(200);
    expect((await objectFor(runId))?.status).toBe('rejected');

    const res = await reopen(runId);

    expect(res.status).toBe(200);

    const body = await res.json();

    expect(body.reopened).toMatchObject({ kind: 'action', id: runId, status: 'pending', reopenedBy: 'token:t1' });
    expect(body.reviews.map((r: { id: number }) => r.id)).toContain(runId);

    const row = await runOf(runId);

    expect(row).toMatchObject({ status: 'pending', error: null, decidedBy: null, decidedAt: null, approvedByAgent: null, executedAt: null });
    expect((row.proposal as { reopened?: unknown }).reopened).toEqual([
      expect.objectContaining({ by: 'token:t1', rejectedBy: 'token:t1', rejectedReason: 'bulk reject' }),
    ]);
    expect((await objectFor(runId))?.status).toBe('candidate');
    expect((await (await LIST(get('/api/v1/reviews?kind=action'))).json()).items).toMatchObject([{ id: runId, status: 'pending' }]);

    // Decidable again: an approve runs the candidate's execute and links the record.
    expect((await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'approve', externalRef: { system: 'panel', id: '42' } }))).status).toBe(200);
    expect((await runOf(runId)).status).toBe('done');
    expect(await objectFor(runId)).toMatchObject({ status: 'approved', externalId: '42' });
  });

  it('can be rejected again after a reopen, and reopened again, keeping both records', async () => {
    const runId = await propose('Ice Harvest Supper');
    await reject(runId);
    await reopen(runId);
    await reject(runId);

    expect((await objectFor(runId))?.status).toBe('rejected');
    expect((await reopen(runId)).status).toBe(200);
    expect((await runOf(runId)).proposal).toMatchObject({ reopened: [expect.any(Object), expect.any(Object)] });
  });

  it('keeps who reopened it when the source proposes the same record again', async () => {
    const runId = await propose('Candlelight Concert');
    await reject(runId);
    await reopen(runId);

    expect(await propose('Candlelight Concert')).toBe(runId);
    expect((await runOf(runId)).proposal).toMatchObject({ suggestedDecision: 'approve', reopened: [expect.objectContaining({ by: 'token:t1' })] });
  });

  it('refuses a run that is not rejected — including the second of two reopens — with a 409', async () => {
    const runId = await propose('Sugarhouse Open Day');

    const pending = await reopen(runId);

    expect(pending.status).toBe(409);
    expect((await pending.json()).error.code).toBe('INVALID_STATE');

    await reject(runId);

    expect((await reopen(runId)).status).toBe(200);

    const again = await reopen(runId);

    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('INVALID_STATE');
    expect((await runOf(runId)).proposal).toMatchObject({ reopened: [expect.any(Object)] });
  });

  it('refuses a machine\'s rejection with NOT_REOPENABLE', async () => {
    const runId = await propose('Fiddle Night');
    await db.update(actionRunSchema).set({ status: 'rejected', decidedBy: 'agent:ingestion-lead', decidedAt: new Date() }).where(eq(actionRunSchema.id, runId));

    const res = await reopen(runId);

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NOT_REOPENABLE');
    expect((await runOf(runId)).status).toBe('rejected');
  });

  it('refuses with SUPERSEDED when the same record was proposed again and is open', async () => {
    const runId = await propose('Snowshoe Social');
    await reject(runId);
    // A newer open run on the same key, as a re-proposal past the decision would make.
    const [newer] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'objects.propose_candidate', input: {}, status: 'pending', dedupKey: (await runOf(runId)).dedupKey }).returning({ id: actionRunSchema.id });

    const res = await reopen(runId);

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('SUPERSEDED');
    expect((await runOf(runId)).status).toBe('rejected');
    expect(newer).toBeDefined();
  });

  it('never reaches another workspace\'s run, and leaves it rejected', async () => {
    const runId = await propose('Maple Breakfast');
    await reject(runId);
    vi.mocked(authenticateBearer).mockResolvedValue(tokenPrincipal(OTHER_ORG) as never);

    expect((await reopen(runId)).status).toBe(404);
    expect((await runOf(runId)).status).toBe('rejected');
  });

  it('is authorised like decide: no approve capability is a 403', async () => {
    const runId = await propose('Barn Dance');
    await reject(runId);
    vi.mocked(authenticateBearer).mockResolvedValue(tokenPrincipal(ORG, ['draft'], undefined) as never);

    expect((await reopen(runId)).status).toBe(403);
    expect((await runOf(runId)).status).toBe('rejected');
  });

  it('reopens actions only: a workflow or mission kind is a 400', async () => {
    expect((await reopen(1, 'workflow')).status).toBe(400);
    expect((await reopen(1, 'mission')).status).toBe(400);
  });
});
