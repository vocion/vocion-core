import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { initialInterval: '10s', backoffCoefficient: 2, maximumInterval: '1 minute', maximumAttempts: 2 },
});

/**
 * Deployment-wide sweep: mark worker runs whose lease lapsed as `lost`
 * (ADR 0004). Scheduled every few minutes by WorkerRunReaperScheduleService.
 */
export async function workerRunReaperWorkflow() {
  return acts.reapWorkerRunsActivity();
}
