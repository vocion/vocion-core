import { reapStaleMissionRuns } from '@/services/MissionService';

/**
 * Activity body for the mission-run reaper workflow — one sweep, returns how
 * many runs it caught and how many of those it replayed.
 */
export async function reapMissionRunsActivity(): Promise<{ reaped: number; refired: number }> {
  const { reaped, refired } = await reapStaleMissionRuns(new Date());
  return { reaped, refired };
}
