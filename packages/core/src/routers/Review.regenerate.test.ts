/**
 * `regenerateAction`'s guards.
 *
 * The route is the only door to an action's `regenerate` handler, so what it
 * refuses matters as much as what it dispatches: a caller must be
 * authenticated (guardAuth first, before any lookup), the run must be a
 * PENDING run of the caller's own org, and the action must have declared the
 * capability. A regression on any of these would let a card regenerate work
 * it cannot see or that no action implements.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

// A factory, not an automock: automocking still loads the real module for its
// shape, and AuthGuards pulls in next-auth, which does not import cleanly in
// the unit environment (same reason Review.resume.test.ts mocks it this way).
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

// Review.ts imports WorkflowService at module load; mocked wholesale the way
// Review.resume.test.ts does, so this file stays importable in the unit
// environment without pulling the workflow stack in.
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

// The registry decides which action answers; each test states the capability
// it needs rather than depending on what happens to be registered.
vi.mock('@/libs/actions/registry', () => ({
  getAction: vi.fn(),
}));

// The signal capture is ReviewService.learning.test.ts's job; here only the
// fact that the route records it, with the feedback as the hint.
vi.mock('@/services/ReviewService', () => ({
  recordActionSignal: vi.fn(async () => {}),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { getAction } = await import('@/libs/actions/registry');
const { recordActionSignal } = await import('@/services/ReviewService');
const { regenerateActionRoute } = await import('./Review');

const ORG = 'org_regen_test';

/**
 * Call an oRPC procedure directly, bypassing the HTTP layer, the way
 * Review.resume.test.ts does.
 * @param route - The exported procedure.
 * @param input - The validated input payload.
 */
function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

/**
 * A run in the state the route requires, unless the test says otherwise.
 * @param over
 */
async function makeRun(over: Partial<typeof actionRunSchema.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'personalization.enroll',
      input: { contactRef: 'contacts:9412' },
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      ...over,
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
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

describe('regenerateAction route', () => {
  it('refuses an unauthenticated caller before touching anything', async () => {
    vi.mocked(guardAuth).mockRejectedValue(new Error('UNAUTHORIZED'));
    const regenerate = vi.fn();
    vi.mocked(getAction).mockReturnValue({ regenerate } as unknown as ReturnType<typeof getAction>);
    const runId = await makeRun();

    await expect(call(regenerateActionRoute, { id: runId, feedback: 'shorter' })).rejects.toThrow('UNAUTHORIZED');

    expect(regenerate).not.toHaveBeenCalled();
    expect(recordActionSignal).not.toHaveBeenCalled();
  });

  it('cannot reach another org\'s run', async () => {
    const regenerate = vi.fn();
    vi.mocked(getAction).mockReturnValue({ regenerate } as unknown as ReturnType<typeof getAction>);
    const runId = await makeRun({ orgId: 'org_someone_else' });

    await expect(call(regenerateActionRoute, { id: runId, feedback: 'shorter' })).rejects.toMatchObject({ code: 'not-found' });

    expect(regenerate).not.toHaveBeenCalled();
  });

  it('refuses a run that is no longer pending', async () => {
    const regenerate = vi.fn();
    vi.mocked(getAction).mockReturnValue({ regenerate } as unknown as ReturnType<typeof getAction>);
    const runId = await makeRun({ status: 'done' });

    await expect(call(regenerateActionRoute, { id: runId, feedback: 'shorter' })).rejects.toMatchObject({ code: 'not-found' });

    expect(regenerate).not.toHaveBeenCalled();
  });

  it('refuses an action that never declared the capability, recording nothing', async () => {
    vi.mocked(getAction).mockReturnValue({} as unknown as ReturnType<typeof getAction>);
    const runId = await makeRun();

    await expect(call(regenerateActionRoute, { id: runId, feedback: 'shorter' })).rejects.toThrow(/does not support regeneration/);

    expect(recordActionSignal).not.toHaveBeenCalled();
  });

  it('dispatches to the action\'s handler and records the feedback as a regenerate signal', async () => {
    const regenerate = vi.fn(async () => {});
    vi.mocked(getAction).mockReturnValue({ regenerate } as unknown as ReturnType<typeof getAction>);
    const runId = await makeRun();

    const res = await call<{ ok: boolean }>(regenerateActionRoute, { id: runId, feedback: 'lead with the compliance angle' });

    expect(res).toEqual({ ok: true });
    expect(regenerate).toHaveBeenCalledWith(
      { orgId: ORG, reviewedBy: 'usr-1' },
      { contactRef: 'contacts:9412' },
      runId,
      'lead with the compliance angle',
    );
    expect(recordActionSignal).toHaveBeenCalledWith({
      orgId: ORG,
      runId,
      signal: 'regenerate',
      userId: 'usr-1',
      hint: 'lead with the compliance angle',
    });
  });
});
