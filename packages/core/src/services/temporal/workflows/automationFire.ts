/**
 * automationFire — the Temporal Workflow an automation's Schedule starts.
 *
 * Deterministic sandbox: the actual dispatch (resolve the automation's
 * `do`, start a workflow run or a mission check) happens in
 * `fireAutomationActivity` in the worker process.
 */

import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  // A fire can run a full workflow (sync + agent steps) or a whole mission
  // check in-process; approve steps park the run in Postgres and return,
  // bounding an unattended pass.
  //
  // 90 minutes, above the observed worst case of 29.0 minutes
  // (`process-new-mqls`, 27 August, working through a full backlog of
  // unbriefed leads). At the old 30-minute ceiling one more lead in that
  // batch would have timed the activity out, retried the whole pass from the
  // top, and left the first agent loop still running with nothing checking
  // for cancellation — two passes claiming leads at once, burning the
  // three-try budgets at double rate.
  startToCloseTimeout: '90 minutes',
  // The heartbeat is what makes the ceiling safe to raise: a hung pass fails
  // in five minutes instead of at the wall, and a retry can only start after
  // the previous attempt has stopped reporting, so the two cannot overlap.
  heartbeatTimeout: '5 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 2,
  },
});

export type AutomationFireInput = {
  orgId: string;
  slug: string;
};

export async function automationFire(input: AutomationFireInput) {
  return acts.fireAutomationActivity({ orgId: input.orgId, slug: input.slug });
}
