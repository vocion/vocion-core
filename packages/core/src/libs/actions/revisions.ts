import type { ReviewContent } from './types';

/** One entry in `action_run.revisions` — the audit column, newest last. */
export type ActionRevision = {
  contentId?: string;
  step?: number;
  version: number;
  body: string;
  ask?: string;
  discardedEdit?: string;
  at: string;
  by?: string;
  kind?: 'proposed' | 'regenerated' | 'approved';
};

/**
 * The entries in the column that are about one content item.
 *
 * An absent `contentId` addresses the run's single body — what every
 * non-sequence action has — so "no id" is a key like any other rather than a
 * wildcard that would make a sequence's sends all read as the same item.
 * @param existing - The column as stored.
 * @param contentId - The card's content id, absent for a single-body run.
 */
export function revisionsFor(existing: readonly ActionRevision[], contentId: string | undefined): ActionRevision[] {
  return existing.filter(r => (contentId === undefined ? r.contentId === undefined : r.contentId === contentId));
}

/**
 * The version number the next entry for this content takes.
 *
 * Two rules, and the second one is why this is shared rather than inlined.
 * The proposal IS v1, by definition — it is the copy every later version is a
 * revision OF. Everything else counts from what is already filed, plus one
 * more whenever the proposal was never recorded, which is every run written
 * before the regenerate route started filing one: the draft on screen is v1
 * and the column holds nothing, so the first rewrite's answer is v2. Leaving
 * that `+ 2` inlined in one writer made it quietly wrong the moment the other
 * one started filing a real v1.
 * @param existing - The column as stored.
 * @param contentId - The card's content id, absent for a single-body run.
 * @param kind - What the entry being written is.
 */
export function nextRevisionVersion(
  existing: readonly ActionRevision[],
  contentId: string | undefined,
  kind?: ActionRevision['kind'],
): number {
  if (kind === 'proposed') {
    return 1;
  }
  const prior = revisionsFor(existing, contentId);
  return prior.length + (prior.some(r => r.kind === 'proposed') ? 1 : 2);
}

/**
 * The step a `send-2` style content id names, for the column's `step` field.
 * Absent for any id that does not carry one, which is every non-sequence kind.
 * @param contentId - The card's content id.
 */
export function stepOf(contentId: string | undefined): number | undefined {
  if (!contentId?.startsWith('send-')) {
    return undefined;
  }
  const n = Number(contentId.slice('send-'.length));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The copy a content item currently carries, as the record stores it.
 *
 * Only kinds that HAVE copy a reviewer approves answer here — an email does, a
 * document preview and an image do not, and recording an empty body for those
 * would put an approved revision on the audit with nothing in it.
 * @param item - The card's content item.
 */
export function copyOf(item: ReviewContent): { subject?: string; body: string } | null {
  return item.kind === 'email' ? { subject: item.subject, body: item.body } : null;
}
