import { os } from '@orpc/server';
import { z } from 'zod';
import {
  changeMemberRole,
  createInvite,
  listMembers,
  listPendingInvites,
  removeMember,
  revokeInvite,
} from '@/services/MembersService';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

const RoleZ = z.enum(['admin', 'member']);

/** Like guardRole(ADMIN) but keeps userId (for invitedBy + self-checks). */
async function guardAdmin() {
  const ctx = await guardAuth();
  if (!ctx.has({ role: ORG_ROLE.ADMIN })) {
    throw ApiError.forbidden();
  }
  if (!ctx.accountId) {
    throw ApiError.forbidden();
  }
  return { accountId: ctx.accountId, userId: ctx.userId, projectId: ctx.projectId };
}

export const listMembersRoute = os.handler(async () => {
  const { accountId } = await guardAuth();
  if (!accountId) {
    throw ApiError.forbidden();
  }
  return listMembers(accountId);
});

export const listInvitesRoute = os.handler(async () => {
  const { accountId } = await guardAdmin();
  return listPendingInvites(accountId);
});

export const createInviteRoute = os
  .input(z.object({ email: z.string().email(), role: RoleZ }))
  .handler(async ({ input }) => {
    const { accountId, userId } = await guardAdmin();
    try {
      return await createInvite({ accountId, email: input.email, role: input.role, invitedBy: userId });
    } catch (e) {
      throw ApiError.badRequest(e instanceof Error ? e.message : 'Could not create invite.');
    }
  });

export const revokeInviteRoute = os
  .input(z.object({ inviteId: z.string() }))
  .handler(async ({ input }) => {
    const { accountId } = await guardAdmin();
    await revokeInvite(accountId, input.inviteId);
    return { ok: true };
  });

export const changeRoleRoute = os
  .input(z.object({ userId: z.string(), role: RoleZ }))
  .handler(async ({ input }) => {
    const { accountId } = await guardAdmin();
    try {
      await changeMemberRole({ accountId, userId: input.userId, role: input.role });
    } catch (e) {
      throw ApiError.badRequest(e instanceof Error ? e.message : 'Could not change role.');
    }
    return { ok: true };
  });

export const removeMemberRoute = os
  .input(z.object({ userId: z.string() }))
  .handler(async ({ input }) => {
    const { accountId, userId: actorId } = await guardAdmin();
    if (input.userId === actorId) {
      throw ApiError.badRequest('You cannot remove yourself. Ask another admin.');
    }
    try {
      await removeMember({ accountId, userId: input.userId });
    } catch (e) {
      throw ApiError.badRequest(e instanceof Error ? e.message : 'Could not remove member.');
    }
    return { ok: true };
  });

/**
 * Reset a member's two-step sign-in, for someone who lost both their phone and
 * their recovery codes (`resetMemberSecondFactor` in `services/auth/mfa.ts`).
 * Admin-only, for a member of the admin's own account who belongs to no other
 * account, never the admin themself. Ends the member's sessions, and is
 * recorded on the adoption stream (`auth.second_factor_reset`) and in the log.
 */
export const resetSecondFactorRoute = os
  .input(z.object({ userId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { accountId, userId: actorId, projectId } = await guardAdmin();
    const { resetMemberSecondFactor } = await import('@/services/auth/mfa');
    const result = await resetMemberSecondFactor({ accountId, actorUserId: actorId, targetUserId: input.userId });
    if (!result.ok) {
      throw ApiError.badRequest({
        'self': 'Turn your own two-step sign-in off from your profile page.',
        'not-a-member': 'That person is not a member of this account.',
        'other-accounts': 'That person also belongs to another account, so an operator resets their two-step sign-in.',
      }[result.reason]);
    }
    const [{ track }, { logger }] = await Promise.all([import('@/services/adoption/track'), import('@/libs/Logger')]);
    await track({ orgId: projectId, projectId, accountId, userId: actorId }, 'auth.second_factor_reset', { resource: ['user', input.userId] });
    logger.info('two-step sign-in reset by an account admin', { accountId, actorId, userId: input.userId, hadSecondFactor: result.hadSecondFactor });
    return { ok: true, hadSecondFactor: result.hadSecondFactor };
  });
