/**
 * Approving a paused mission run over the write API, end to end: a level-1
 * run stops before its external task, it lands on the review queue, a person
 * approves it through `POST /api/v1/reviews/decide`, and the task runs and the
 * run finishes. Before the fix, the approval sent the same task straight back
 * to the queue. PGlite; auth stubbed at the door; `runAgentDeep` is mocked, so
 * no model is called.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/adoption/attribution', () => ({ trackReviewDecision: vi.fn(async () => {}), trackReviewSnooze: vi.fn(async () => {}), agentSlugFromPrincipal: (id: string) => (id.startsWith('agent:') ? id.slice(6) : null) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/AgentService', () => ({ runAgentDeep: vi.fn() }));

const { db } = await import('@/libs/DB');
const { missionRunSchema, reviewAssignmentSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { runAgentDeep } = await import('@/services/AgentService');
const { executeMissionRun } = await import('@/services/missions/runtime');
const { POST: DECIDE } = await import('./route');
const { GET: LIST } = await import('../route');
const { eq } = await import('drizzle-orm');

const ORG = 'org_reviews_mission';
const mockRunAgent = vi.mocked(runAgentDeep);

function tokenPrincipal(orgId: string) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] },
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

async function seedPausedDraftOnlyRun(): Promise<number> {
  const [row] = await db.insert(missionRunSchema).values({
    orgId: ORG,
    title: 'Send the Northwind follow-up',
    brief: 'send it',
    status: 'running',
    team: { lead: 'agent-x', members: [] },
    // Level 1, draft only: every external action waits for a person.
    autonomyPolicy: { level: 1 },
    plan: { tasks: [{ id: 'send', title: 'Send the email', ownerAgentSlug: 'agent-x', type: 'action', status: 'pending' }] },
  }).returning({ id: missionRunSchema.id });
  await executeMissionRun(row!.id, ORG);
  return row!.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  vi.mocked(authenticateBearer).mockResolvedValue(tokenPrincipal(ORG) as never);
  mockRunAgent.mockResolvedValue({ response: 'sent', traceId: 'trace', toolCalls: [] } as never);
  await db.delete(reviewAssignmentSchema);
  await db.delete(missionRunSchema);
});

afterAll(async () => {
  await db.delete(reviewAssignmentSchema);
  await db.delete(missionRunSchema);
});

describe('approving a paused mission run over /api/v1/reviews', () => {
  it('runs the approved external task once, finishes the run, and clears it from the queue', async () => {
    const runId = await seedPausedDraftOnlyRun();

    expect(mockRunAgent).not.toHaveBeenCalled();
    expect((await (await LIST(get('/api/v1/reviews?kind=mission'))).json()).items).toMatchObject([{ kind: 'mission', id: runId }]);

    const approved = await DECIDE(post('/api/v1/reviews/decide', { kind: 'mission', id: runId, action: 'approve' }));

    expect(approved.status).toBe(200);

    const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, runId));

    expect(row!.status).toBe('completed');
    expect(row!.plan!.tasks).toMatchObject([{ id: 'send', status: 'completed', approvedAt: expect.any(String) }]);
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect((await (await LIST(get('/api/v1/reviews?kind=mission'))).json()).items).toEqual([]);
  });
});
