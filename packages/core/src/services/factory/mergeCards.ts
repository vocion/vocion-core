/**
 * A merge done on GitHub closes the merge card that asked for it.
 *
 * WHY (red team, 2026-09-26): `git.merge` is a hand-off — a person merges on
 * GitHub — and nothing closed the card when they did. The card stayed pending
 * in Review, and because the feature page reads a pending decision before a
 * release, a shipped feature went on saying "Ready to merge". The merge IS the
 * decision, so the card is closed as done by the merge itself: who merged is
 * GitHub's record, the commit is the merge commit, and the card says so.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';

/**
 * Close every open `git.merge` card for this pull request.
 * @param orgId - The workspace.
 * @param payload - The `pr.merged` payload (`url`, `mergeSha`, `mergedAt`, `author`).
 * @returns The ids of the cards closed.
 */
export async function closeMergeCardsOnMerge(orgId: string, payload: Record<string, unknown>): Promise<number[]> {
  const url = typeof payload.url === 'string' ? payload.url : '';
  if (!url) {
    return [];
  }
  const open = await db
    .select({ id: actionRunSchema.id, result: actionRunSchema.result })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'git.merge'),
      inArray(actionRunSchema.status, ['pending', 'awaiting_execution']),
      sql`(${actionRunSchema.input}->'externalRef'->>'url' = ${url} or ${actionRunSchema.input}->'evidence' ? ${url})`,
    ));
  const mergeSha = typeof payload.mergeSha === 'string' ? payload.mergeSha : '';
  const mergedAt = typeof payload.mergedAt === 'string' && !Number.isNaN(Date.parse(payload.mergedAt)) ? new Date(payload.mergedAt) : new Date();
  for (const card of open) {
    await db
      .update(actionRunSchema)
      .set({
        status: 'done',
        executedAt: mergedAt,
        decidedAt: mergedAt,
        decidedBy: 'github',
        error: null,
        result: {
          ...(card.result ?? {}),
          executed: {
            at: mergedAt.toISOString(),
            by: 'github',
            note: `Merged on GitHub${mergeSha ? ` at ${mergeSha.slice(0, 12)}` : ''}.`,
            resultUrl: url,
            ...(mergeSha ? { externalRef: { system: 'github', id: mergeSha } } : {}),
          },
        },
      })
      .where(eq(actionRunSchema.id, card.id));
  }
  return open.map(c => c.id);
}

/**
 * AN APPROVAL IN GIT IS AN APPROVAL (Chris, 2026-10-05: "Human or tool merging in Git directly also
 * constitutes approval … Or approvals in Git"). A person's approving review on a pull request
 * approves the merge card waiting for it, as that reviewer, and the merge runs from Vocion as it
 * would from the card — so a product whose merges wait for a person is released by them, wherever
 * they decided. A merge done in Git closes the card already (`closeMergeCardsOnMerge`).
 *
 * Only a person's review counts. QA mirrors its own verdict as a review through the workspace's
 * token, under the same login, so a review Vocion submitted (`repo.submit_review`, its review id
 * on the run's result) never approves anything; nor does a bot's, or one left on an older commit
 * than the card would merge.
 * @param orgId - The workspace.
 * @param payload - The `pr.review_submitted` payload.
 * @param decide - How the card is approved, for tests.
 * @returns The ids of the cards approved.
 */
export async function approveMergeCardsOnReview(
  orgId: string,
  payload: Record<string, unknown>,
  decide: (orgId: string, runId: number, reviewer: string, note: string) => Promise<void> = defaultDecide,
): Promise<number[]> {
  const url = typeof payload.url === 'string' ? payload.url : '';
  const reviewer = typeof payload.reviewer === 'string' ? payload.reviewer.trim() : '';
  const reviewId = Number(payload.reviewId);
  if (!url || payload.reviewState !== 'approved' || !reviewer || reviewer.endsWith('[bot]') || !Number.isInteger(reviewId) || reviewId <= 0) {
    return [];
  }
  const [ours] = await db
    .select({ id: actionRunSchema.id })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.actionId, 'repo.submit_review'), sql`${actionRunSchema.result}->>'reviewId' = ${String(reviewId)}`))
    .limit(1);
  if (ours) {
    return [];
  }
  const open = await db
    .select({ id: actionRunSchema.id, input: actionRunSchema.input })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, 'git.merge'),
      eq(actionRunSchema.status, 'pending'),
      sql`(${actionRunSchema.input}->'externalRef'->>'url' = ${url} or ${actionRunSchema.input}->'evidence' ? ${url})`,
    ));
  const reviewed = typeof payload.reviewedSha === 'string' ? payload.reviewedSha : '';
  const approved: number[] = [];
  for (const card of open) {
    const input = (card.input ?? {}) as Record<string, unknown>;
    const sha = typeof input.verdictCommitSha === 'string' ? input.verdictCommitSha : typeof input.commitSha === 'string' ? input.commitSha : '';
    // An approval of an older commit is not an approval of what would be merged.
    if (sha && reviewed && !(sha.startsWith(reviewed) || reviewed.startsWith(sha))) {
      continue;
    }
    await decide(orgId, card.id, reviewer, `Approved in GitHub by ${reviewer}${typeof payload.reviewUrl === 'string' && payload.reviewUrl ? ` (${payload.reviewUrl})` : ''}.`);
    approved.push(card.id);
  }
  return approved;
}

async function defaultDecide(orgId: string, runId: number, reviewer: string, note: string): Promise<void> {
  const { decide } = await import('@/services/ReviewService');
  await decide({ kind: 'action', id: runId }, 'approve', orgId, { reviewedBy: `github:${reviewer}`, note });
}
