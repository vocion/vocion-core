import { os } from '@orpc/server';
import { z } from 'zod';
import { changePassword, getProfile, updateProfile } from '@/services/UserProfileService';
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
