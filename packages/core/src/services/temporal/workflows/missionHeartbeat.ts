/**
 * missionHeartbeat — the Temporal Workflow a mission's heartbeat Schedule
 * starts on its cron.
 *
 * A mission is a standing responsibility; the heartbeat is the team
 * periodically checking it. Deterministic sandbox: the actual check (a
 * heartbeat-mode mission run — lead agent, no planner) happens in
 * `startMissionRunActivity` in the worker process.
 */

import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  // A heartbeat check is one lead-agent pass; approval gates park the run
  // in Postgres and return, so this bounds a single unattended check.
  startToCloseTimeout: '30 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 2,
  },
});

export type MissionHeartbeatInput = {
  orgId: string;
  missionSlug: string;
};

export async function missionHeartbeat(input: MissionHeartbeatInput) {
  return acts.startMissionRunActivity({
    orgId: input.orgId,
    missionSlug: input.missionSlug,
  });
}
