import { os } from '@orpc/server';
import { z } from 'zod';
import { acknowledgeFlag, AutonomyError, demote, listPolicies, promote } from '@/services/autonomy/AutonomyService';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Autonomy ladder routes (`router.autonomy.*`) — the table behind
 * `/dashboard/autonomy` and the two verbs on it.
 *
 * Reading is open to every member: where each action kind stands and what
 * the next rung would take is the kind of truth the manifesto says never to
 * hide. Moving a kind is admin-only — it changes what runs without a person.
 * `promote` refuses when the evidence is not there, whatever the caller says.
 */

const ActionIdInput = z.object({ actionId: z.string().min(1).max(200) });

async function guardAdmin() {
  const ctx = await guardAuth();
  if (!ctx.has({ role: ORG_ROLE.ADMIN })) {
    throw ApiError.forbidden();
  }
  return { orgId: ctx.orgId, userId: ctx.userId };
}

function rethrow(error: unknown): never {
  if (error instanceof AutonomyError) {
    throw ApiError.badRequest(error.message);
  }
  throw error;
}

export const listAutonomyRoute = os.handler(async () => {
  const { orgId } = await guardAuth();
  return listPolicies(orgId);
});

export const promoteAutonomyRoute = os
  .input(ActionIdInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAdmin();
    return promote(orgId, input.actionId, userId).catch(rethrow);
  });

export const demoteAutonomyRoute = os
  .input(ActionIdInput.extend({ reason: z.string().max(500).optional() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAdmin();
    return demote(orgId, input.actionId, userId, input.reason).catch(rethrow);
  });

export const acknowledgeAutonomyFlagRoute = os
  .input(ActionIdInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAdmin();
    return acknowledgeFlag(orgId, input.actionId).catch(rethrow);
  });
