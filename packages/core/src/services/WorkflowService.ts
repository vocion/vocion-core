import type { StepResult } from '@/libs/workflows/stepResult';
import type { AgentWorkflowStep, RepeatInnerWorkflowStep, RepeatWorkflowStep, WorkflowManifest, WorkflowStep } from '@/libs/workspace/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { evaluateCondition, interpolateString, interpolateText, interpolateValue } from '@/libs/workflows/expressions';
import { isSettled } from '@/libs/workflows/stepResult';
import { getCurrentWorkspaceSha } from '@/libs/workspace';
import { workflowRunSchema, workflowSchema } from '@/models/Schema';

/**
 * Workflow execution — a fixed procedure, the same structure on every run.
 *
 *   - Steps run in order: `agent` (one agent, one bounded task, ADR 0011),
 *     `repeat` (a group run again until a condition, at most `max` rounds),
 *     `sync`, `action`, and the human gates `approve` and `ask`.
 *   - Any step may carry a `when` (skipped when false) and a `label` (what a
 *     person reads while it runs). A run's own label comes from the
 *     workflow's `runLabel`, interpolated from its input at start.
 *   - `action` steps are stubs that record intent, except the ones that run:
 *     `routine.run` (a routine batch) and `workflow.start` (one child run per
 *     item — fan-out).
 *   - Durable: each run is owned by a durable run (`workflows/durableWorkflowRun.ts`)
 *     that advances it, waits on its gate, and survives restarts. Every
 *     finished step is persisted before the next starts, so a restart re-runs
 *     only the step it interrupted (and says so on the step: `attempt`).
 *   - Approval gating: an `approve` step pauses the run on a Decision
 *     (`workflows/approvals.ts`); answering it resumes or stops the run.
 *
 * Persistence model: one `workflow_run` row per execution. `step_results` is
 * a JSONB map keyed by step name (`libs/workflows/stepResult.ts`) so partial
 * state is written as it goes and the run page reads it without joins.
 */

export type { StepResult };

export type StartWorkflowOpts = {
  orgId: string;
  slug: string;
  input?: Record<string, unknown>;
  triggerContext?: Record<string, unknown>;
  invokedBy?: string;
};

export type WorkflowRunSummary = {
  id: number;
  workflowId: number;
  workflowSlug: string;
  /** What this run is called (`input.runLabel`, from the workflow's `runLabel`), or null. */
  runLabel: string | null;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStep: number | null;
  pauseReason: string | null;
  stepResults: Record<string, StepResult>;
  error: string | null;
  workspaceSha: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

/** The input key a run's label rides on — the same one an automation fire's does (`libs/work/runLabel.ts`). */
export const RUN_LABEL_INPUT_KEY = 'runLabel';

/** A step started this many times without finishing (a restart each time) fails rather than loop. */
const MAX_STEP_STARTS = 3;

/** The most child runs one `workflow.start` step may start. */
const MAX_FAN_OUT = 50;

/**
 * Raised when the run is no longer `paused` — another resume claimed it, or
 * it completed, failed or was cancelled since this caller read it. Carries
 * the reason so the route can log it and tell the reviewer something better
 * than "something went wrong".
 */
export class WorkflowRunNotResumableError extends Error {
  constructor(runId: number, reason: string) {
    super(`workflow_run ${runId} is not resumable: ${reason}`);
    this.name = 'WorkflowRunNotResumableError';
  }
}

/**
 * Create a run and hand it to its durable owner, without waiting on it.
 * @param opts - What to start.
 */
async function createWorkflowRun(opts: StartWorkflowOpts): Promise<{ id: number; runLabel: string | null }> {
  const workflow = await db.query.workflowSchema.findFirst({
    where: and(eq(workflowSchema.orgId, opts.orgId), eq(workflowSchema.slug, opts.slug)),
  });
  if (!workflow) {
    throw new Error(`workflow "${opts.slug}" not found`);
  }
  if (workflow.status !== 'active') {
    throw new Error(`workflow "${opts.slug}" is ${workflow.status}; cannot start`);
  }

  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId);
  const input = { ...(opts.input ?? {}) };
  const triggerContext = opts.triggerContext ?? {};
  // The run is named once, from what it was started with. A caller that
  // already knows the record names it itself (`input.runLabel`).
  if (workflow.runLabel && typeof input[RUN_LABEL_INPUT_KEY] !== 'string') {
    const label = interpolateText(workflow.runLabel, { input, trigger: triggerContext, steps: {} }).replace(/\s+/g, ' ').trim();
    if (label) {
      input[RUN_LABEL_INPUT_KEY] = label;
    }
  }

  const [run] = await db.insert(workflowRunSchema).values({
    orgId: opts.orgId,
    workflowId: workflow.id,
    input,
    triggerContext,
    status: 'running',
    currentStep: 0,
    stepResults: {},
    workspaceSha,
    createdBy: opts.invokedBy ?? 'mcp',
  }).returning();

  await startDurableRun(opts.orgId, run!.id);
  return { id: run!.id, runLabel: typeof input[RUN_LABEL_INPUT_KEY] === 'string' ? input[RUN_LABEL_INPUT_KEY] as string : null };
}

export async function startWorkflow(opts: StartWorkflowOpts): Promise<WorkflowRunSummary> {
  const { id } = await createWorkflowRun(opts);
  return settled(id);
}

/**
 * Resume a paused run. An `ask` step resumes with the person's text; an
 * `approve` step with who approved it, when the caller knows.
 * @param runId - The run.
 * @param orgId - The workspace.
 * @param payload - The answer.
 * @param payload.input - An ask step's text.
 * @param payload.approval - An approve step's approval: who, their note, where, and the Decision.
 * @param payload.approval.by - Who approved.
 * @param payload.approval.note - Their note.
 * @param payload.approval.via - Where they answered.
 * @param payload.approval.askId - The Decision they answered.
 * @param opts - How long the caller is held.
 * @param opts.wait - False: return as soon as the run is moving, without waiting for it to settle (a Decision's answer, which a person is not waiting on here).
 */
export async function resumeWorkflow(runId: number, orgId: string, payload?: { input?: string; approval?: { by: string; note?: string | null; via?: string | null; askId?: number } }, opts: { wait?: boolean } = {}): Promise<WorkflowRunSummary> {
  const [run] = await db
    .select()
    .from(workflowRunSchema)
    .where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.orgId, orgId)));
  if (!run) {
    throw new Error(`workflow_run ${runId} not found`);
  }
  if (run.status !== 'paused') {
    throw new WorkflowRunNotResumableError(runId, `status is ${run.status}, not paused`);
  }
  // A run waiting on an action's card moves when the card is decided: the
  // action is what was asked for, and resuming past it would skip it.
  if (run.pauseReason?.startsWith('awaiting_action:')) {
    throw new WorkflowRunNotResumableError(runId, `it waits on the card for its "${run.pauseReason.slice('awaiting_action:'.length)}" step: approve or turn that down instead`);
  }

  // Mark the current (approve | ask) step complete and advance the cursor —
  // otherwise the loop would sit on the same step and re-pause.
  const stepResults = { ...(run.stepResults as Record<string, StepResult>) };
  const currentIdx = run.currentStep ?? 0;
  const [wf] = await db.select().from(workflowSchema).where(eq(workflowSchema.id, run.workflowId));
  const steps = (wf?.steps ?? []) as unknown as WorkflowStep[];
  const currentStep = steps[currentIdx];
  if (currentStep && currentStep.type === 'ask') {
    // An ask step resumes WITH data — the human's text becomes the step's
    // output, interpolable downstream via {{steps.<name>.output}}.
    if (payload?.input === undefined || payload.input === '') {
      throw new Error(`workflow_run ${runId} is awaiting input for step "${currentStep.name}"; pass { input } to resume`);
    }
    stepResults[currentStep.name] = {
      ...stepResults[currentStep.name]!,
      status: 'completed',
      output: payload.input,
      finishedAt: new Date().toISOString(),
    };
  } else if (currentStep && currentStep.type === 'approve') {
    const previous = stepResults[currentStep.name];
    const shown = previous?.output && typeof previous.output === 'object' ? previous.output as Record<string, unknown> : {};
    stepResults[currentStep.name] = {
      ...previous!,
      status: 'completed',
      // Who approved, and what they said, is the step's output: a later step
      // can carry the note (`{{steps.<name>.output.note}}`).
      output: { ...shown, approved: true, ...(payload?.approval ? { approvedBy: payload.approval.by, note: payload.approval.note ?? null, via: payload.approval.via ?? null } : {}) },
      finishedAt: new Date().toISOString(),
    };
  }

  // The `paused` check above cannot decide this on its own: two concurrent
  // resumes both read before either writes, so both would reach here and
  // run the same steps twice. Keeping the predicate inside the UPDATE hands
  // the decision to Postgres, whose row lock makes the loser re-evaluate
  // against the winner's committed row and match nothing. Zero rows back is
  // how it learns it lost. Same claim as SourceSyncService.beginSync.
  const claimed = await db.update(workflowRunSchema)
    .set({
      status: 'running',
      pauseReason: null,
      pausedAt: null,
      stepResults,
      currentStep: currentIdx + 1,
    })
    .where(and(
      eq(workflowRunSchema.id, runId),
      eq(workflowRunSchema.orgId, orgId),
      eq(workflowRunSchema.status, 'paused'),
    ))
    .returning({ id: workflowRunSchema.id });

  if (claimed.length === 0) {
    throw new WorkflowRunNotResumableError(runId, 'another request already resumed it, or its status changed since this request read it');
  }

  // Resumed somewhere other than its Decision (the review queue, the API):
  // the Decision closes, so nobody answers it again.
  if (!payload?.approval?.askId) {
    const { closeWorkflowAsks } = await import('@/services/workflows/approvals');
    await closeWorkflowAsks(orgId, runId, 'The run was resumed from its page.').catch((err: Error) => console.warn('[workflow] the run\'s Decision was not closed', { runId, message: err.message }));
  }

  await wakeDurableRun(orgId, runId);
  return settled(runId, opts.wait === false ? 0 : undefined);
}

/**
 * The run's durable owner advances it: a message to the run waiting on its
 * mailbox, or — for a run paused before runs were durable — a start, which
 * advances from the cursor just claimed.
 * @param orgId - The workspace.
 * @param runId - The workflow run.
 */
async function wakeDurableRun(orgId: string, runId: number): Promise<void> {
  const { durable, durableIdFor } = await import('@/libs/durable');
  const id = durableIdFor(orgId, 'workflow-run', runId);
  if ((await durable().state(id)) === 'pending') {
    await durable().signal(id, 'resume', { resumedAt: new Date().toISOString() });
  } else {
    await startDurableRun(orgId, runId);
  }
}

/**
 * Where a step sits: at the top, or inside a repeat group.
 * @param steps - The workflow's steps.
 * @param name - The step's name.
 */
function locateStep(steps: WorkflowStep[], name: string): { index: number; inner?: number } | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.name === name) {
      return { index: i };
    }
    if (step.type === 'repeat') {
      const j = step.steps.findIndex(s => s.name === name);
      if (j >= 0) {
        return { index: i, inner: j };
      }
    }
  }
  return null;
}

/**
 * An action a step proposed was decided, ran or failed while the run waited
 * on it (`workflows/actionSteps.ts`): record what came of it and move the
 * run. Done goes on; turned down stops the run with the reason; failed fails
 * the step — the run, or inside a repeat group a round. A run that is not
 * waiting on this action (it moved, or was stopped) is left alone.
 * @param runId - The workflow run.
 * @param orgId - The workspace.
 * @param stepName - The action step.
 * @param actionRunId - The action run it waits on.
 * @param outcome - What came of it.
 */
export async function settleActionStep(runId: number, orgId: string, stepName: string, actionRunId: number, outcome: import('@/services/workflows/actionSteps').ActionStepOutcome): Promise<void> {
  const [run] = await db.select().from(workflowRunSchema).where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.orgId, orgId)));
  if (!run || run.status !== 'paused' || run.pauseReason !== `awaiting_action:${stepName}`) {
    return;
  }
  const stepResults = { ...(run.stepResults as Record<string, StepResult>) };
  const prev = stepResults[stepName];
  if (!prev || (prev.output as { actionRunId?: number } | undefined)?.actionRunId !== actionRunId) {
    return;
  }
  const [wf] = await db.select().from(workflowSchema).where(eq(workflowSchema.id, run.workflowId));
  const where = locateStep((wf?.steps ?? []) as unknown as WorkflowStep[], stepName);
  if (!where) {
    return;
  }
  const finishedAt = new Date().toISOString();
  if (outcome.kind === 'rejected') {
    stepResults[stepName] = { ...prev, status: 'failed', output: outcome.output, error: outcome.reason, finishedAt };
    await db.update(workflowRunSchema).set({ stepResults }).where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.status, 'paused')));
    await cancelWorkflow(runId, orgId, `"${prev.label ?? stepName}" was turned down: ${outcome.reason}`);
    return;
  }
  const inGroup = where.inner !== undefined;
  if (outcome.kind === 'failed' && !inGroup) {
    stepResults[stepName] = { ...prev, status: 'failed', output: outcome.output, error: outcome.error, finishedAt };
    await db.update(workflowRunSchema)
      .set({ stepResults, status: 'failed', error: `step "${prev.label ?? stepName}" failed: ${outcome.error}`, completedAt: new Date(), pauseReason: null, pausedAt: null })
      .where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.status, 'paused')));
    return;
  }
  stepResults[stepName] = outcome.kind === 'done'
    ? { ...prev, status: 'completed', output: outcome.output, finishedAt }
    : { ...prev, status: 'failed', output: outcome.output, error: outcome.kind === 'failed' ? outcome.error : undefined, finishedAt };
  let currentStep = where.index + 1;
  if (inGroup) {
    // The group picks up after this step, where its `until` is read first.
    const group = steps0(wf)[where.index]!;
    const g = stepResults[group.name];
    stepResults[group.name] = { ...g!, repeat: { ...(g?.repeat ?? { round: 1, max: 1 }), next: where.inner! + 1 } };
    currentStep = where.index;
  }
  const claimed = await db.update(workflowRunSchema)
    .set({ status: 'running', pauseReason: null, pausedAt: null, stepResults, currentStep })
    .where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.orgId, orgId), eq(workflowRunSchema.status, 'paused')))
    .returning({ id: workflowRunSchema.id });
  if (claimed.length > 0) {
    await wakeDurableRun(orgId, runId);
  }
}

/**
 * A workflow row's steps.
 * @param wf - The workflow row.
 */
function steps0(wf: typeof workflowSchema.$inferSelect | undefined): WorkflowStep[] {
  return (wf?.steps ?? []) as unknown as WorkflowStep[];
}

export async function cancelWorkflow(runId: number, orgId: string, reason?: string): Promise<WorkflowRunSummary> {
  const [run] = await db
    .update(workflowRunSchema)
    .set({ status: 'cancelled', error: reason ?? null, completedAt: new Date() })
    .where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.orgId, orgId)))
    .returning();
  if (!run) {
    throw new Error(`workflow_run ${runId} not found`);
  }
  // A person's cancel ends the durable run too, so nothing resumes it.
  const { durable, durableIdFor } = await import('@/libs/durable');
  await durable().cancel(durableIdFor(orgId, 'workflow-run', runId)).catch((err: Error) => console.warn('[workflow] the durable run was not cancelled', { runId, message: err.message }));
  const { closeWorkflowAsks } = await import('@/services/workflows/approvals');
  await closeWorkflowAsks(orgId, runId, reason ? `The run was stopped: ${reason}` : 'The run was stopped.').catch((err: Error) => console.warn('[workflow] the run\'s Decision was not closed', { runId, message: err.message }));
  // A card the run was waiting on is withdrawn with it: nothing is left to approve.
  const waitingOn = run.pauseReason?.startsWith('awaiting_action:') ? (run.stepResults as Record<string, StepResult>)[run.pauseReason.slice('awaiting_action:'.length)] : undefined;
  const actionRunId = (waitingOn?.output as { actionRunId?: number } | undefined)?.actionRunId;
  if (typeof actionRunId === 'number') {
    const { rejectAction } = await import('@/services/ActionService');
    await rejectAction(actionRunId, orgId, reason ? `The workflow run was stopped: ${reason}` : 'The workflow run was stopped.', { reviewedBy: `workflow:${runId}` }).catch((err: Error) => console.warn('[workflow] the action card was not withdrawn', { runId, actionRunId, message: err.message }));
  }
  return summarize(run);
}

export async function getWorkflowRun(runId: number, orgId: string): Promise<WorkflowRunSummary | null> {
  const [row] = await db
    .select()
    .from(workflowRunSchema)
    .where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.orgId, orgId)));
  return row ? summarize(row) : null;
}

export async function listWorkflowRuns(orgId: string, filters?: { workflowSlug?: string; status?: string; limit?: number }) {
  const conditions = [eq(workflowRunSchema.orgId, orgId)];
  if (filters?.status) {
    conditions.push(eq(workflowRunSchema.status, filters.status));
  }
  if (filters?.workflowSlug) {
    const wf = await db.query.workflowSchema.findFirst({
      where: and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.slug, filters.workflowSlug)),
    });
    if (!wf) {
      return [];
    }
    conditions.push(eq(workflowRunSchema.workflowId, wf.id));
  }
  const rows = await db
    .select()
    .from(workflowRunSchema)
    .where(and(...conditions))
    .orderBy(desc(workflowRunSchema.createdAt))
    .limit(filters?.limit ?? 20);
  return rows.map(summarize);
}

/**
 * Start the run's durable owner (idempotent: one owner per run).
 * @param orgId - The workspace.
 * @param runId - The workflow run.
 */
async function startDurableRun(orgId: string, runId: number): Promise<void> {
  const { durable, durableIdFor } = await import('@/libs/durable');
  await import('@/services/workflows/durableWorkflowRun');
  await durable().start('vocion.workflow-run', durableIdFor(orgId, 'workflow-run', runId), { runId });
}

/**
 * The run as it stands once it stops moving on its own (paused, ended or
 * failed), or as it is after `waitMs` while a long step still runs.
 * @param runId - The workflow run.
 * @param waitMs - How long a caller is held.
 */
async function settled(runId: number, waitMs = 60_000): Promise<WorkflowRunSummary> {
  const started = Date.now();
  let delay = 20;
  for (;;) {
    const [row] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
    if (!row) {
      throw new Error(`workflow_run ${runId} not found`);
    }
    if (row.status !== 'running' || Date.now() - started > waitMs) {
      return summarize(row);
    }
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 2, 500);
  }
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

type Scope = {
  input: Record<string, unknown>;
  steps: Record<string, { output: unknown }>;
  trigger: Record<string, unknown>;
  repeat?: { round: number; max: number };
};

/** One segment's working state. */
type RunState = {
  run: typeof workflowRunSchema.$inferSelect;
  workflow: typeof workflowSchema.$inferSelect;
  stepResults: Record<string, StepResult>;
  scope: Scope;
  runLabel: string | null;
  /** The top-level step being run. */
  cursor: number;
};

/** What running one step did to the run. */
type StepOutcome = 'done' | 'paused';

/** The run stopped being this segment's to write (a person cancelled it): stop, write nothing more. */
class RunStopped extends Error {
  constructor() {
    super('the run was stopped while a step ran');
    this.name = 'RunStopped';
  }
}

/** A step's failure, with the step it happened in. */
class StepFailed extends Error {
  constructor(public readonly step: string, message: string) {
    super(message);
    this.name = 'StepFailed';
  }
}

/**
 * The first sentence of a text, as a short label.
 * @param text - A task or a prompt.
 */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? flat.slice(0, end) : flat;
  return sentence.length > 90 ? `${sentence.slice(0, 89).trimEnd()}…` : sentence;
}

/**
 * What a person reads for a step while it runs: its authored `label`,
 * interpolated, else the first sentence of what it does. Inside a repeat
 * group the round is said unless the label says it itself.
 * @param step - The step.
 * @param scope - What the run can read.
 */
function stepLabel(step: WorkflowStep | RepeatInnerWorkflowStep, scope: Scope): string {
  const authored = step.label ? interpolateText(step.label, scope).replace(/\s+/g, ' ').trim() : '';
  const fallback = step.type === 'agent'
    ? firstSentence(interpolateText(step.task ?? (step as { prompt?: string }).prompt ?? '', scope))
    : step.type === 'approve' || step.type === 'ask'
      ? firstSentence(interpolateText(step.prompt, scope))
      : step.type === 'sync'
        ? `Refreshing ${step.sources.join(', ')}`
        : step.name;
  const label = authored || fallback || step.name;
  if (scope.repeat && !(step.label ?? '').includes('repeat.')) {
    return `${label} · round ${scope.repeat.round} of ${scope.repeat.max}`;
  }
  return label;
}

/**
 * One segment of a run: picks up at currentStep and runs forward until either:
 *   - steps array exhausted → status = completed
 *   - an approve or ask step is hit → status = paused (resumed later)
 *   - a step throws → status = failed
 *
 * The durable run (`workflows/durableWorkflowRun.ts`) calls it on start and
 * after each resume. A function of (run state + workflow definition), so a
 * segment replayed after a crash picks up from the persisted cursor: every
 * finished step is written before the next one starts, and the step a crash
 * interrupted runs again.
 * @param runId - The workflow run.
 */
export async function advanceWorkflowRun(runId: number): Promise<WorkflowRunSummary> {
  const [run] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
  if (!run) {
    throw new Error(`workflow_run ${runId} not found after start`);
  }
  // A run a person stopped (or that already ended) is not advanced again.
  if (run.status !== 'running') {
    return summarize(run);
  }
  const [workflow] = await db.select().from(workflowSchema).where(eq(workflowSchema.id, run.workflowId));
  if (!workflow) {
    throw new Error(`workflow ${run.workflowId} missing for run ${runId}`);
  }

  const steps = (workflow.steps ?? []) as unknown as WorkflowStep[];
  const stepResults: Record<string, StepResult> = { ...(run.stepResults as Record<string, StepResult>) };
  const input = (run.input as Record<string, unknown>) ?? {};
  const state: RunState = {
    run,
    workflow,
    stepResults,
    scope: { input, steps: collectOutputs(steps, stepResults), trigger: (run.triggerContext as Record<string, unknown>) ?? {} },
    runLabel: typeof input[RUN_LABEL_INPUT_KEY] === 'string' ? input[RUN_LABEL_INPUT_KEY] as string : null,
    cursor: run.currentStep ?? 0,
  };
  const current = async () => {
    const [row] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
    return summarize(row!);
  };

  let cursor = state.cursor;
  while (cursor < steps.length) {
    const step = steps[cursor]!;
    state.cursor = cursor;
    try {
      const outcome = await runStep(state, step, cursor);
      if (outcome === 'paused') {
        const [paused] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
        return summarize(paused!);
      }
    } catch (err) {
      if (err instanceof RunStopped) {
        return current();
      }
      const message = err instanceof Error ? err.message : String(err);
      const failedStep = err instanceof StepFailed ? err.step : step.name;
      const finishedAt = new Date().toISOString();
      stepResults[failedStep] = { ...stepResults[failedStep]!, status: 'failed', error: message, finishedAt };
      // A step inside a repeat group failed: so did the group.
      if (failedStep !== step.name && stepResults[step.name]) {
        stepResults[step.name] = { ...stepResults[step.name]!, status: 'failed', error: `"${stepResults[failedStep]?.label ?? failedStep}" failed`, finishedAt };
      }
      await persistState(runId, {
        stepResults,
        currentStep: cursor,
        status: 'failed',
        error: `step "${stepResults[failedStep]?.label ?? failedStep}" failed: ${message}`,
        completedAt: new Date(),
      });
      const [failed] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
      return summarize(failed!);
    }
    cursor += 1;
    // Written before the next step starts: a restart from here re-runs nothing that finished.
    if (!(await persistState(runId, { stepResults, currentStep: cursor }))) {
      return current();
    }
  }

  await persistState(runId, {
    stepResults,
    currentStep: cursor,
    status: 'completed',
    completedAt: new Date(),
  });
  const [done] = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.id, runId));
  return summarize(done!);
}

/**
 * Begin a step: its label, its start, and how many times it was started. A
 * step found `running` was interrupted (the process stopped mid-step) and
 * runs again; past {@link MAX_STEP_STARTS} it fails instead of looping.
 * @param state - The run.
 * @param step - The step.
 * @param cursor - The top-level step index, persisted with it.
 * @param round - Inside a repeat group, the round.
 */
async function beginStep(state: RunState, step: WorkflowStep | RepeatInnerWorkflowStep, cursor: number, round?: number): Promise<StepResult> {
  const prev = state.stepResults[step.name];
  const interrupted = prev?.status === 'running' && (round === undefined || prev.round === round);
  const attempt = interrupted ? (prev.attempt ?? 1) + 1 : 1;
  const label = stepLabel(step, state.scope);
  const previous = carryPrevious(prev, round);
  const result: StepResult = {
    status: 'running',
    label,
    startedAt: interrupted && prev.startedAt ? prev.startedAt : new Date().toISOString(),
    attempt,
    ...(round !== undefined ? { round } : {}),
    ...(previous?.length ? { previous } : {}),
    // What an interrupted step had already done (a fan-out's started runs) is kept.
    ...(interrupted && prev.output !== undefined ? { output: prev.output } : {}),
  };
  state.stepResults[step.name] = result;
  if (attempt > MAX_STEP_STARTS) {
    throw new StepFailed(step.name, `it was interrupted ${attempt - 1} times before it could finish, so it was not started again`);
  }
  if (!(await persistState(state.run.id, { stepResults: state.stepResults, currentStep: cursor }))) {
    throw new RunStopped();
  }
  return result;
}

/**
 * A repeated step's earlier rounds, with the last one added when a new round begins.
 * @param prev - The step's result so far.
 * @param round - The round starting, or undefined outside a repeat group.
 */
function carryPrevious(prev: StepResult | undefined, round: number | undefined): StepResult['previous'] {
  if (round !== undefined && prev && prev.round !== undefined && prev.round !== round && isSettled(prev.status)) {
    return [...(prev.previous ?? []), { round: prev.round, status: prev.status, ...(prev.output !== undefined ? { output: prev.output } : {}), ...(prev.error ? { error: prev.error } : {}), ...(prev.finishedAt ? { finishedAt: prev.finishedAt } : {}) }];
  }
  return prev?.previous;
}

/**
 * Finish a step with its output, and make the output readable downstream.
 * @param state - The run.
 * @param name - The step.
 * @param output - What it produced.
 * @param extra - More to record on the result.
 * @param alias - The name later steps read it by, when not its own.
 */
function finishStep(state: RunState, name: string, output: unknown, extra: Partial<StepResult> = {}, alias?: string): void {
  state.stepResults[name] = { ...state.stepResults[name]!, ...extra, status: 'completed', output, finishedAt: new Date().toISOString() };
  state.scope.steps[alias ?? name] = { output };
}

/**
 * Run one top-level step.
 * @param state - The run.
 * @param step - The step.
 * @param cursor - Its index.
 */
async function runStep(state: RunState, step: WorkflowStep, cursor: number): Promise<StepOutcome> {
  if (await skipped(state, step, cursor)) {
    return 'done';
  }
  if (step.type === 'repeat') {
    return runRepeat(state, step, cursor);
  }
  await beginStep(state, step, cursor);
  if (step.type === 'approve') {
    return pauseForApproval(state, step, cursor);
  }
  if (step.type === 'ask') {
    return askStep(state, step, cursor);
  }
  return runWork(state, step, cursor);
}

/**
 * Skip a step whose `when` is false; say so on it.
 * @param state - The run.
 * @param step - The step.
 * @param cursor - Its top-level index.
 */
async function skipped(state: RunState, step: WorkflowStep | RepeatInnerWorkflowStep, cursor: number): Promise<boolean> {
  if (!step.when) {
    return false;
  }
  let holds: boolean;
  try {
    holds = evaluateCondition(step.when, state.scope);
  } catch (err) {
    throw new StepFailed(step.name, `its condition could not be read: ${(err as Error).message}`);
  }
  if (holds) {
    return false;
  }
  const prev = state.stepResults[step.name];
  const previous = carryPrevious(prev, state.scope.repeat?.round);
  state.stepResults[step.name] = {
    ...(previous?.length ? { previous } : {}),
    ...(state.scope.repeat ? { round: state.scope.repeat.round } : {}),
    status: 'skipped',
    label: stepLabel(step, state.scope),
    skippedBecause: step.when,
    finishedAt: new Date().toISOString(),
  };
  if (!(await persistState(state.run.id, { stepResults: state.stepResults, currentStep: cursor }))) {
    throw new RunStopped();
  }
  return true;
}

/**
 * The work steps, which finish on their own: agent, sync, action (and the
 * legacy agent rows from before 0.2).
 * @param state - The run.
 * @param step - The step.
 * @param cursor
 */
async function runWork(state: RunState, step: WorkflowStep | RepeatInnerWorkflowStep, cursor: number): Promise<StepOutcome> {
  const { run, scope } = state;
  const name = step.name;
  if (step.type === 'agent') {
    if ((step as { task?: string }).task === undefined && (step as { prompt?: string }).prompt !== undefined) {
      // A row authored on v1.54 (`agent` + `prompt` + `outputAs`): run as the text step it was.
      const legacy = step as unknown as AgentWorkflowStep & { prompt: string; outputAs?: string };
      await runAgentWork(state, { ...legacy, task: legacy.prompt }, legacy.outputAs);
      return 'done';
    }
    await runAgentWork(state, step);
    return 'done';
  }
  if (step.type === 'sync') {
    // Freshness gate: incrementally sync the named sources so downstream
    // agent steps read live data (last-hours mail, current CRM state),
    // not index-freshness. Per-source failures are recorded, not fatal —
    // a dead connector degrades the read; it shouldn't kill the briefing.
    const { runSync } = await import('@/services/SourceSyncService');
    const { knowledgeSourceSchema } = await import('@/models/Schema');
    const results: Record<string, string> = {};
    for (const slug of step.sources) {
      try {
        const [src] = await db
          .select({ id: knowledgeSourceSchema.id })
          .from(knowledgeSourceSchema)
          .where(and(eq(knowledgeSourceSchema.orgId, run.orgId), eq(knowledgeSourceSchema.slug, slug)));
        if (!src) {
          results[slug] = 'unknown source';
          continue;
        }
        const r = await runSync({ orgId: run.orgId, sourceId: src.id, incremental: true });
        results[slug] = `synced (${r.created} new, ${r.updated} updated${r.errors ? `, ${r.errors} errors` : ''})`;
      } catch (err) {
        results[slug] = `sync failed: ${(err as Error).message.slice(0, 120)}`;
      }
    }
    finishStep(state, name, results);
    return 'done';
  }
  if (step.type === 'action' && step.action === 'routine.run') {
    // An action that runs: the routine for the rows given, as a batch under its approved version
    // and trust level (`services/routines/RoutineService.ts`). The step completes once the batch
    // is started; its runs report on the batch, and its escalations reach the routine's expert.
    const actionInput = interpolateValue(step.input, scope) as Record<string, unknown>;
    const { findRoutine } = await import('@/services/routines/routineReads');
    const { startRoutineBatch } = await import('@/services/routines/RoutineService');
    const routine = await findRoutine(run.orgId, String(actionInput.routine ?? ''));
    if (!routine) {
      throw new StepFailed(name, `routine.run: no routine "${String(actionInput.routine ?? '')}"`);
    }
    const rawRows = typeof actionInput.rows === 'string' ? JSON.parse(actionInput.rows) as unknown : actionInput.rows;
    const rows = (Array.isArray(rawRows) ? rawRows : []).filter((x): x is Record<string, string> => Boolean(x) && typeof x === 'object');
    const shared = actionInput.shared && typeof actionInput.shared === 'object' ? actionInput.shared as Record<string, string> : {};
    const by = run.createdBy && !['mcp', 'system'].includes(run.createdBy) && !run.createdBy.includes(':') ? run.createdBy : (routine.expert?.userId ?? run.createdBy ?? 'system');
    const batch = await startRoutineBatch({ orgId: run.orgId, userId: by, routineId: routine.id, rows, shared, conversationId: null });
    finishStep(state, name, { batchId: batch.id, routine: routine.name, rows: batch.total, url: `/dashboard/routines/batches/${batch.id}` });
    return 'done';
  }
  if (step.type === 'action' && step.action === 'workflow.start') {
    finishStep(state, name, await fanOut(state, step));
    return 'done';
  }
  if (step.type === 'action' && await isRegisteredAction(step.action)) {
    return runRegisteredAction(state, step, cursor);
  }
  if (step.type === 'action') {
    // An id no action is registered under: record the intent, take no side
    // effect. Output carries
    // a `__card: 'send-stub'` discriminator so the run-detail page
    // renders it via the Cards SDK (libs/cards) — see
    // libs/cards/firstParty/sendStub.tsx for the renderer.
    const actionInput = interpolateValue(step.input, scope) as Record<string, unknown>;
    const recordedAt = new Date().toISOString();
    const toRaw = actionInput.to_customer ?? actionInput.to;
    const subjectRaw = actionInput.subject;
    const bodyRaw = actionInput.body ?? actionInput.body_from_step;
    finishStep(state, name, {
      __card: 'send-stub' as const,
      stubbed: true as const,
      /** The exact interpolated step input — the audit record of what the action WOULD have done. */
      input: actionInput,
      envelope: {
        to: typeof toRaw === 'string' ? toRaw : undefined,
        subject: typeof subjectRaw === 'string' ? subjectRaw : undefined,
        body: typeof bodyRaw === 'string' ? bodyRaw : JSON.stringify(actionInput, null, 2),
        sent_at: recordedAt,
        action: step.action,
      },
    });
  }
  return 'done';
}

/**
 * Whether an action id is registered (loaded lazily: the registry is large).
 * @param id - The step's `action`.
 */
async function isRegisteredAction(id: string): Promise<boolean> {
  const { getAction } = await import('@/libs/actions/registry');
  return Boolean(getAction(id));
}

/**
 * A registered action, run for real (`workflows/actionSteps.ts`): proposed as
 * the owning agent, so the trust ladder decides between running it now and
 * waiting on its card. Its result is the step's output. Waiting pauses the
 * run (`awaiting_action:<step>`) until the card is decided. A failure fails
 * the step: the run, or inside a repeat group, the round.
 * @param state - The run.
 * @param step - The action step.
 * @param cursor - Its top-level index.
 */
async function runRegisteredAction(state: RunState, step: Extract<WorkflowStep, { type: 'action' }> | Extract<RepeatInnerWorkflowStep, { type: 'action' }>, cursor: number): Promise<StepOutcome> {
  const { runActionStep } = await import('@/services/workflows/actionSteps');
  const prev = state.stepResults[step.name];
  // A restart while the step proposed: its run is already on the step, so it is not proposed twice.
  const outcome = await runActionStep({
    orgId: state.run.orgId,
    runId: state.run.id,
    workflow: { slug: state.workflow.slug, agent: state.workflow.ownerAgentSlug },
    step: step.name,
    label: prev?.label ?? step.name,
    actionId: step.action,
    input: interpolateValue(step.input, state.scope) as Record<string, unknown>,
    confidence: step.confidence === undefined ? undefined : interpolateString(String(step.confidence), state.scope),
    ...(state.scope.repeat ? { round: state.scope.repeat.round } : {}),
  });
  if (outcome.kind === 'done') {
    finishStep(state, step.name, outcome.output);
    return 'done';
  }
  if (outcome.kind === 'waiting') {
    state.stepResults[step.name] = { ...state.stepResults[step.name]!, status: 'awaiting_approval', output: outcome.output };
    const paused = await persistState(state.run.id, {
      stepResults: state.stepResults,
      currentStep: cursor,
      status: 'paused',
      pauseReason: `awaiting_action:${step.name}`,
      pausedAt: new Date(),
    });
    if (!paused) {
      throw new RunStopped();
    }
    // Decided in the moment between proposing and pausing: move on now.
    if (typeof outcome.output.actionRunId === 'number') {
      const { onWorkflowActionSettled } = await import('@/services/workflows/actionSteps');
      await onWorkflowActionSettled(state.run.orgId, outcome.output.actionRunId);
    }
    return 'paused';
  }
  const error = outcome.kind === 'failed' ? outcome.error : outcome.reason;
  state.stepResults[step.name] = { ...state.stepResults[step.name]!, status: 'failed', output: outcome.output, error, finishedAt: new Date().toISOString() };
  if (state.scope.repeat && outcome.kind === 'failed') {
    // A failed round: the group's `until`, `max` and `onExhausted` decide.
    state.scope.steps[step.name] = { output: outcome.output };
    return 'done';
  }
  throw new StepFailed(step.name, error);
}

/**
 * An agent step: one agent, one bounded task, its result validated
 * (`workflows/agentStep.ts`), charged to this run.
 * @param state - The run.
 * @param step - The step.
 * @param alias - A legacy row's `outputAs`.
 */
async function runAgentWork(state: RunState, step: AgentWorkflowStep, alias?: string): Promise<void> {
  const [{ AgentStepError, runAgentStep }, { runAgentTurn }] = await Promise.all([
    import('@/services/workflows/agentStep'),
    import('@/services/workflows/agentRunner'),
  ]);
  const toAgent = (r: { agent: string; attempts: Array<{ at: string; traceId: string; ok: boolean; problem?: string }>; model?: string; effort?: string; microCents?: number; toolCalls: number }): StepResult['agent'] => ({
    slug: r.agent,
    attempts: r.attempts,
    toolCalls: r.toolCalls,
    ...(r.model ? { model: r.model } : {}),
    ...(r.effort ? { effort: r.effort } : {}),
    ...(typeof r.microCents === 'number' ? { microCents: r.microCents } : {}),
  });
  try {
    const record = await runAgentStep({
      orgId: state.run.orgId,
      runId: state.run.id,
      workflow: { slug: state.workflow.slug, name: state.workflow.name },
      runLabel: state.runLabel,
      stepLabel: state.stepResults[step.name]?.label ?? step.name,
      step,
      task: interpolateText(step.task, state.scope),
      turn: runAgentTurn,
    });
    finishStep(state, step.name, record.output, { agent: toAgent(record) }, alias);
  } catch (err) {
    if (err instanceof AgentStepError) {
      state.stepResults[step.name] = { ...state.stepResults[step.name]!, agent: toAgent(err.record) };
    }
    throw new StepFailed(step.name, err instanceof Error ? err.message : String(err));
  }
}

/**
 * A bounded repeat: its steps in order, round after round, until `until`
 * holds — read after each of its steps — or `max` rounds have run. Its place
 * (round, next step) is persisted after every step, so a restart picks the
 * group up where it was.
 * @param state - The run.
 * @param group - The repeat step.
 * @param cursor - Its top-level index.
 */
async function runRepeat(state: RunState, group: RepeatWorkflowStep, cursor: number): Promise<StepOutcome> {
  const prev = state.stepResults[group.name];
  const resuming = prev?.status === 'running' && prev.repeat;
  const place = resuming ? { ...prev.repeat! } : { round: 1, max: group.max, next: 0 };
  const base = stepLabel(group, state.scope);
  const groupLabel = () => `${base} · round ${place.round} of ${group.max}`;
  state.stepResults[group.name] = {
    status: 'running',
    label: groupLabel(),
    startedAt: resuming && prev.startedAt ? prev.startedAt : new Date().toISOString(),
    attempt: resuming ? (prev.attempt ?? 1) : 1,
    repeat: place,
  };
  if (!(await persistState(state.run.id, { stepResults: state.stepResults, currentStep: cursor }))) {
    throw new RunStopped();
  }

  const conclude = (satisfied: boolean) => {
    const output = { rounds: place.round, satisfied, exhausted: !satisfied };
    finishStep(state, group.name, output, { label: `${base} · ${satisfied ? `done in ${place.round} of ${group.max} ${group.max === 1 ? 'round' : 'rounds'}` : `all ${group.max} rounds ran`}`, repeat: { ...place, satisfied, exhausted: !satisfied } });
    if (!satisfied && group.onExhausted === 'fail') {
      state.stepResults[group.name] = { ...state.stepResults[group.name]!, status: 'failed', error: `${group.max} rounds ran and "${group.until}" never held` };
      throw new StepFailed(group.name, `${group.max} ${group.max === 1 ? 'round' : 'rounds'} ran and "${group.until}" never held`);
    }
  };

  // Picked up after a step that settled while the run waited (an action's
  // card): `until` is read after it, as after any step of the group.
  if (resuming && place.next > 0) {
    state.scope.repeat = { round: place.round, max: group.max };
    const done = untilHolds(group, state);
    delete state.scope.repeat;
    if (done) {
      conclude(true);
      return 'done';
    }
  }

  for (;;) {
    state.scope.repeat = { round: place.round, max: group.max };
    try {
      for (; place.next < group.steps.length; place.next++) {
        const inner = group.steps[place.next]!;
        if (!(await skipped(state, inner, cursor))) {
          await beginStep(state, inner, cursor, place.round);
          // An action waiting on its card pauses the run here, inside the group.
          if (await runWork(state, inner, cursor) === 'paused') {
            return 'paused';
          }
        }
        const done = untilHolds(group, state);
        state.stepResults[group.name] = { ...state.stepResults[group.name]!, repeat: { ...place, next: place.next + 1 } };
        if (!(await persistState(state.run.id, { stepResults: state.stepResults, currentStep: cursor }))) {
          throw new RunStopped();
        }
        if (done) {
          conclude(true);
          return 'done';
        }
      }
    } finally {
      delete state.scope.repeat;
    }
    if (place.round >= group.max) {
      conclude(false);
      return 'done';
    }
    place.round += 1;
    place.next = 0;
    state.stepResults[group.name] = { ...state.stepResults[group.name]!, label: groupLabel(), repeat: { ...place } };
    if (!(await persistState(state.run.id, { stepResults: state.stepResults, currentStep: cursor }))) {
      throw new RunStopped();
    }
  }
}

/**
 * Whether a repeat group's `until` holds now.
 * @param group - The group.
 * @param state - The run.
 */
function untilHolds(group: RepeatWorkflowStep, state: RunState): boolean {
  try {
    return evaluateCondition(group.until, state.scope);
  } catch (err) {
    throw new StepFailed(group.name, `its "until" could not be read: ${(err as Error).message}`);
  }
}

/**
 * Pause on an approve step's Decision.
 * @param state - The run.
 * @param step - The approve step.
 * @param cursor - Its index.
 */
async function pauseForApproval(state: RunState, step: Extract<WorkflowStep, { type: 'approve' }>, cursor: number): Promise<StepOutcome> {
  const prompt = interpolateText(step.prompt, state.scope);
  const label = state.stepResults[step.name]?.label ?? step.name;
  const reviewed = step.reviews && state.scope.steps[step.reviews]
    ? { label: state.stepResults[step.reviews]?.label ?? step.reviews, output: state.scope.steps[step.reviews]!.output }
    : null;
  let askId: number | undefined;
  try {
    const { fileApprovalAsk } = await import('@/services/workflows/approvals');
    askId = await fileApprovalAsk({
      orgId: state.run.orgId,
      runId: state.run.id,
      workflow: { slug: state.workflow.slug, name: state.workflow.name, agent: state.workflow.ownerAgentSlug },
      runLabel: state.runLabel,
      step: step.name,
      label,
      prompt,
      reviewed,
    });
  } catch (err) {
    // The run still waits where the review queue shows it; the card is a
    // second way in, and its absence is said on the step.
    console.warn('[workflow] the approval Decision was not filed', { runId: state.run.id, step: step.name, message: (err as Error).message });
  }
  state.stepResults[step.name] = {
    ...state.stepResults[step.name]!,
    status: 'awaiting_approval',
    output: { prompt, reviews: step.reviews },
    ...(askId ? { askId } : {}),
  };
  await persistState(state.run.id, {
    stepResults: state.stepResults,
    currentStep: cursor,
    status: 'paused',
    pauseReason: `awaiting_approval:${step.name}`,
    pausedAt: new Date(),
  });
  return 'paused';
}

/**
 * An ask step: completes with its `default` when that resolves, else pauses
 * for a person's text.
 * @param state - The run.
 * @param step - The ask step.
 * @param cursor - Its index.
 */
async function askStep(state: RunState, step: Extract<WorkflowStep, { type: 'ask' }>, cursor: number): Promise<StepOutcome> {
  // An ask whose `default` already resolves doesn't ask: an automated
  // caller that supplied the data (e.g. discovery detection handing over
  // a transcript it is already authorized to read) shouldn't make a human
  // paste in what the system is holding. Falls through to the pause when
  // the template resolves to nothing, so a manual start still works.
  const prefill = step.default === undefined ? undefined : interpolateString(step.default, state.scope);
  if (typeof prefill === 'string' && prefill.trim().length > 0) {
    finishStep(state, step.name, prefill, {}, step.outputAs ?? step.name);
    return 'done';
  }
  // Human input as a step: pause the run in Review until a human supplies
  // text via resumeWorkflow(runId, orgId, { input }). Reuses the
  // `awaiting_approval` StepStatus; the `kind: 'ask'` discriminator tells the
  // review UI to render a textarea instead of an approve button. The
  // supplied text replaces this output on resume.
  state.stepResults[step.name] = {
    ...state.stepResults[step.name]!,
    status: 'awaiting_approval',
    output: { prompt: interpolateText(step.prompt, state.scope), kind: 'ask' },
  };
  await persistState(state.run.id, {
    stepResults: state.stepResults,
    currentStep: cursor,
    status: 'paused',
    pauseReason: `awaiting_input:${step.name}`,
    pausedAt: new Date(),
  });
  return 'paused';
}

/**
 * FAN-OUT: `action: workflow.start` starts one child run of a workflow per
 * item, each named by its own input. The step finishes once they are
 * started; each child runs, pauses and is decided on its own, and names this
 * run as its parent (`trigger.parentRunId`).
 *
 * Input: `workflow` (slug), `items` (a list, or JSON of one), optional
 * `input` (shared by every child). Each child's input is the shared input,
 * then the item's own fields when it is an object, then `item`, `index`
 * (from 1) and `total`.
 * @param state - The run.
 * @param step - The action step.
 */
async function fanOut(state: RunState, step: Extract<WorkflowStep, { type: 'action' }> | Extract<RepeatInnerWorkflowStep, { type: 'action' }>): Promise<{ workflow: string; count: number; runs: Array<{ id: number; label: string | null }> }> {
  const actionInput = interpolateValue(step.input, state.scope) as Record<string, unknown>;
  const slug = String(actionInput.workflow ?? '').trim();
  if (!slug) {
    throw new StepFailed(step.name, 'workflow.start needs `workflow`: the slug of the workflow to start for each item');
  }
  if (slug === state.workflow.slug) {
    throw new StepFailed(step.name, 'workflow.start cannot start the workflow it runs in');
  }
  const raw = typeof actionInput.items === 'string'
    ? (() => {
        try {
          return JSON.parse(actionInput.items as string) as unknown;
        } catch {
          return undefined;
        }
      })()
    : actionInput.items;
  if (!Array.isArray(raw)) {
    throw new StepFailed(step.name, 'workflow.start needs `items`: a list, one child run per item');
  }
  if (raw.length > MAX_FAN_OUT) {
    throw new StepFailed(step.name, `workflow.start was given ${raw.length} items; it starts at most ${MAX_FAN_OUT} runs at once`);
  }
  const shared = actionInput.input && typeof actionInput.input === 'object' && !Array.isArray(actionInput.input) ? actionInput.input as Record<string, unknown> : {};
  // A replayed segment must not start the children twice: the ones already
  // started are on the step, written after each start.
  const prior = (state.stepResults[step.name]?.output as { runs?: Array<{ id: number; label: string | null }> } | undefined)?.runs ?? [];
  const runs = [...prior];
  for (let i = runs.length; i < raw.length; i++) {
    const item = raw[i];
    const own = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const child = await createWorkflowRun({
      orgId: state.run.orgId,
      slug,
      input: { ...shared, ...own, item, index: i + 1, total: raw.length },
      triggerContext: { trigger: 'workflow', parentRunId: state.run.id, parentWorkflow: state.workflow.slug, parentStep: step.name },
      invokedBy: state.run.createdBy ?? `workflow:${state.workflow.slug}`,
    });
    runs.push({ id: child.id, label: child.runLabel });
    state.stepResults[step.name] = { ...state.stepResults[step.name]!, output: { workflow: slug, count: runs.length, runs } };
    if (!(await persistState(state.run.id, { stepResults: state.stepResults, currentStep: state.cursor }))) {
      throw new RunStopped();
    }
  }
  return { workflow: slug, count: runs.length, runs };
}

type PersistPatch = {
  stepResults: Record<string, StepResult>;
  currentStep: number;
  status?: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  pauseReason?: string | null;
  pausedAt?: Date | null;
  error?: string | null;
  completedAt?: Date;
};

/**
 * Write the run's state, only while the run is still running: a run a person
 * stopped stays stopped, and the segment learns it (false) and stops too.
 * @param runId - The run.
 * @param patch - What to write.
 */
async function persistState(runId: number, patch: PersistPatch): Promise<boolean> {
  const update: Record<string, unknown> = {
    stepResults: patch.stepResults,
    currentStep: patch.currentStep,
  };
  if (patch.status !== undefined) {
    update.status = patch.status;
  }
  if (patch.pauseReason !== undefined) {
    update.pauseReason = patch.pauseReason;
  }
  if (patch.pausedAt !== undefined) {
    update.pausedAt = patch.pausedAt;
  }
  if (patch.error !== undefined) {
    update.error = patch.error;
  }
  if (patch.completedAt !== undefined) {
    update.completedAt = patch.completedAt;
  }
  const written = await db.update(workflowRunSchema).set(update).where(and(eq(workflowRunSchema.id, runId), eq(workflowRunSchema.status, 'running'))).returning({ id: workflowRunSchema.id });
  return written.length > 0;
}

/**
 * What a resumed segment can read: every finished step's output, under the
 * name later steps read it by (an ask's `outputAs`).
 * @param steps - The workflow's steps.
 * @param results - The run's results.
 */
function collectOutputs(steps: WorkflowStep[], results: Record<string, StepResult>): Record<string, { output: unknown }> {
  const alias = new Map<string, string>();
  for (const s of steps) {
    if (s.type === 'ask' && s.outputAs) {
      alias.set(s.name, s.outputAs);
    }
  }
  const out: Record<string, { output: unknown }> = {};
  for (const [name, r] of Object.entries(results)) {
    // A step re-running in a new round still reads as its last round's result.
    // A failed action keeps its output (`ok: false`, the error) for a group's `until`.
    if ((r.status === 'completed' || r.status === 'failed') && r.output !== undefined) {
      out[alias.get(name) ?? name] = { output: r.output };
    } else if (r.previous?.length) {
      const last = [...r.previous].reverse().find(p => p.status === 'completed' && p.output !== undefined);
      if (last) {
        out[name] = { output: last.output };
      }
    }
  }
  return out;
}

function summarize(row: typeof workflowRunSchema.$inferSelect): WorkflowRunSummary {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowSlug: '', // filled by caller if needed
    runLabel: typeof (row.input as Record<string, unknown> | null)?.[RUN_LABEL_INPUT_KEY] === 'string' ? (row.input as Record<string, string>)[RUN_LABEL_INPUT_KEY]! : null,
    status: row.status as WorkflowRunSummary['status'],
    currentStep: row.currentStep,
    pauseReason: row.pauseReason,
    stepResults: (row.stepResults ?? {}) as Record<string, StepResult>,
    error: row.error,
    workspaceSha: row.workspaceSha,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export async function listWorkflows(orgId: string) {
  return db.select().from(workflowSchema).where(eq(workflowSchema.orgId, orgId));
}

/**
 * Submit (or update) post-hoc feedback on a workflow run. Works on any
 * status — the feedback columns are independent of lifecycle state.
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.submittedBy
 * @param opts.rating
 * @param opts.note
 */
export async function submitWorkflowRunFeedback(opts: { orgId: string; runId: number; submittedBy: string; rating?: 'up' | 'down' | null; note?: string | null }): Promise<typeof workflowRunSchema.$inferSelect | null> {
  const [updated] = await db
    .update(workflowRunSchema)
    .set({
      rating: opts.rating ?? null,
      feedbackNote: opts.note ?? null,
      feedbackBy: opts.submittedBy,
      feedbackAt: new Date(),
    })
    .where(and(eq(workflowRunSchema.id, opts.runId), eq(workflowRunSchema.orgId, opts.orgId)))
    .returning();
  if (updated) {
    const { queueRunFeedbackForLearning } = await import('@/services/feedback/runFeedbackQueue');
    void queueRunFeedbackForLearning({
      orgId: opts.orgId,
      kind: 'workflow',
      runId: opts.runId,
      rating: opts.rating ?? null,
      note: opts.note ?? null,
      submittedBy: opts.submittedBy,
    });
    const { trackReviewFeedback } = await import('@/services/adoption/attribution');
    void trackReviewFeedback(
      { orgId: opts.orgId, userId: opts.submittedBy },
      { kind: 'workflow', id: updated.id },
      { rating: opts.rating ?? null, hasNote: !!opts.note },
    );
  }
  return updated ?? null;
}

export async function getWorkflow(orgId: string, slug: string): Promise<WorkflowManifest | null> {
  const [row] = await db.select().from(workflowSchema).where(and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.slug, slug)));
  if (!row) {
    return null;
  }
  // Return the manifest-shaped view. Steps/trigger were stored as JSONB exactly as authored.
  return {
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    status: (row.status ?? 'active') as WorkflowManifest['status'],
    version: row.version ?? 1,
    agent: row.ownerAgentSlug ?? undefined,
    runLabel: row.runLabel ?? undefined,
    trigger: row.trigger as WorkflowManifest['trigger'],
    steps: row.steps as unknown as WorkflowManifest['steps'],
    inputSchema: row.inputSchema ?? undefined,
  };
}
