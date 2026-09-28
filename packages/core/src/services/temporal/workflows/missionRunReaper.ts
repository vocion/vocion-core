import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { initialInterval: '10s', backoffCoefficient: 2, maximumInterval: '1 minute', maximumAttempts: 2 },
});

/**
 * Deployment-wide sweep: mark mission runs stranded by a dead process (no
 * lease to lapse — mission runs execute in-process) as `failed`. Scheduled
 * every five minutes by `MissionRunReaperScheduleService`, same cadence as
 * the worker-run reaper. A run an event automation started is replayed once
 * as its own `automationFire` workflow rather than inline here, so this sweep
 * stays fast for every other stranded run behind it.
 */
export async function missionRunReaperWorkflow() {
  return acts.reapMissionRunsActivity();
}
