/**
 * What the in-app propose route carries into the proposal envelope.
 *
 * This is the door a surface inside Vocion uses to put an agent's suggestion
 * in the queue, and it is the one boundary where a field can go missing
 * silently: the route validates its own input, so anything it does not name is
 * dropped without an error. The recommendation and the sentence explaining it
 * have to arrive together or the queue shows a verdict nobody can check.
 *
 * Calling the procedure directly runs its handler, not its input schema, so
 * the vocabulary guard — that only the three recommendations are accepted —
 * is asserted where it actually runs: over HTTP, in
 * `e2e/reviews-suggested-decision`, and in `writeApi.test.ts` for the public
 * endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

// Review.ts pulls the workflow stack in at module load; mocked wholesale the
// way the sibling router tests do, so this file imports in the unit
// environment.
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

vi.mock('@/services/ActionService', () => ({
  proposeAction: vi.fn(async () => ({ runId: 7, status: 'pending', outcome: 'created' })),
}));

const { guardAuth } = await import('./AuthGuards');
const { proposeAction } = await import('@/services/ActionService');
const { proposeFromRecommendationRoute } = await import('./Review');

const ORG = 'org_propose_route';

/**
 * Call an oRPC procedure directly, bypassing the HTTP layer.
 * @param route - The exported procedure.
 * @param input - The validated input payload.
 */
function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

/**
 * The envelope the route handed `proposeAction` on its last call.
 */
function lastProposal(): Record<string, unknown> {
  const [first] = vi.mocked(proposeAction).mock.calls.at(-1) ?? [];
  return (first as { proposal?: Record<string, unknown> })?.proposal ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(guardAuth).mockResolvedValue({ orgId: ORG, userId: 'usr_chris' } as never);
});

describe('proposeFromRecommendationRoute', () => {
  it('carries the recommendation and its reason into the envelope', async () => {
    await call(proposeFromRecommendationRoute, {
      actionId: 'objects.propose_candidate',
      input: { id: 1 },
      agentSlug: 'listing-scout',
      confidence: 0.9,
      suggestedDecision: 'reject',
      suggestedDecisionReason: 'Third listing of this same show this week.',
    });

    expect(lastProposal()).toMatchObject({
      suggestedDecision: 'reject',
      suggestedDecisionReason: 'Third listing of this same show this week.',
    });
  });

  it('trims the reason rather than storing the padding a caller sent', async () => {
    await call(proposeFromRecommendationRoute, {
      actionId: 'objects.propose_candidate',
      input: { id: 1 },
      suggestedDecision: 'snooze',
      suggestedDecisionReason: '   The venue has not confirmed the date.   ',
    });

    expect(lastProposal().suggestedDecisionReason).toBe('The venue has not confirmed the date.');
  });

  it('reads a blank reason as none, never as an empty sentence', async () => {
    // A whitespace-only string would reach the review card as an empty quote
    // under the badge, which reads as the agent having said something.
    await call(proposeFromRecommendationRoute, {
      actionId: 'objects.propose_candidate',
      input: { id: 1 },
      suggestedDecision: 'approve',
      suggestedDecisionReason: '   ',
    });

    expect(lastProposal().suggestedDecisionReason).toBeUndefined();
  });
});
