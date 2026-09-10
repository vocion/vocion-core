/**
 * `Missions.ts`'s `resume` route — the CONFLICT mapping for a lost claim race
 * or a run that has moved off its approval gate (vocion-core#112).
 *
 * `MissionService.resumeMission` is mocked out here, so this test is only
 * about what the router does with a `MissionRunNotResumableError` it
 * receives — not about the claim logic that produces one. That claim logic
 * (the conditional UPDATE, the crash-safety fix for a stranded run) is
 * covered end to end in `MissionService.resume.test.ts`.
 */
import { ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// A factory, not an automock, same as ApiTokens.test.ts: AuthGuards pulls in
// next-auth, which does not import cleanly in the unit environment.
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
}));
// MissionService is mocked wholesale so the router test only exercises the
// router's own error handling, not the real claim UPDATE underneath it.
vi.mock('@/services/MissionService', () => {
  class MissionRunNotResumableError extends Error {
    constructor(runId: number) {
      super(`mission run ${runId} is no longer resumable — it may already have been resumed, or it isn't currently paused for review`);
      this.name = 'MissionRunNotResumableError';
    }
  }
  return {
    cancelMission: vi.fn(),
    getMission: vi.fn(),
    getMissionRun: vi.fn(),
    listMissionRuns: vi.fn(),
    listMissions: vi.fn(),
    MissionRunNotResumableError,
    promoteMissionToWorkflow: vi.fn(),
    resumeMission: vi.fn(),
    startMission: vi.fn(),
    submitMissionRunFeedback: vi.fn(),
  };
});

const { guardAuth } = await import('./AuthGuards');
const { MissionRunNotResumableError, resumeMission } = await import('@/services/MissionService');
const { resume } = await import('./Missions');

const ORG = 'org_router_missions';

/**
 * Point the mocked session at a signed-in reviewer, the way a dashboard
 * approve-click would arrive.
 */
function signedIn() {
  vi.mocked(guardAuth).mockResolvedValue({
    orgId: ORG,
    userId: 'usr-1',
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

/**
 * Call an oRPC procedure directly, bypassing the HTTP layer — same helper
 * pattern as `ApiTokens.test.ts`. A procedure keeps its implementation on
 * the `~orpc` definition, so the test invokes that with the input a client
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
});

describe('resume — turning a lost claim into a conflict the reviewer can read', () => {
  it('maps MissionRunNotResumableError to an ORPCError CONFLICT whose message carries no run id or internal status wording', async () => {
    signedIn();
    vi.mocked(resumeMission).mockRejectedValue(new MissionRunNotResumableError(4271));

    const rejection = await call(resume, { id: 4271 }).catch(err => err);

    expect(rejection).toBeInstanceOf(ORPCError);
    expect((rejection as InstanceType<typeof ORPCError>).code).toBe('CONFLICT');

    // This text reaches the reviewer's screen directly — it has to read as
    // plain "nothing to do here", not leak the run id or the internal
    // status name (`awaiting_review`/`running`) that decided the claim.
    const { message } = rejection as Error;

    expect(message).not.toContain('4271');
    expect(message).not.toMatch(/awaiting_review/i);
    expect(message).not.toMatch(/\brunning\b/i);
  });

  it('lets an unrelated error pass through unchanged, rather than masking it as a conflict', async () => {
    signedIn();
    vi.mocked(resumeMission).mockRejectedValue(new Error('database connection lost'));

    const rejection = await call(resume, { id: 1 }).catch(err => err);

    expect(rejection).not.toBeInstanceOf(ORPCError);
    expect((rejection as Error).message).toBe('database connection lost');
  });
});
