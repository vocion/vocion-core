import { os } from '@orpc/server';
import { z } from 'zod';
import { MAX_SCORECARD_RANGE_DAYS } from '@/libs/scorecard/limits';
import { getScorecard } from '@/services/scorecard/ScorecardService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Agent scorecard route (`router.scorecard.*`) — any signed-in member.
 *
 * Deliberately not behind the admin check the Adoption routes use: this is
 * the view a client's business users open on their own. It returns per-agent
 * aggregates only, never per-person numbers, which is why that is safe.
 * `orgId` comes from the session; the input carries only the period.
 */

const RangeInput = z.object({
  /** Start of the period, inclusive. */
  from: z.iso.datetime({ offset: true }),
  /** End of the period, exclusive. */
  to: z.iso.datetime({ offset: true }),
});

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Turn the validated strings into a range, refusing one that is backwards or
 * longer than the scorecard allows.
 * @param input - The request's `from` and `to`.
 * @param input.from - ISO timestamp, inclusive.
 * @param input.to - ISO timestamp, exclusive.
 */
export function parseScorecardRange(input: { from: string; to: string }): { from: Date; to: Date } {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (to.getTime() <= from.getTime()) {
    throw ApiError.badRequest('The end of the period must be after its start.');
  }
  // An hour of slack: a range of whole local days that crosses a daylight-saving
  // change is an hour longer than its day count, and must still be accepted.
  if (to.getTime() - from.getTime() > MAX_SCORECARD_RANGE_DAYS * DAY_MS + HOUR_MS) {
    throw ApiError.badRequest(`The period can be at most ${MAX_SCORECARD_RANGE_DAYS} days.`);
  }
  return { from, to };
}

export const scorecardAgentsRoute = os
  .input(RangeInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return getScorecard(orgId, parseScorecardRange(input));
  });
