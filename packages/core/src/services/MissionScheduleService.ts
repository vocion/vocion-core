/**
 * MissionScheduleService — turns a mission's `heartbeat` cron into a live
 * Temporal Schedule that fires `missionHeartbeat` (→ `startMissionRunActivity`
 * → a heartbeat-mode mission run) on that cadence.
 *
 * A mission is a standing responsibility; the heartbeat is the team
 * periodically checking it. Mirrors Source/WorkflowScheduleService — same
 * idempotent ensure/remove shape, own schedule-id namespace
 * (`mission-heartbeat-…`). `workspace:apply` reconciles these against the
 * authored `heartbeat` field.
 */

import type { ScheduleOptions } from '@temporalio/client';
import {
  getTemporalClient,
  MISSION_HEARTBEAT_WORKFLOW,
  missionHeartbeatScheduleIdFor,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';

export type MissionHeartbeatSpec = {
  orgId: string;
  missionSlug: string;
  /** Cron expression from the mission manifest, e.g. `0 * * * 1-5` (hourly, weekdays). */
  cron: string;
};

/**
 * Build the Temporal `ScheduleOptions` for a mission's heartbeat.
 * Pure — no client, no I/O — so it's unit-testable.
 * @param spec
 */
export function buildMissionHeartbeatOptions(spec: MissionHeartbeatSpec): ScheduleOptions {
  return {
    scheduleId: missionHeartbeatScheduleIdFor(spec.orgId, spec.missionSlug),
    spec: { cronExpressions: [spec.cron] },
    action: {
      type: 'startWorkflow',
      workflowType: MISSION_HEARTBEAT_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [{ orgId: spec.orgId, missionSlug: spec.missionSlug }],
    },
  };
}

/**
 * Create (or update) the mission's heartbeat Schedule. Idempotent.
 * @param spec
 */
export async function ensureMissionHeartbeat(spec: MissionHeartbeatSpec): Promise<void> {
  const client = await getTemporalClient();
  const options = buildMissionHeartbeatOptions(spec);
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
 * Delete a mission's heartbeat Schedule. No-op if it doesn't exist.
 * @param orgId
 * @param missionSlug
 */
export async function removeMissionHeartbeat(orgId: string, missionSlug: string): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.schedule.getHandle(missionHeartbeatScheduleIdFor(orgId, missionSlug)).delete();
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

/**
 * Describe a mission's heartbeat (next fire times) — best-effort, for the
 * automation UI. Returns null when the schedule (or Temporal) is absent.
 * @param orgId
 * @param missionSlug
 */
export async function describeMissionHeartbeat(
  orgId: string,
  missionSlug: string,
): Promise<{ nextActionTimes: Date[]; paused: boolean } | null> {
  try {
    const client = await getTemporalClient();
    const desc = await client.schedule.getHandle(missionHeartbeatScheduleIdFor(orgId, missionSlug)).describe();
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
