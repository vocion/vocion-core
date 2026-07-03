/**
 * missionScheduledCheck — the Temporal Workflow a mission's Schedule
 * starts on its cron.
 *
 * A mission is a standing responsibility; the schedule is the team
 * periodically checking it. Deterministic sandbox: the actual check (a
 * check-mode mission run — lead agent, no planner) happens in
 * `startMissionRunActivity` in the worker process.
 */

import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  // A scheduled check is one lead-agent pass; approval gates park the run
  // in Postgres and return, so this bounds a single unattended check.
  startToCloseTimeout: '30 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 2,
  },
});

export type MissionScheduledCheckInput = {
  orgId: string;
  missionSlug: string;
};

export async function missionScheduledCheck(input: MissionScheduledCheckInput) {
  return acts.startMissionRunActivity({
    orgId: input.orgId,
    missionSlug: input.missionSlug,
  });
}
