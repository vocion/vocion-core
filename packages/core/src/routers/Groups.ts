/**
 * Groups and workspace access, for the Members screen.
 *
 * Reads are open to any member: "who reaches what" is the kind of thing a team
 * should be able to answer without asking an admin. Writes are admin-only,
 * because a grant is access.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import {
  accessOverview,
  createGroup,
  deleteGroup,
  GroupError,
  removeDirectGrant,
  setGroupGrant,
  setGroupMember,
} from '@/services/GroupService';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

const RoleZ = z.enum(['owner', 'pm', 'specialist', 'client_reviewer']);

async function guardRead() {
  const ctx = await guardAuth();
  if (!ctx.accountId) {
    throw ApiError.forbidden();
  }
  return { accountId: ctx.accountId, userId: ctx.userId };
}

async function guardAdmin() {
  const ctx = await guardAuth();
  if (!ctx.has({ role: ORG_ROLE.ADMIN }) || !ctx.accountId) {
    throw ApiError.forbidden();
  }
  return { accountId: ctx.accountId, userId: ctx.userId };
}

/**
 * Turns a service refusal into the right status instead of a blanket 400.
 * @param err
 */
function rethrow(err: unknown): never {
  if (err instanceof GroupError) {
    if (err.code === 'NOT_FOUND') {
      throw ApiError.notFound();
    }
    throw ApiError.badRequest(err.message);
  }
  throw err;
}

export const overview = os.handler(async () => {
  const { accountId } = await guardRead();
  return accessOverview(accountId);
});

export const create = os
  .input(z.object({
    slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lower-case words joined by hyphens'),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
  }))
  .handler(async ({ input }) => {
    const { accountId } = await guardAdmin();
    try {
      return await createGroup({ accountId, ...input });
    } catch (err) {
      return rethrow(err);
    }
  });

export const remove = os
  .input(z.object({ groupId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { accountId } = await guardAdmin();
    try {
      await deleteGroup(accountId, input.groupId);
      return { ok: true };
    } catch (err) {
      return rethrow(err);
    }
  });

export const setMember = os
  .input(z.object({ groupId: z.string().min(1), userId: z.string().min(1), member: z.boolean() }))
  .handler(async ({ input }) => {
    const { accountId, userId } = await guardAdmin();
    try {
      await setGroupMember({ accountId, actorId: userId, ...input });
      return { ok: true };
    } catch (err) {
      return rethrow(err);
    }
  });

export const setGrant = os
  .input(z.object({ groupId: z.string().min(1), projectId: z.string().min(1), role: RoleZ.nullable() }))
  .handler(async ({ input }) => {
    const { accountId, userId } = await guardAdmin();
    try {
      await setGroupGrant({ accountId, actorId: userId, ...input });
      return { ok: true };
    } catch (err) {
      return rethrow(err);
    }
  });

export const removeDirect = os
  .input(z.object({ projectId: z.string().min(1), userId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { accountId } = await guardAdmin();
    try {
      await removeDirectGrant({ accountId, ...input });
      return { ok: true };
    } catch (err) {
      return rethrow(err);
    }
  });
