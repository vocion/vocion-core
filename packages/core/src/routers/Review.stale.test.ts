/**
 * The Review routes and an overtaken item: the status every card polls serves
 * only the stored finding (never a live call), and an approve that answers
 * stale is a typed STALE error, never read as a success.
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
const { actionStatusRoute, decideActionRoute } = await import('./Review');

const ORG = 'org_stale_route';
let checks = 0;
let moved = false;

registerAction({
  id: 'test.route-stale',
  name: 'Route stale',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  stillHolds: async () => {
    checks += 1;
    return moved ? { line: 'Dana Reyes wrote again on Oct 30', keepOpen: true } : null;
  },
  execute: async () => ({ ok: true }),
});

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

async function pending(proposal: Record<string, unknown> = { basisAt: '2026-10-25T10:00:00.000Z' }): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({ orgId: ORG, actionId: 'test.route-stale', status: 'pending', invokedBy: 'agent:inbox-triage', input: { value: 'x' }, proposal: proposal as never })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  checks = 0;
  moved = false;
  await db.delete(actionRunSchema);
  vi.mocked(guardAuth).mockResolvedValue({ userId: 'usr-1', orgId: ORG, accountId: 'acct-1', role: 'org:admin' } as never);
});

describe('actionStatus never calls out', () => {
  it('serves the stored finding, and makes no check even when the world moved', async () => {
    const id = await pending({ basisAt: '2026-10-25T10:00:00.000Z', stale: { line: 'Dana Reyes wrote again on Oct 30', checkedAt: '2026-10-29T10:00:00.000Z', canRedraft: false, fingerprint: 'f1' } });
    moved = true;
    const res = await call<{ stale: { line: string } | null }>(actionStatusRoute, { id });

    expect(res.stale?.line).toBe('Dana Reyes wrote again on Oct 30');
    expect(checks).toBe(0);
  });

  it('with nothing stored, answers null without checking', async () => {
    const id = await pending();
    moved = true;
    const res = await call<{ stale: unknown }>(actionStatusRoute, { id });

    expect(res.stale).toBeNull();
    expect(checks).toBe(0);
  });
});

describe('decideAction answers STALE as a typed error', () => {
  it('throws code STALE with the line and the finding', async () => {
    const id = await pending();
    moved = true;

    await expect(call(decideActionRoute, { id, decision: 'approve' })).rejects.toMatchObject({ code: 'STALE', message: 'Not run: Dana Reyes wrote again on Oct 30', data: { stale: { line: 'Dana Reyes wrote again on Oct 30' } } });
  });
});
