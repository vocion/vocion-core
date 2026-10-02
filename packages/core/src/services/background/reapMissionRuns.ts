import { reapStaleMissionRuns } from '@/services/MissionService';
import { sweepReviewQueue } from '@/services/proposals/ReviewTruthService';

/**
 * Activity body for the mission-run reaper workflow — one sweep, returns how
 * many runs it caught and how many of those it replayed.
 *
 * The same five-minute pass keeps the Review queue true (backlog 039): an
 * undecided item whose reason is gone is closed with the reason, and one still
 * true past the bound is surfaced once. Its failure never fails the
 * reaper's pass.
 */
export async function reapMissionRunsActivity(): Promise<{ reaped: number; refired: number; reviewClosed: number; reviewSurfaced: number }> {
  const now = new Date();
  const { reaped, refired } = await reapStaleMissionRuns(now);
  const review = await sweepReviewQueue({ now }).catch((error: unknown) => {
    console.error('[reapMissionRuns] review sweep failed', error);
    return { closed: [], surfaced: [] };
  });
  return { reaped, refired, reviewClosed: review.closed.length, reviewSurfaced: review.surfaced.length };
}
