/**
 * The decide route on a failed run, the way the page's button reaches it:
 * "Create draft in Gmail" approves with the card's draft-or-send choice as a
 * content edit, which the route maps onto the input. A recoverable failure
 * runs again; any other is a 400 that says why, never a stack trace.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));
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
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { registerAction } = await import('@/libs/actions/registry');
const { decideActionRoute } = await import('./Review');
const { eq } = await import('drizzle-orm');

const ORG = 'org_retry_route';
const SCOPE_403 = 'Gmail draft failed: 403 { "error": { "code": 403, "status": "PERMISSION_DENIED", "details": [ { "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT" } ] } }';

const ran: Array<Record<string, unknown>> = [];

registerAction({
  id: 'gmail.test-route-draft',
  name: 'Test route draft',
  description: 'test',
  inputSchema: z.object({ to: z.string(), body: z.string(), mode: z.enum(['draft', 'send']).optional() }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => {
    ran.push(input as Record<string, unknown>);
    return { draftId: 'draft-7' };
  },
  applyContentEdits: (input, edits) => {
    const mode = edits.find(e => e.id === 'message')?.mode;
    return mode ? { ...(input as Record<string, unknown>), mode } : input;
  },
} as Parameters<typeof registerAction>[0]);

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

async function failedRun(error: string): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({ orgId: ORG, actionId: 'gmail.test-route-draft', status: 'failed', error, decidedBy: 'usr-1', invokedBy: 'agent:revenue-lead', input: { to: 'pat@example.test', body: 'Thanks.' } })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  ran.length = 0;
  await db.delete(actionRunSchema);
  vi.mocked(guardAuth).mockResolvedValue({
    userId: 'usr-1',
    orgId: ORG,
    accountId: 'acct-1',
    projectId: ORG,
    role: 'admin',
    has: () => true,
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
});

describe('decideAction route on a failed run', () => {
  it('runs a run that failed for want of access again when its button is pressed', async () => {
    const id = await failedRun(SCOPE_403);

    const res = await call<{ ok: boolean; execution: { status: string } | null }>(decideActionRoute, { id, decision: 'approve', contentEdits: [{ id: 'message', mode: 'draft' }] });

    expect(res.execution?.status).toBe('done');
    expect(ran).toEqual([{ to: 'pat@example.test', body: 'Thanks.', mode: 'draft' }]);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(row).toMatchObject({ status: 'done', error: null });
  });

  it('answers a 400 that says why for a failure that is not safe to repeat', async () => {
    const id = await failedRun('The record was half written');

    await expect(call(decideActionRoute, { id, decision: 'approve', contentEdits: [{ id: 'message', mode: 'draft' }] }))
      .rejects
      .toMatchObject({ code: 'bad-request', message: expect.stringMatching(/safe to repeat/) });
    expect(ran).toEqual([]);
  });
});
