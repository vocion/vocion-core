/**
 * WorkflowScheduleService — turns a workflow's `trigger: {type: schedule,
 * cron}` into a durable schedule that runs the `workflow.trigger` job
 * (→ `startWorkflowRunActivity` → `startWorkflow`) on that cadence.
 *
 * Same idempotent ensure/remove shape as SourceScheduleService, distinct name
 * namespace (`workflow-schedule-…` vs `source-sync-…`). `workspace:apply`
 * reconciles schedules against the authored trigger config; nothing else
 * creates them.
 */

import type { ScheduleSpec } from '@/libs/durable/jobs';
import { scheduleJob, unscheduleJob } from '@/libs/durable/jobs';
import { scheduleIdFor } from '@/libs/durable/scheduleIds';
import { JOB } from '@/services/background/catalog';

export type WorkflowScheduleSpec = {
  orgId: string;
  workflowSlug: string;
  /** Cron expression from the workflow trigger, e.g. `0 12 * * 1-5` (UTC). */
  cron: string;
  /** Optional fixed input passed to every scheduled run. */
  input?: Record<string, unknown>;
};

/**
 * The schedule for a workflow's cron trigger. Pure.
 * @param spec
 */
export function workflowScheduleSpec(spec: WorkflowScheduleSpec): ScheduleSpec {
  return {
    name: scheduleIdFor(spec.orgId, spec.workflowSlug),
    cron: spec.cron,
    job: JOB.workflowTrigger,
    input: { orgId: spec.orgId, workflowSlug: spec.workflowSlug, input: spec.input ?? {} },
  };
}

/**
 * Create (or update) the workflow's trigger schedule. Idempotent.
 * @param spec
 */
export async function ensureWorkflowSchedule(spec: WorkflowScheduleSpec): Promise<void> {
  await scheduleJob(workflowScheduleSpec(spec));
}

/**
 * Delete a workflow's trigger schedule. No-op if it doesn't exist.
 * @param orgId
 * @param workflowSlug
 */
export async function removeWorkflowSchedule(orgId: string, workflowSlug: string): Promise<void> {
  await unscheduleJob(scheduleIdFor(orgId, workflowSlug));
}
