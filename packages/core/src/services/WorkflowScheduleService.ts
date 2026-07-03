/**
 * WorkflowScheduleService — turns a workflow's `trigger: {type: schedule,
 * cron}` into a live Temporal Schedule that fires `scheduledWorkflowTrigger`
 * (→ `startWorkflowRunActivity` → `startWorkflow`) on that cadence.
 *
 * Mirrors SourceScheduleService exactly — same idempotent ensure/remove
 * shape, distinct schedule-id namespace (`workflow-schedule-…` vs
 * `source-sync-…`). `workspace:apply` reconciles schedules against the
 * authored trigger config; nothing else creates them.
 */

import type { ScheduleOptions } from '@temporalio/client';
import {
  getTemporalClient,
  SCHEDULED_WORKFLOW_TRIGGER,
  scheduleIdFor,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';

export type WorkflowScheduleSpec = {
  orgId: string;
  workflowSlug: string;
  /** Cron expression from the workflow trigger, e.g. `0 12 * * 1-5` (UTC). */
  cron: string;
  /** Optional fixed input passed to every scheduled run. */
  input?: Record<string, unknown>;
};

/**
 * Build the Temporal `ScheduleOptions` for a workflow's cron trigger.
 * Pure — no client, no I/O — so it's unit-testable.
 * @param spec
 */
export function buildWorkflowScheduleOptions(spec: WorkflowScheduleSpec): ScheduleOptions {
  return {
    scheduleId: scheduleIdFor(spec.orgId, spec.workflowSlug),
    spec: { cronExpressions: [spec.cron] },
    action: {
      type: 'startWorkflow',
      workflowType: SCHEDULED_WORKFLOW_TRIGGER,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [{ orgId: spec.orgId, workflowSlug: spec.workflowSlug, input: spec.input ?? {} }],
    },
  };
}

/**
 * Create (or update) the workflow's trigger Schedule. Idempotent.
 * @param spec
 */
export async function ensureWorkflowSchedule(spec: WorkflowScheduleSpec): Promise<void> {
  const client = await getTemporalClient();
  const options = buildWorkflowScheduleOptions(spec);
  try {
    await client.schedule.create(options);
  } catch (err) {
    if (isAlreadyExists(err)) {
      const handle = client.schedule.getHandle(options.scheduleId);
      await handle.update(prev => ({ ...prev, spec: options.spec, action: options.action }));
      return;
    }
    throw err;
  }
}

/**
 * Delete a workflow's trigger Schedule. No-op if it doesn't exist.
 * @param orgId
 * @param workflowSlug
 */
export async function removeWorkflowSchedule(orgId: string, workflowSlug: string): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.schedule.getHandle(scheduleIdFor(orgId, workflowSlug)).delete();
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

/**
 * Describe a workflow's schedule (next fire times) — best-effort, for the
 * automation UI. Returns null when the schedule (or Temporal) is absent.
 * @param orgId
 * @param workflowSlug
 */
export async function describeWorkflowSchedule(
  orgId: string,
  workflowSlug: string,
): Promise<{ nextActionTimes: Date[]; paused: boolean } | null> {
  try {
    const client = await getTemporalClient();
    const desc = await client.schedule.getHandle(scheduleIdFor(orgId, workflowSlug)).describe();
    return {
      nextActionTimes: (desc.info.nextActionTimes ?? []).slice(0, 3),
      paused: desc.state.paused ?? false,
    };
  } catch {
    return null;
  }
}

function isAlreadyExists(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? '';
  return name === 'ScheduleAlreadyRunning' || /already exists|already running/i.test(message);
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? '';
  return name === 'ScheduleNotFoundError' || /not found/i.test(message);
}
