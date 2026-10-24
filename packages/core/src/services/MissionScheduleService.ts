/**
 * MissionScheduleService — retires the durable schedules a mission's own
 * `schedule:` used to create (`mission-schedule-…`, firing `mission.check`).
 *
 * A mission's cadence now runs as an automation (ADR 0008,
 * `libs/workspace/missionSchedules.ts`), which logs, guards and shows every
 * fire. `workspace:apply` calls this for every mission so the old schedule
 * cannot fire the same check a second time.
 */

import { unscheduleJob } from '@/libs/durable/jobs';
import { missionScheduleIdFor } from '@/libs/durable/scheduleIds';

/**
 * Delete a mission's legacy schedule. No-op if it doesn't exist.
 * @param orgId
 * @param missionSlug
 */
export async function removeMissionSchedule(orgId: string, missionSlug: string): Promise<void> {
  await unscheduleJob(missionScheduleIdFor(orgId, missionSlug));
}
