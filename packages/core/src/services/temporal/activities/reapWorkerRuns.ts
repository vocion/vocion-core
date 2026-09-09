import { reapLostWorkerRuns } from '@/services/WorkerRunService';

/**
 * Activity body for the reaper workflow — one UPDATE, returns how many it caught.
 */
export async function reapWorkerRunsActivity(): Promise<{ reaped: number }> {
  return { reaped: await reapLostWorkerRuns(new Date()) };
}
