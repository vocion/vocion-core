/**
 * startMissionRun activity — lets a mission's Schedule fire a
 * standing-responsibility check on its cron.
 *
 * Runs in the worker process with full deps. The run is check-mode: one
 * lead-agent task built from the mission charter, no planner. Approval
 * gates park the run in Postgres for the review queue as usual.
 */

import { getMission, scheduledCheckBrief, startMission } from '@/services/MissionService';

export type StartMissionRunActivityInput = {
  orgId: string;
  missionSlug: string;
};

export async function startMissionRunActivity(
  input: StartMissionRunActivityInput,
): Promise<{ id: number; status: string | null }> {
  const template = await getMission(input.orgId, input.missionSlug);
  if (!template) {
    throw new Error(`mission "${input.missionSlug}" not found for org ${input.orgId}`);
  }
  const run = await startMission({
    orgId: input.orgId,
    missionSlug: input.missionSlug,
    brief: scheduledCheckBrief(template),
    title: `Scheduled check: ${template.name}`,
    mode: 'check',
    invokedBy: 'schedule',
  });
  return { id: run.id, status: run.status };
}
