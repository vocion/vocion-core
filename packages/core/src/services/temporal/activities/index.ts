/**
 * Activities for vocionWorkflow (Phase H.1).
 *
 * Activities run in the worker process and have full Node access —
 * DB, network, OperationService, etc. The Workflow function (which
 * runs in a deterministic sandbox) calls these via `proxyActivities`.
 *
 * The six activities mirror the existing in-process runLoop:
 *   - executeSkillActivity        — wraps OperationService.executeSkill
 *   - executeActionActivity       — v1 stub (action steps still TBD)
 *   - recordStepStartedActivity   — Postgres mirror: step begins
 *   - recordStepCompletedActivity — Postgres mirror: step done
 *   - recordStepFailedActivity    — Postgres mirror: step failed → run fails
 *   - recordApprovalRequestedActivity — Postgres mirror: pause for HITL
 *   - recordWorkflowCompletedActivity — Postgres mirror: terminal status
 *
 * Each Activity is small + idempotent where possible. Failures inside
 * Activities propagate back to the Workflow, which Temporal retries
 * per the policy set in proxyActivities() options.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workflowRunSchema } from '@/models/Schema';
import { executeSkill } from '@/services/OperationService';

export type StepStatus = 'running' | 'completed' | 'failed' | 'awaiting_approval';
export type WorkflowStepType = 'skill' | 'approve' | 'action';

export type StepResultEntry = {
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  output?: unknown;
  error?: string;
  skillRunId?: number;
};

/* ------------------------------------------------------------------ */
/* Execute a skill step                                                */
/* ------------------------------------------------------------------ */

export type ExecuteSkillActivityInput = {
  orgId: string;
  skillSlug: string;
  input: Record<string, unknown>;
  runId: number;
  stepName: string;
};

export type ExecuteSkillActivityOutput = {
  output: unknown;
  skillRunId: number;
  status: string;
};

export async function executeSkillActivity(
  input: ExecuteSkillActivityInput,
): Promise<ExecuteSkillActivityOutput> {
  const result = await executeSkill({
    orgId: input.orgId,
    skillSlug: input.skillSlug,
    input: input.input,
    userId: `workflow-run-${input.runId}`,
  });
  return {
    output: result.output,
    skillRunId: result.runId,
    status: result.skill.requiresApproval === 'true' ? 'pending' : 'auto',
  };
}

/* ------------------------------------------------------------------ */
/* Execute an action step (v1 stub)                                    */
/* ------------------------------------------------------------------ */

export type ExecuteActionActivityInput = {
  orgId: string;
  actionType: string;
  input: Record<string, unknown>;
  runId: number;
  stepName: string;
};

export type ExecuteActionActivityOutput = {
  stubbed: true;
  actionType: string;
  recordedAt: string;
};

export async function executeActionActivity(
  input: ExecuteActionActivityInput,
): Promise<ExecuteActionActivityOutput> {
  // v1: actions are declarative but not executable yet. The Activity
  // records intent; downstream wiring (email send, webhook fire, etc)
  // lands when individual action handlers ship.
  return {
    stubbed: true,
    actionType: input.actionType,
    recordedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Postgres-mirror writers                                             */
/* ------------------------------------------------------------------ */

async function patchStepResults(
  runId: number,
  stepName: string,
  patch: Partial<StepResultEntry>,
): Promise<void> {
  // Merge into stepResults[stepName] in a single UPDATE. Postgres
  // JSONB || merges shallowly; the path is keyed by stepName.
  await db
    .update(workflowRunSchema)
    .set({
      stepResults: sql`COALESCE(${workflowRunSchema.stepResults}, '{}'::jsonb) || jsonb_build_object(${stepName}::text, COALESCE(${workflowRunSchema.stepResults} -> ${stepName}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
    })
    .where(eq(workflowRunSchema.id, runId));
}

export type RecordStepStartedInput = {
  runId: number;
  stepName: string;
  type: WorkflowStepType;
};

export async function recordStepStartedActivity(input: RecordStepStartedInput): Promise<void> {
  await patchStepResults(input.runId, input.stepName, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });
  // Best-effort: bump the run's currentStep counter so the UI shows progress.
  // No-op if the workflow has been cancelled; we tolerate this.
  await db
    .update(workflowRunSchema)
    .set({ status: 'running' })
    .where(eq(workflowRunSchema.id, input.runId));
}

export type RecordStepCompletedInput = {
  runId: number;
  stepName: string;
  output?: unknown;
  skillRunId?: number;
};

export async function recordStepCompletedActivity(input: RecordStepCompletedInput): Promise<void> {
  await patchStepResults(input.runId, input.stepName, {
    status: 'completed',
    finishedAt: new Date().toISOString(),
    output: input.output,
    skillRunId: input.skillRunId,
  });
}

export type RecordStepFailedInput = {
  runId: number;
  stepName: string;
  error: string;
};

export async function recordStepFailedActivity(input: RecordStepFailedInput): Promise<void> {
  await patchStepResults(input.runId, input.stepName, {
    status: 'failed',
    finishedAt: new Date().toISOString(),
    error: input.error,
  });
  await db
    .update(workflowRunSchema)
    .set({
      status: 'failed',
      error: input.error,
      completedAt: new Date(),
    })
    .where(eq(workflowRunSchema.id, input.runId));
}

export type RecordApprovalRequestedInput = {
  runId: number;
  stepName: string;
};

export async function recordApprovalRequestedActivity(input: RecordApprovalRequestedInput): Promise<void> {
  await patchStepResults(input.runId, input.stepName, {
    status: 'awaiting_approval',
    startedAt: new Date().toISOString(),
  });
  await db
    .update(workflowRunSchema)
    .set({
      status: 'paused',
      pauseReason: `awaiting_approval:${input.stepName}`,
      pausedAt: new Date(),
    })
    .where(eq(workflowRunSchema.id, input.runId));
}

export type RecordWorkflowCompletedInput = {
  runId: number;
  status: 'completed' | 'cancelled' | 'failed';
  error?: string;
};

export async function recordWorkflowCompletedActivity(input: RecordWorkflowCompletedInput): Promise<void> {
  await db
    .update(workflowRunSchema)
    .set({
      status: input.status,
      error: input.error ?? null,
      pauseReason: null,
      pausedAt: null,
      completedAt: new Date(),
    })
    .where(eq(workflowRunSchema.id, input.runId));
}
