/**
 * The hand-off path over the write API, end to end: an external caller
 * proposes `deploy.provision` with a recipe, it lands on the queue, a person
 * approves it (released, nothing run), and whoever did the work marks it
 * done with a note and a result URL. PGlite; auth stubbed at the door.
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
const { actionRunSchema, decisionAlignmentSchema, reviewAssignmentSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { POST: DECIDE } = await import('./route');
const { POST: PROPOSE } = await import('../propose/route');
const { GET: LIST } = await import('../route');
const { GET: DETAIL } = await import('../[kind]/[id]/route');
const { eq } = await import('drizzle-orm');

const ORG = 'org_reviews_handoff';

function tokenPrincipal(orgId: string, tokenId = 't1') {
  return {
    orgId,
    tokenId,
    principal: { kind: 'user' as const, id: `token:${tokenId}`, role: 'owner' as const, scope: { orgId }, grants: ['*'] },
  };
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

const proposal = {
  actionId: 'deploy.provision',
  input: {
    title: 'Provision the staging ingest queue',
    summary: 'Task 17 cannot run without it; the contract names the queue.',
    recipe: 'aws sqs create-queue --queue-name vocion-staging-ingest --region us-west-2',
    evidence: ['https://example.test/factory/tasks/17'],
    externalRef: { system: 'aws', id: 'sqs/vocion-staging-ingest' },
  },
  agentSlug: 'factory-lead',
  confidence: 1,
  rationale: 'the task contract names it',
  suggestedDecision: 'approve',
  suggestedDecisionReason: 'named in the task contract',
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  vi.mocked(authenticateBearer).mockResolvedValue(tokenPrincipal(ORG) as never);
  await db.delete(decisionAlignmentSchema);
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
});

afterAll(async () => {
  await db.delete(decisionAlignmentSchema);
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
});

describe('a hand-off over /api/v1/reviews', () => {
  it('propose → queue → approve (released) → done, with the trail on one run', async () => {
    // 1. An external caller proposes a registered hand-off with a recipe.
    const proposed = await PROPOSE(post('/api/v1/reviews/propose', proposal));

    expect(proposed.status).toBe(200);

    const { runId, status } = await proposed.json();

    expect(status).toBe('pending');

    // 2. It is on the org's queue, with the card rendering the recipe.
    const listed = await (await LIST(get('/api/v1/reviews?kind=action'))).json();

    expect(listed.items).toMatchObject([{ kind: 'action', id: runId, status: 'pending' }]);

    const detail = await (await DETAIL(get(`/api/v1/reviews/action/${runId}`), { params: Promise.resolve({ kind: 'action', id: String(runId) }) })).json();

    expect(detail.card).toMatchObject({
      title: proposal.input.title,
      system: 'Deploy',
      content: [{ kind: 'text', id: 'recipe', body: proposal.input.recipe, preformatted: true }],
      links: [{ href: 'https://example.test/factory/tasks/17' }],
    });

    // 3. Marking it done before anyone approved it is refused.
    const early = await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'done' }));

    expect(early.status).toBe(409);

    // 4. A person approves: released, not run. The queue's pending list no
    //    longer carries it; the run says who released it.
    const approved = await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'approve', reason: 'go ahead' }));

    expect(approved.status).toBe(200);

    let [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId));

    expect(row).toMatchObject({ status: 'awaiting_execution', decidedBy: 'token:t1', approvedByAgent: false });
    expect(row!.result).toMatchObject({ handoff: { releasedBy: 'token:t1' } });
    expect(row!.executedAt).toBeNull();
    expect((await (await LIST(get('/api/v1/reviews?kind=action'))).json()).items).toEqual([]);
    expect((await (await DETAIL(get(`/api/v1/reviews/action/${runId}`), { params: Promise.resolve({ kind: 'action', id: String(runId) }) })).json()).status).toBe('awaiting_execution');
    // The approval is the decision the ledger scores — once.
    expect(await db.select().from(decisionAlignmentSchema).where(eq(decisionAlignmentSchema.orgId, ORG))).toHaveLength(1);

    // 5. A bad result URL is a 400; a second approve of a released run is a 409.
    expect((await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'done', resultUrl: 'not a url' }))).status).toBe(400);
    expect((await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'approve' }))).status).toBe(409);

    // 6. Whoever did the work — another token here — marks it done.
    vi.mocked(authenticateBearer).mockResolvedValue(tokenPrincipal(ORG, 'ci') as never);
    const done = await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'done', reason: 'applied from the runner', resultUrl: 'https://example.test/sqs/vocion-staging-ingest' }));

    expect(done.status).toBe(200);

    [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId));

    expect(row).toMatchObject({ status: 'done', decidedBy: 'token:t1' });
    expect(row!.executedAt).toBeInstanceOf(Date);
    expect(row!.result).toMatchObject({
      handoff: { releasedBy: 'token:t1' },
      executed: { by: 'token:ci', note: 'applied from the runner', resultUrl: 'https://example.test/sqs/vocion-staging-ingest' },
    });
    // Deciding again is a 409: the run is closed.
    expect((await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'done' }))).status).toBe(409);
    // The alignment ledger was not written a second time by the close.
    expect(await db.select().from(decisionAlignmentSchema).where(eq(decisionAlignmentSchema.orgId, ORG))).toHaveLength(1);
  });

  it('done is an action verb only, and a foreign org never reaches the run', async () => {
    const { runId } = await (await PROPOSE(post('/api/v1/reviews/propose', proposal))).json();

    expect((await DECIDE(post('/api/v1/reviews/decide', { kind: 'workflow', id: 1, action: 'done' }))).status).toBe(400);
    expect((await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'finish' }))).status).toBe(400);

    vi.mocked(authenticateBearer).mockResolvedValue(tokenPrincipal('org_someone_else') as never);

    expect((await DECIDE(post('/api/v1/reviews/decide', { kind: 'action', id: runId, action: 'approve' }))).status).toBe(404);
  });
});
