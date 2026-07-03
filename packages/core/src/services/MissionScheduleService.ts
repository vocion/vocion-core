/**
 * MissionScheduleService — turns a mission's `schedule` cron into a live
 * Temporal Schedule that fires `missionScheduledCheck`
 * (→ `startMissionRunActivity` → a check-mode mission run) on that cadence.
 *
 * A mission is a standing responsibility; the schedule is the team
 * periodically checking it. Mirrors Source/WorkflowScheduleService — same
 * idempotent ensure/remove shape, own schedule-id namespace
 * (`mission-schedule-…`). `workspace:apply` reconciles these against the
 * authored `schedule` field.
 */

import type { ScheduleOptions } from '@temporalio/client';
import {
  getTemporalClient,
  MISSION_SCHEDULED_CHECK_WORKFLOW,
  missionScheduleIdFor,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';

export type MissionScheduleSpec = {
  orgId: string;
  missionSlug: string;
  /** Cron expression from the mission manifest, e.g. `0 * * * 1-5` (hourly, weekdays). */
  cron: string;
};

/**
 * Build the Temporal `ScheduleOptions` for a mission's schedule.
 * Pure — no client, no I/O — so it's unit-testable.
 * @param spec
 */
export function buildMissionScheduleOptions(spec: MissionScheduleSpec): ScheduleOptions {
  return {
    scheduleId: missionScheduleIdFor(spec.orgId, spec.missionSlug),
    spec: { cronExpressions: [spec.cron] },
    action: {
      type: 'startWorkflow',
      workflowType: MISSION_SCHEDULED_CHECK_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [{ orgId: spec.orgId, missionSlug: spec.missionSlug }],
    },
  };
}

/**
 * Create (or update) the mission's Schedule. Idempotent.
 * @param spec
 */
export async function ensureMissionSchedule(spec: MissionScheduleSpec): Promise<void> {
  const client = await getTemporalClient();
  const options = buildMissionScheduleOptions(spec);
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
 * Delete a mission's Schedule. No-op if it doesn't exist.
 * @param orgId
 * @param missionSlug
 */
export async function removeMissionSchedule(orgId: string, missionSlug: string): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.schedule.getHandle(missionScheduleIdFor(orgId, missionSlug)).delete();
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

/**
 * Describe a mission's schedule (next fire times) — best-effort, for the
 * automation UI. Returns null when the schedule (or Temporal) is absent.
 * @param orgId
 * @param missionSlug
 */
export async function describeMissionSchedule(
  orgId: string,
  missionSlug: string,
): Promise<{ nextActionTimes: Date[]; paused: boolean } | null> {
  try {
    const client = await getTemporalClient();
    const desc = await client.schedule.getHandle(missionScheduleIdFor(orgId, missionSlug)).describe();
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
