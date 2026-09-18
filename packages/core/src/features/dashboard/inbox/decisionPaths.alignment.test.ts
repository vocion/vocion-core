/**
 * The two ways a person decides from "Review queue" both feed the alignment
 * ledger. A proposal decided from the detail screen goes through
 * `client.review.decideAction` (the oRPC route the sticky bar calls); an ask
 * decided from the sheet goes through `POST /api/v1/asks/:id/decide`. Each
 * must leave a `decision_alignment` row — that row is what "agrees with you
 * N%" and the autonomy ladder read. PGlite; auth is stubbed at the door.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/routers/AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', async () => {
  const actual = await vi.importActual<typeof import('@/services/WorkflowService')>('@/services/WorkflowService');
  return {
    resumeWorkflow: vi.fn(),
    cancelWorkflow: vi.fn(),
    getWorkflowRun: vi.fn(),
    listWorkflowRuns: vi.fn(),
    submitWorkflowRunFeedback: vi.fn(),
    WorkflowRunNotResumableError: actual.WorkflowRunNotResumableError,
  };
});
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/adoption/attribution', () => ({ trackReviewDecision: vi.fn(async () => {}), trackReviewSnooze: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: vi.fn() };
});

const ORG = 'org_decision_paths';
const CALLER = { orgId: ORG, actorId: 'usr_chris', userId: 'usr_chris', role: 'org:admin', kind: 'session' };

vi.mock('@/app/api/v1/_shared', () => ({
  authApi: vi.fn(async () => CALLER),
  isErrorResponse: (v: unknown) => v instanceof Response,
  requireCapability: () => null,
  readIdParam: (raw: string) => Number.parseInt(raw, 10),
  readJsonBody: async (req: Request) => req.json(),
  jsonError: (code: string, message: string, status: number) => new Response(JSON.stringify({ error: { code, message } }), { status }),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, decisionAlignmentSchema, reviewAssignmentSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { guardAuth } = await import('@/routers/AuthGuards');
const { decideActionRoute } = await import('@/routers/Review');
const { upsertAsk } = await import('@/services/AskService');
const { POST: decideAskRoute } = await import('@/app/api/v1/asks/[id]/decide/route');
const { eq } = await import('drizzle-orm');

registerAction({
  id: 'test.inbox_paths',
  name: 'Test inbox paths',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async () => ({ ok: true }),
});

/**
 * Call an oRPC procedure directly, bypassing HTTP — the way the detail
 * screen's `client.review.decideAction` lands server-side.
 * @param route
 * @param input
 */
function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

async function ledger() {
  return db.select().from(decisionAlignmentSchema).where(eq(decisionAlignmentSchema.orgId, ORG)).orderBy(decisionAlignmentSchema.id);
}

beforeEach(async () => {
  vi.mocked(guardAuth).mockResolvedValue({ orgId: ORG, userId: 'usr_chris' } as never);
  await db.delete(decisionAlignmentSchema);
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
});

describe('deciding from Review queue writes the alignment ledger', () => {
  it('a proposal approved from the detail screen (review.decideAction) lands as an action decision', async () => {
    const [run] = await db
      .insert(actionRunSchema)
      .values({ orgId: ORG, actionId: 'test.inbox_paths', input: { value: 'x' }, status: 'pending', invokedBy: 'agent:closer', proposal: { confidence: 0.77, suggestedDecision: 'approve' } as never })
      .returning({ id: actionRunSchema.id });

    const res = await call<{ ok: boolean }>(decideActionRoute, { id: run!.id, decision: 'approve', note: 'looks right' });

    expect(res.ok).toBe(true);

    const rows = await ledger();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectKind: 'action', subjectKey: 'test.inbox_paths', subjectId: run!.id, agentSlug: 'closer', decision: 'approved', recommended: 'approve', agreed: true, hasNote: true, decidedBy: 'usr_chris' });
  });

  it('an ask answered from the sheet (POST /api/v1/asks/:id/decide) lands as an ask decision', async () => {
    const { ask } = await upsertAsk({
      orgId: ORG,
      ask: { kind: 'ruling', title: 'One app or many?', agentSlug: 'ceo', options: [{ id: 'one', label: 'One', recommended: true, confidence: 0.7 }, { id: 'many', label: 'Many' }] },
    });

    const req = new Request(`http://localhost/api/v1/asks/${ask.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'many', note: 'per-agent addressing matters' }), headers: { 'Content-Type': 'application/json' } });
    const res = await decideAskRoute(req, { params: Promise.resolve({ id: String(ask.id) }) });

    expect(res.status).toBe(200);

    const rows = await ledger();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectKind: 'ask', subjectKey: 'ruling', subjectId: ask.id, agentSlug: 'ceo', decision: 'many', recommended: 'one', agreed: false, hasNote: true, decidedBy: 'usr_chris' });
  });
});
