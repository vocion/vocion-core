/**
 * sourceSyncWorkflow — the Temporal Workflow a Schedule starts to sync a
 * source on its cron.
 *
 * Runs in the deterministic Workflow sandbox: no I/O here. The actual sync
 * (network, DB, the credential vault) happens in `syncSourceActivity`, which
 * the worker runs in the host process. Incremental by default — each scheduled
 * run resumes from the source's checkpoint and fetches only what changed.
 */

import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  // A full crawl can be slow; give it room but cap retries.
  startToCloseTimeout: '30 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 3,
  },
});

export type SourceSyncWorkflowInput = {
  orgId: string;
  sourceId: number;
  incremental?: boolean;
};

export async function sourceSyncWorkflow(input: SourceSyncWorkflowInput) {
  return acts.syncSourceActivity({
    orgId: input.orgId,
    sourceId: input.sourceId,
    incremental: input.incremental ?? true,
  });
}
