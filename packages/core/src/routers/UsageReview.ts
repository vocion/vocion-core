/**
 * The daily usage review (docs/guides/usage-review.md): the Org's "Help
 * improve Vocion" switch, and a run by hand for a workspace's admins.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/** The Org's setting: whether the review may read chat content, and whether this person may change it. */
export const settingRoute = os.handler(async () => {
  const { accountId, has } = await guardAuth();
  if (!accountId) {
    throw ApiError.forbidden();
  }
  const { usageReviewSetting } = await import('@/services/usageReview/privacy');
  return { ...(await usageReviewSetting(accountId)), canChange: has({ role: ORG_ROLE.ADMIN }) };
});

export const setSettingRoute = os
  .input(z.object({ on: z.boolean() }))
  .handler(async ({ input }) => {
    const { accountId, has } = await guardAuth();
    if (!accountId || !has({ role: ORG_ROLE.ADMIN })) {
      throw ApiError.forbidden();
    }
    const { setUsageReviewContent, usageReviewSetting } = await import('@/services/usageReview/privacy');
    await setUsageReviewContent(accountId, input.on);
    return { ...(await usageReviewSetting(accountId)), canChange: true };
  });

/** Run today's review now, by hand. */
export const runRoute = os.handler(async () => {
  const { orgId, has } = await guardAuth();
  if (!has({ role: ORG_ROLE.ADMIN })) {
    throw ApiError.forbidden();
  }
  const { usageReview } = await import('@/libs/usageReviewBridge');
  const { runUsageReview, usageReviewLine } = await usageReview();
  const r = await runUsageReview(orgId);
  return { skipped: r.skipped ?? null, briefingId: r.briefingId ?? null, line: usageReviewLine(r) };
});
