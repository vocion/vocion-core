/**
 * `resume`'s error mapping (vocion-core#111 follow-up).
 *
 * `resumeWorkflow` throws `WorkflowRunNotResumableError` when a resume loses
 * the claim race or lands on a run that already moved on. This route is the
 * only place that error gets turned into something a browser should see, and
 * the whole point of doing that translation here — instead of letting the
 * error's own message reach the client — is that the error's own message
 * carries the run id and the raw status text (`"workflow_run 42 is not
 * resumable: status is running, not paused"`), which is exactly the internal
 * detail Review.ts's comment says must stay server-side. A regression that
 * forwarded `err.message` straight through would pass every other test in
 * this router and still leak that detail into the review UI's error toast.
 */
import { ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/libs/Logger';

vi.mock('@/libs/DB');

// A factory, not an automock: automocking still loads the real module for its
// shape, and AuthGuards pulls in next-auth, which does not import cleanly in
// the unit environment (same reason ApiTokens.test.ts mocks it this way).
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

// WorkflowService is mocked wholesale so this file tests only what the route
// does with what the service throws — not the claim logic itself, which is
// WorkflowService.test.ts's job. `WorkflowRunNotResumableError` is the real
// class (re-exported, not reimplemented) so `instanceof` inside Review.ts's
// catch block matches the one this test throws.
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

const { guardAuth } = await import('./AuthGuards');
const { resumeWorkflow, WorkflowRunNotResumableError } = await import('@/services/WorkflowService');
const { resume } = await import('./Review');

const mockResumeWorkflow = vi.mocked(resumeWorkflow);

/**
 * Call an oRPC procedure directly, bypassing the HTTP layer, the way
 * ApiTokens.test.ts does — a procedure keeps its implementation on the
 * `~orpc` definition, so the test invokes that with the input a client
 * would have sent.
 * @param route - The exported procedure.
 * @param input - The validated input payload.
 */
function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(guardAuth).mockResolvedValue({
    userId: 'usr-1',
    orgId: 'org_review_test',
    accountId: 'acct-1',
    projectId: 'org_review_test',
    role: 'admin',
    has: () => true,
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
});

describe('resume route — mapping WorkflowRunNotResumableError', () => {
  it('answers a lost claim with a CONFLICT, not the raw service error', async () => {
    mockResumeWorkflow.mockRejectedValue(new WorkflowRunNotResumableError(42, 'status is running, not paused'));

    const rejection = call(resume, { id: 42 });

    await expect(rejection).rejects.toBeInstanceOf(ORPCError);
    await expect(rejection).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('never puts the run id or the raw status text in the message the client receives', async () => {
    mockResumeWorkflow.mockRejectedValue(new WorkflowRunNotResumableError(42, 'status is running, not paused'));

    try {
      await call(resume, { id: 42 });
      throw new Error('expected resume to reject');
    } catch (error) {
      const message = (error as Error).message;

      expect(message).not.toContain('42');
      expect(message).not.toContain('running');
      expect(message).not.toContain('not paused');
      // What the client is told instead — plain and true, no internals.
      expect(message).toBe('This run is no longer resumable — someone may have already approved it, or it has moved on.');
    }
  });

  it('still logs the run id and the real reason, so the detail survives somewhere', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mockResumeWorkflow.mockRejectedValue(new WorkflowRunNotResumableError(42, 'status is running, not paused'));

    try {
      await expect(call(resume, { id: 42 })).rejects.toBeInstanceOf(ORPCError);

      expect(warnSpy).toHaveBeenCalledWith(
        'workflow resume lost the claim race or the run moved on',
        expect.objectContaining({ runId: 42, orgId: 'org_review_test' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('lets an unrelated error through unchanged instead of also flattening it', async () => {
    mockResumeWorkflow.mockRejectedValue(new Error('database is unreachable'));

    await expect(call(resume, { id: 42 })).rejects.toThrow('database is unreachable');
  });

  it('returns the resumed run on success', async () => {
    const resumedRun = { id: 42, status: 'completed' as const };
    mockResumeWorkflow.mockResolvedValue(resumedRun as never);

    const result = await call(resume, { id: 42 });

    expect(result).toBe(resumedRun);
  });
});
