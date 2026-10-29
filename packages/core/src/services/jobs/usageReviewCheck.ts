/**
 * usage-review-check — the Workspace manager's morning check, in code: was
 * this workspace used in the last day? Only then is `usage.review_due` raised,
 * and the plugin's `usage-review` automation runs the review (ADR 0008). An
 * unused workspace costs two indexed reads and no model.
 *
 * One event per workspace day (its dedupe key is the workspace's date), so a
 * second tick, a retry or a restart never runs the review twice.
 */

import { hadActivity } from '@/services/usageReview/reader';

export const USAGE_REVIEW_CHECK_JOB = 'usage-review-check';

/** The event the plugin's review automation answers. */
export const USAGE_REVIEW_DUE_EVENT = 'usage.review_due';

/**
 * The workspace's date, as the dedupe key names it. Pure.
 * @param at - The clock.
 * @param timeZone - The workspace's zone.
 */
export function workspaceDay(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * Check one workspace and raise the review when it was used.
 * @param orgId - The workspace.
 * @param input - `now` (ISO), for a run by hand or a test.
 */
export async function runUsageReviewCheckJob(orgId: string, input: Record<string, unknown> = {}): Promise<{ due: boolean; reason?: string; deduped?: boolean }> {
  const now = typeof input.now === 'string' && !Number.isNaN(Date.parse(input.now)) ? new Date(input.now) : new Date();
  const until = now;
  const since = new Date(now.getTime() - 86_400_000);
  if (!await hadActivity(orgId, { since, until })) {
    return { due: false, reason: 'nobody used the workspace in the last day' };
  }
  const { workspaceTimeZone } = await import('@/libs/time/workspaceTimeZone');
  const day = workspaceDay(now, await workspaceTimeZone(orgId));
  const { emitEvent } = await import('@/services/EventService');
  const res = await emitEvent({
    orgId,
    type: USAGE_REVIEW_DUE_EVENT,
    payload: { day, since: since.toISOString(), until: until.toISOString() },
    dedupeKey: `usage-review:${day}`,
    invokedBy: `job:${USAGE_REVIEW_CHECK_JOB}`,
  });
  return { due: true, deduped: res.deduped };
}
