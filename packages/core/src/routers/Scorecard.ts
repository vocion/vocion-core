import { os } from '@orpc/server';
import { z } from 'zod';
import { getScorecard } from '@/services/scorecard/ScorecardService';
import { guardAuth } from './AuthGuards';

/**
 * Agent scorecard route (`router.scorecard.*`) — any signed-in member.
 *
 * Deliberately not behind the admin check the Adoption routes use: this is
 * the view a client's business users open on their own. It returns per-agent
 * aggregates only, never per-person numbers, which is why that is safe.
 * `orgId` comes from the session; the input carries only the window.
 */

const WindowInput = z.object({ days: z.union([z.literal(7), z.literal(30)]).default(30) });

export const scorecardAgentsRoute = os
  .input(WindowInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return getScorecard(orgId, input.days);
  });
