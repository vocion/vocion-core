import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import {
  AutomationNotFoundError,
  AutomationPauseStateError,
  pauseAutomation,
  resumeAutomation,
} from '@/services/AutomationService';
import { getProfile } from '@/services/UserProfileService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Automation routes — the controls a person has over the WHEN of the system.
 *
 * Same guard as the mission mutations (`guardAuth`: a signed-in member of the
 * project, scoped to its org), so whoever may approve a mission run may hold
 * the automation that starts one. Every mutation names its actor from the
 * session, never from the input — the audit row is only worth having if the
 * caller cannot choose who it says.
 */

const ControlInput = z.object({
  slug: z.string().min(1),
  /** Why — optional, goes on the record verbatim. */
  note: z.string().trim().max(500).optional(),
});

/** The signed-in person, as the audit row will name them. */
async function actor() {
  const { orgId, userId } = await guardAuth();
  const profile = await getProfile(userId);
  return { orgId, by: { id: userId, name: profile?.name?.trim() || profile?.email || null } };
}

/**
 * Turn the service's refusals into answers a person can read. A pause on a
 * paused automation is a CONFLICT (a second tab, most likely), an unknown slug
 * is NOT_FOUND, anything else passes through unchanged.
 * @param err - Whatever the service threw.
 */
function translate(err: unknown): never {
  if (err instanceof AutomationNotFoundError) {
    throw ApiError.notFound();
  }
  if (err instanceof AutomationPauseStateError) {
    throw new ORPCError('CONFLICT', { message: `${err.message}. Reload to see its current state.` });
  }
  throw err;
}

export const pause = os.input(ControlInput).handler(async ({ input }) => {
  const { orgId, by } = await actor();
  return pauseAutomation(orgId, input.slug, { by, note: input.note }).catch(translate);
});

export const resume = os.input(ControlInput).handler(async ({ input }) => {
  const { orgId, by } = await actor();
  await resumeAutomation(orgId, input.slug, { by, note: input.note }).catch(translate);
  return { ok: true };
});
