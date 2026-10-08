import { os } from '@orpc/server';
import { z } from 'zod';
import { listSignInMethods, unlinkSignInMethod } from '@/services/auth/signInMethods';
import { changePassword, getProfile, updatePhone, updateProfile } from '@/services/UserProfileService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

export const getProfileRoute = os.handler(async () => {
  const { userId } = await guardAuth();
  const profile = await getProfile(userId);
  if (!profile) {
    throw ApiError.notFound();
  }
  return profile;
});

export const updateNameRoute = os
  .input(z.object({ name: z.string().min(1).max(200) }))
  .handler(async ({ input }) => {
    const { userId } = await guardAuth();
    try {
      await updateProfile({ userId, name: input.name });
    } catch (e) {
      throw ApiError.badRequest(e instanceof Error ? e.message : 'Could not update profile.');
    }
    return { ok: true };
  });

export const updatePhoneRoute = os
  .input(z.object({ phone: z.string().max(40) }))
  .handler(async ({ input }) => {
    const { userId } = await guardAuth();
    try {
      return { ok: true, phone: await updatePhone({ userId, phone: input.phone }) };
    } catch (e) {
      throw ApiError.badRequest(e instanceof Error ? e.message : 'Could not save the number.');
    }
  });

export const changePasswordRoute = os
  .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) }))
  .handler(async ({ input }) => {
    const { userId } = await guardAuth();
    try {
      await changePassword({
        userId,
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      });
    } catch (e) {
      throw ApiError.badRequest(e instanceof Error ? e.message : 'Could not change password.');
    }
    return { ok: true };
  });

/** The person's ways in: password, linked providers, email link. */
export const signInMethodsRoute = os.handler(async () => {
  const { userId } = await guardAuth();
  const methods = await listSignInMethods(userId);
  if (!methods) {
    throw ApiError.notFound();
  }
  return methods;
});

/** Unlink a provider, unless it is the person's last way in. */
export const unlinkSignInMethodRoute = os
  .input(z.object({ provider: z.string().min(1).max(60) }))
  .handler(async ({ input }) => {
    const { userId, projectId, accountId } = await guardAuth();
    const result = await unlinkSignInMethod({ orgId: projectId, projectId, accountId, userId }, input.provider);
    if (!result.ok) {
      throw ApiError.badRequest(result.error);
    }
    return { ok: true };
  });
