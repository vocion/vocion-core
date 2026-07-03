/**
 * scheduledWorkflowTrigger — the Temporal Workflow a workflow-trigger
 * Schedule starts on its cron.
 *
 * Deterministic sandbox: no I/O here. The actual run start (DB row +
 * runLoop) happens in `startWorkflowRunActivity`, which the worker runs
 * in the host process with full deps — including the agent runtime for
 * `agent` steps.
 */

import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  // Agent steps (search + synthesis) can run long; approve steps pause the
  // run in Postgres and return, so this bounds a single unattended pass.
  startToCloseTimeout: '30 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 2,
  },
});

export type ScheduledWorkflowTriggerInput = {
  orgId: string;
  workflowSlug: string;
  input?: Record<string, unknown>;
};

export async function scheduledWorkflowTrigger(input: ScheduledWorkflowTriggerInput) {
  return acts.startWorkflowRunActivity({
    orgId: input.orgId,
    workflowSlug: input.workflowSlug,
    input: input.input ?? {},
  });
}
