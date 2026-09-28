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
