import { os } from '@orpc/server';
import { z } from 'zod';
import { changePassword, getProfile, updatePhone, updateProfile } from '@/services/UserProfileService';
import { ORG_ROLE } from '@/types/Auth';
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
    // The change ended every other session; this one stays signed in.
    const { keepThisSession } = await import('@/libs/Auth');
    await keepThisSession(userId);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Two-step sign-in (services/auth/mfa.ts)                             */
/*                                                                     */
/* Setting it up goes through `/api/mfa/enroll` (+ `/confirm`), which  */
/* the sign-in gate uses too; these are the profile page's other      */
/* moves. Turning it off and minting new recovery codes each take a   */
/* current code, behind the same lockout as sign-in.                  */
/* ------------------------------------------------------------------ */

/**
 * Check a code for a signed-in person, or throw the error the page shows.
 * @param userId - The person.
 * @param code - What they typed.
 */
async function requireSecondFactor(userId: string, code: string): Promise<void> {
  const [{ headers }, { clientIp }, { checkSecondFactor }, { describeWait }] = await Promise.all([
    import('next/headers'),
    import('@/libs/http/clientIp'),
    import('@/services/auth/mfa'),
    import('@/libs/rateLimit'),
  ]);
  const check = await checkSecondFactor(userId, code, { ip: clientIp(await headers()) });
  if (check.ok) {
    return;
  }
  if (check.reason === 'locked') {
    throw ApiError.tooManyRequests(`Too many attempts. Try again in ${describeWait(check.retryAfterSeconds)}.`, check.retryAfterSeconds);
  }
  throw ApiError.badRequest('That code did not work. Check your app and try again.');
}

export const mfaStatusRoute = os.handler(async () => {
  const { userId, accountId, has } = await guardAuth();
  const [{ accountRequiresMfa, mfaStatus }, { isDemoSandbox }, { hasPassword }] = await Promise.all([
    import('@/services/auth/mfa'),
    import('@/libs/identity/demoSandbox'),
    import('@/services/UserProfileService'),
  ]);
  const status = await mfaStatus(userId);
  return {
    ...status,
    /**
     * Whether two-step sign-in can be set up here at all. Not in the demo
     * sandbox, where every visitor shares one login (`libs/identity/demoSandbox.ts`).
     */
    available: !isDemoSandbox(),
    /** Whether setting it up asks for the password (else a recent sign-in stands in). */
    hasPassword: await hasPassword(userId),
    /** The active account's own switch, for an admin to see and flip. */
    account: accountId
      ? { required: await accountRequiresMfa(accountId), canChange: has({ role: ORG_ROLE.ADMIN }) }
      : null,
  };
});

export const disableMfaRoute = os
  .input(z.object({ code: z.string().min(1).max(64) }))
  .handler(async ({ input }) => {
    const { userId } = await guardAuth();
    await requireSecondFactor(userId, input.code);
    const { disableMfa } = await import('@/services/auth/mfa');
    const result = await disableMfa(userId);
    if (!result.ok) {
      throw ApiError.badRequest(result.requiredBy === 'deployment'
        ? 'This deployment requires two-step sign-in, so it cannot be turned off.'
        : 'An account you belong to requires two-step sign-in, so it cannot be turned off.');
    }
    // Turning it off ended every other session; this one stays signed in.
    const { keepThisSession } = await import('@/libs/Auth');
    await keepThisSession(userId);
    return { ok: true };
  });

export const regenerateRecoveryCodesRoute = os
  .input(z.object({ code: z.string().min(1).max(64) }))
  .handler(async ({ input }) => {
    const { userId } = await guardAuth();
    await requireSecondFactor(userId, input.code);
    const { regenerateRecoveryCodes } = await import('@/services/auth/mfa');
    const recoveryCodes = await regenerateRecoveryCodes(userId);
    if (!recoveryCodes) {
      throw ApiError.badRequest('Turn on two-step sign-in first.');
    }
    return { recoveryCodes };
  });

export const setAccountMfaRequirementRoute = os
  .input(z.object({ required: z.boolean() }))
  .handler(async ({ input }) => {
    const { accountId, has } = await guardAuth();
    if (!accountId || !has({ role: ORG_ROLE.ADMIN })) {
      throw ApiError.forbidden();
    }
    const { isDemoSandbox } = await import('@/libs/identity/demoSandbox');
    if (isDemoSandbox()) {
      // Requiring it would send the next visitor of the shared login to set
      // up an authenticator, then bounce them between sign-in and dashboard.
      throw ApiError.forbidden('Two-step sign-in is not available in the demo.');
    }
    const { setAccountMfaRequirement } = await import('@/services/auth/mfa');
    await setAccountMfaRequirement(accountId, input.required);
    return { ok: true, required: input.required };
  });
