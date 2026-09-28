import { pruneRunEvents } from '@/services/runs/RunLogService';
import { reapLostWorkerRuns } from '@/services/WorkerRunService';

/**
 * Activity body for the reaper workflow: mark lapsed runs `lost`, then keep
 * the step log bounded in time — lines past their retention (30 days) go, the
 * runs they belonged to stay. A prune that fails does not undo the reap.
 */
export async function reapWorkerRunsActivity(): Promise<{ reaped: number; pruned: number }> {
  const now = new Date();
  const reaped = await reapLostWorkerRuns(now);
  let pruned = 0;
  try {
    pruned = await pruneRunEvents(now);
  } catch (error) {
    console.warn('[worker-run] step log prune failed', error);
  }
  return { reaped, pruned };
}
