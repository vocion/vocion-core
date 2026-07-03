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
  // A fire can run a full workflow (sync + agent steps) in-process; approve
  // steps park the run in Postgres and return, bounding an unattended pass.
  startToCloseTimeout: '30 minutes',
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
