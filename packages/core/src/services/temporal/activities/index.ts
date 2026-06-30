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

/**
 * Output shape carries a `__card` discriminator so the run-detail UI renders
 * via the Cards SDK registry (`libs/cards/`) instead of dumping JSON. The
 * `send-stub` card matches and shows the envelope as an email-shaped card.
 * When real send integrations land, `stubbed` flips to `false` and the same
 * card renders without any UI change.
 */
export type ExecuteActionActivityOutput = {
  __card: 'send-stub';
  stubbed: true;
  envelope: {
    to?: string;
    subject?: string;
    body: string;
    sent_at: string;
    action: string;
  };
};

export async function executeActionActivity(
  input: ExecuteActionActivityInput,
): Promise<ExecuteActionActivityOutput> {
  // v1: actions are declarative but not executable yet. The Activity
  // records intent; downstream wiring (email send, webhook fire, etc)
  // lands when individual action handlers ship.
  const recordedAt = new Date().toISOString();
  return {
    __card: 'send-stub',
    stubbed: true,
    envelope: {
      to: stringField(input.input, 'to_customer') ?? stringField(input.input, 'to') ?? undefined,
      subject: stringField(input.input, 'subject') ?? undefined,
      body: extractBody(input.input),
      sent_at: recordedAt,
      action: input.actionType,
    },
  };
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const v = record[key];
  return typeof v === 'string' ? v : null;
}

/**
 * Best-effort body extraction. The stub action takes interpolated inputs
 * keyed by the workflow author; common shapes are:
 *   - `body: '<text>'`
 *   - `body_from_step: 'step_name'` → the step's output as a string
 *   - the whole input itself when no specific body field is provided
 *
 * For the support-reply demo, the `support_triage` workflow passes
 * `body_from_step: draft` which the action handler already interpolated by
 * the time we get here — so the rendered draft text sits on `input.body` or
 * `input.body_from_step`. When neither is present, fall back to JSON for
 * visibility rather than rendering empty.
 * @param record
 */
function extractBody(record: Record<string, unknown>): string {
  const direct = stringField(record, 'body');
  if (direct) {
    return direct;
  }
  const fromStep = stringField(record, 'body_from_step');
  if (fromStep) {
    return fromStep;
  }
  return JSON.stringify(record, null, 2);
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

/* Source-sync activity (Temporal Schedules). */
export * from './sourceSync';
