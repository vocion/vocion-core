/**
 * MissionScheduleService — turns a mission's `schedule` cron into a durable
 * schedule that runs the `mission.check` job (→ `startMissionRunActivity` →
 * a check-mode mission run) on that cadence.
 *
 * A mission is a standing responsibility; the schedule is the team
 * periodically checking it. Same idempotent ensure/remove shape as the source
 * and workflow schedules, own name namespace (`mission-schedule-…`).
 * `workspace:apply` reconciles these against the authored `schedule` field.
 */

import type { ScheduleSpec } from '@/libs/durable/jobs';
import { scheduleJob, unscheduleJob } from '@/libs/durable/jobs';
import { missionScheduleIdFor } from '@/libs/durable/scheduleIds';
import { JOB } from '@/services/background/catalog';

export type MissionScheduleSpec = {
  orgId: string;
  missionSlug: string;
  /** Cron expression from the mission manifest, e.g. `0 * * * 1-5` (hourly, weekdays). */
  cron: string;
};

/**
 * The schedule for a mission's check. Pure.
 * @param spec
 */
export function missionScheduleSpec(spec: MissionScheduleSpec): ScheduleSpec {
  return {
    name: missionScheduleIdFor(spec.orgId, spec.missionSlug),
    cron: spec.cron,
    job: JOB.missionCheck,
    input: { orgId: spec.orgId, missionSlug: spec.missionSlug },
  };
}

/**
 * Create (or update) the mission's schedule. Idempotent.
 * @param spec
 */
export async function ensureMissionSchedule(spec: MissionScheduleSpec): Promise<void> {
  await scheduleJob(missionScheduleSpec(spec));
}

/**
 * Delete a mission's schedule. No-op if it doesn't exist.
 * @param orgId
 * @param missionSlug
 */
export async function removeMissionSchedule(orgId: string, missionSlug: string): Promise<void> {
  await unscheduleJob(missionScheduleIdFor(orgId, missionSlug));
}
