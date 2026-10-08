import type { RecommendedAction } from '@/features/dashboard/chat/types';
import type { ReviewRow } from '@/services/inbox/reviewRows';
import { inboxHref } from '@/services/inbox/inboxRef';
import { listReviewRows } from '@/services/inbox/reviewRows';

/**
 * Every proposal waiting on a person, as the cards chat already draws.
 *
 * A proposal filed during a turn is a card in that turn (`proposeAction.ts`).
 * One filed anywhere else — an automation's sweep, a mission, another
 * thread — sat in the review queue only, and the person was sent there to
 * find it (Jamie, 2026-10-07: "if a review card or action item is pending
 * pull that into chat, so the user can take action. I shouldn't be forced to
 * go out to the review queue to do anything"). This reads the queue's own
 * open rows and shapes each as a `RecommendedAction` with its `runId`, so
 * the chat card decides it through the same `review.decideAction` path the
 * queue uses — one run, one decision, drawn in two places.
 *
 * Only a run still `pending` is a decision; a failed run or a released
 * hand-off waiting to be marked done is the queue's to close.
 */

/** How many waiting proposals chat draws before pointing at the queue for the rest. */
export const PENDING_IN_CHAT_LIMIT = 12;

/**
 * A review row as a chat card, or null when it is not a decision a card can take.
 * @param row - One open row of the review queue.
 */
export function pendingDecisionCard(row: ReviewRow): RecommendedAction | null {
  if (row.status !== 'pending') {
    return null;
  }
  const d = row.described;
  const proposal = row.proposal ?? {};
  const suggested = proposal.suggestedDecision;
  const suggestedReason = proposal.suggestedDecisionReason;
  return {
    id: `run:${row.id}`,
    kind: 'action',
    state: 'filed',
    runId: row.id,
    actionId: row.actionId,
    input: row.input,
    label: d.title,
    ...(d.rationale ? { rationale: d.rationale } : {}),
    ...(typeof d.confidence === 'number' ? { confidence: d.confidence } : {}),
    ...(d.agentSlug ? { agentSlug: d.agentSlug } : {}),
    ...(suggested === 'approve' || suggested === 'reject' || suggested === 'snooze'
      ? { suggestedDecision: suggested, ...(typeof suggestedReason === 'string' ? { suggestedDecisionReason: suggestedReason } : {}) }
      : {}),
    // The evidence, one move away: the queue's own detail for this run.
    href: inboxHref('proposal', row.id),
    hrefLabel: 'Details',
  };
}

/**
 * The open queue as chat cards, newest first.
 * @param rows - The queue's open rows.
 */
export function pendingDecisionCards(rows: ReviewRow[]): RecommendedAction[] {
  return rows.map(pendingDecisionCard).filter((c): c is RecommendedAction => c !== null);
}

export type PendingDecisions = {
  /** The cards chat draws. */
  cards: RecommendedAction[];
  /** How many more wait in the queue beyond the cards. */
  more: number;
};

/**
 * The proposals waiting on this workspace's people, for the chat surface.
 * @param orgId - The workspace.
 */
export async function listPendingDecisions(orgId: string): Promise<PendingDecisions> {
  const all = pendingDecisionCards(await listReviewRows(orgId, 'open'));
  return { cards: all.slice(0, PENDING_IN_CHAT_LIMIT), more: Math.max(0, all.length - PENDING_IN_CHAT_LIMIT) };
}
