/**
 * A WORKFLOW'S `action` STEP RUNS ITS ACTION FOR REAL.
 *
 * The step proposes a registered action down the same path an agent's
 * `propose_action` takes (`ActionService.proposeAction`), as the workflow's
 * owning agent, so the trust ladder decides what happens: the action runs now,
 * or the run waits on the action's own card in Review and on Needs you. An
 * action that goes out or cannot be undone always waits for a person, and is
 * never offered "Always allow" (`libs/actions/outward.ts`).
 *
 * The action's result is the step's output (`{ ok, status, actionRunId,
 * action, result }`). When the run waited, the card's answer moves it
 * (`onWorkflowActionSettled`, from `ActionService`): done continues, turned
 * down stops the run with the reason, failed fails the step. A failed step
 * fails the run, except inside a repeat group, where it is a failed round
 * and the group's `until`, `max` and `onExhausted` decide.
 */
import type { ProposeResult } from '@/services/ActionService';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';

/** What one action step came to. */
export type ActionStepOutcome
  = | { kind: 'done'; output: ActionStepOutput }
    | { kind: 'failed'; error: string; output: ActionStepOutput }
    | { kind: 'waiting'; output: ActionStepOutput }
    | { kind: 'rejected'; reason: string; output: ActionStepOutput };

/** A step's output: what the action did, readable as `{{steps.<name>.output.*}}`. */
export type ActionStepOutput = {
  /** True once the action ran and did what it does. */
  ok: boolean;
  status: string;
  action: string;
  actionRunId: number | null;
  /** The action's own result: its record, its link, its line. */
  result?: Record<string, unknown> | null;
  error?: string;
  /** Why a run waits for a person, when it does. */
  why?: string;
  /** What is already happening, when the action said so instead of running. */
  underway?: string;
};

/**
 * The confidence the step proposes at: its number, or a reference read as one,
 * else 1 (the procedure asks for it outright; the kind's rung, risk and
 * reversibility decide).
 * @param value - The step's `confidence`, interpolated.
 */
export function stepConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

/**
 * An action run's outcome as the step reads it.
 * @param actionId - The action.
 * @param res - What proposing or executing it returned.
 * @param res.runId - The action run.
 * @param res.status - Its status.
 * @param res.result - Its result.
 * @param res.error - Its error.
 */
export function outcomeOf(actionId: string, res: { runId: number; status: string; result?: Record<string, unknown> | null; error?: string | null }): ActionStepOutcome {
  const base = { action: actionId, actionRunId: res.runId || null };
  switch (res.status) {
    case 'done':
      return { kind: 'done', output: { ...base, ok: true, status: 'done', result: res.result ?? null } };
    case 'failed': {
      const error = res.error?.trim() || 'the action failed';
      return { kind: 'failed', error, output: { ...base, ok: false, status: 'failed', error } };
    }
    case 'rejected': {
      const reason = res.error?.trim() || 'turned down';
      return { kind: 'rejected', reason, output: { ...base, ok: false, status: 'rejected', error: reason } };
    }
    case 'undone':
      return { kind: 'failed', error: 'the action was undone', output: { ...base, ok: false, status: 'undone', error: 'the action was undone' } };
    default:
      // pending, stale, approved, executing, awaiting_execution: it waits for a person (or for the work to be done).
      return { kind: 'waiting', output: { ...base, ok: false, status: res.status } };
  }
}

/**
 * Propose the step's action and say what came of it.
 * @param opts - The run, the step and the action.
 * @param opts.orgId - The workspace.
 * @param opts.runId - The workflow run.
 * @param opts.workflow - Its slug and owning agent.
 * @param opts.workflow.slug - The workflow's slug.
 * @param opts.workflow.agent - Its owning agent, who proposes.
 * @param opts.step - The step's name.
 * @param opts.label - The step's label.
 * @param opts.actionId - The registered action.
 * @param opts.input - Its input, interpolated.
 * @param opts.confidence - The step's confidence, interpolated.
 * @param opts.round - Inside a repeat group, the round: each round proposes its own run.
 */
export async function runActionStep(opts: {
  orgId: string;
  runId: number;
  workflow: { slug: string; agent?: string | null };
  step: string;
  label: string;
  actionId: string;
  input: Record<string, unknown>;
  confidence?: unknown;
  round?: number;
}): Promise<ActionStepOutcome> {
  const [{ getAction }, { isOutwardOrIrreversible, OUTWARD_HOLD_REASON }, { ActionError, proposeAction }] = await Promise.all([
    import('@/libs/actions/registry'),
    import('@/libs/actions/outward'),
    import('@/services/ActionService'),
  ]);
  const action = getAction(opts.actionId)!;
  const outward = isOutwardOrIrreversible(action, opts.input);
  let res: ProposeResult;
  try {
    res = await proposeAction({
      orgId: opts.orgId,
      actionId: action.id,
      input: opts.input,
      principal: {
        kind: 'agent',
        id: opts.workflow.agent ? `agent:${opts.workflow.agent}` : `workflow:${opts.workflow.slug}`,
        scope: { orgId: opts.orgId },
        grants: ['*'],
        // Working autonomy, as an agent's own proposal: the ladder decides.
        autonomy: 2,
      },
      invokedBy: `workflow:${opts.workflow.slug}:${opts.runId}`,
      // One run per step (per round). An action that owns its key keeps its own.
      dedupKey: `workflow-run:${opts.runId}:${opts.step}${opts.round ? `:r${opts.round}` : ''}`,
      proposal: {
        confidence: stepConfidence(opts.confidence),
        rationale: `Step "${opts.label}" of the workflow ${opts.workflow.slug} (run #${opts.runId}).`,
        ...(opts.workflow.agent ? { agentSlug: opts.workflow.agent } : {}),
        suggestedDecision: null,
        suggestedDecisionReason: null,
        workflow: { runId: opts.runId, step: opts.step },
      },
      ...(outward ? { hold: OUTWARD_HOLD_REASON } : {}),
    });
  } catch (err) {
    // Refused before anything ran: the input does not fit, the action's own
    // check said no, or a gate returned it. The step failed, and says why.
    const error = err instanceof ActionError || err instanceof Error ? err.message : String(err);
    return { kind: 'failed', error, output: { ok: false, status: 'refused', action: action.id, actionRunId: null, error } };
  }
  if (res.outcome === 'already_underway') {
    return { kind: 'done', output: { ok: true, status: 'underway', action: action.id, actionRunId: null, underway: res.underway?.line } };
  }
  if (res.outcome === 'already_decided') {
    // A person judged this exact record already: its earlier run is the answer.
    const [earlier] = await db.select({ status: actionRunSchema.status, result: actionRunSchema.result, error: actionRunSchema.error }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, opts.orgId), eq(actionRunSchema.id, res.runId))).limit(1);
    return outcomeOf(action.id, { runId: res.runId, status: earlier?.status ?? res.status, result: earlier?.result ?? null, error: earlier?.error ?? null });
  }
  const outcome = outcomeOf(action.id, res);
  if (outcome.kind === 'waiting') {
    outcome.output.why = outward ? OUTWARD_HOLD_REASON : 'the trust ladder holds this kind for a person';
  }
  return outcome;
}

/**
 * An action run a workflow step proposed settled: move its workflow run. Read
 * from the run itself, so a late or repeated call changes nothing.
 * @param orgId - The workspace.
 * @param actionRunId - The action run.
 */
export async function onWorkflowActionSettled(orgId: string, actionRunId: number): Promise<void> {
  const [run] = await db
    .select({ actionId: actionRunSchema.actionId, status: actionRunSchema.status, result: actionRunSchema.result, error: actionRunSchema.error, proposal: actionRunSchema.proposal, decidedBy: actionRunSchema.decidedBy })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, actionRunId)))
    .limit(1);
  const link = (run?.proposal as { workflow?: { runId?: number; step?: string } } | null)?.workflow;
  if (!run || typeof link?.runId !== 'number' || !link.step) {
    return;
  }
  const outcome = outcomeOf(run.actionId, { runId: actionRunId, status: run.status, result: run.result, error: run.error });
  if (outcome.kind === 'waiting') {
    return;
  }
  if (outcome.kind === 'rejected' && run.decidedBy) {
    outcome.reason = `${run.decidedBy} turned it down${run.error ? `: ${run.error}` : ''}`;
  }
  const { settleActionStep } = await import('@/services/WorkflowService');
  await settleActionStep(link.runId, orgId, link.step, actionRunId, outcome);
}
