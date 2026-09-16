/**
 * Act within bounds — the server half of the conversation autonomy toggle.
 *
 * A conversation in `act-within-bounds` mode has the person's standing
 * permission for the agent to file its recommendations into the review queue
 * without a tap; nothing executes here — `proposeAction` still lands the run
 * `pending`, and trust rules / a reviewer decide it exactly as they would a
 * tapped card (manifesto §8: automation is earned, never assumed). The card
 * the person sees carries the run id from the first frame, so it shows the
 * queue status instead of a "Prepare" button.
 */

import type { RecommendedActionPayload } from '@/services/agents/types';

export const CONVERSATION_AUTONOMY = ['ask-before-acting', 'act-within-bounds'] as const;
export type ConversationAutonomy = (typeof CONVERSATION_AUTONOMY)[number];

/**
 * Read an autonomy value off whatever the client or the conversation row
 * carries. Unknown / missing → `ask-before-acting`, the safe default.
 * @param raw - `body.autonomy` or `conversation.autonomy`.
 */
export function readAutonomy(raw: unknown): ConversationAutonomy {
  return raw === 'act-within-bounds' ? 'act-within-bounds' : 'ask-before-acting';
}

/**
 * Same key the review router derives for a tapped card, so an auto-proposed
 * and a tapped recommendation for the same target dedupe onto one run.
 * @param actionId
 * @param input
 */
export function deriveRecommendationDedupKey(actionId: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : undefined);
  if (actionId === 'gmail.send') {
    const to = s(input.to);
    return to ? `gmail.send:${to}` : undefined;
  }
  const objId = s(input.objectId) ?? s(input.object_id) ?? s(input.recordId) ?? s(input.id);
  return objId ? `${actionId}:${objId}` : undefined;
}

/**
 * File one recommendation into the review queue on the agent's authority
 * (identical principal shape to `review.propose`). Returns the run id, or
 * null when the proposal failed — the card then falls back to the tap path.
 * @param opts
 * @param opts.orgId
 * @param opts.userId
 * @param opts.rec
 */
export async function autoProposeRecommendation(opts: {
  orgId: string;
  userId?: string;
  rec: RecommendedActionPayload;
}): Promise<number | null> {
  try {
    const { proposeAction } = await import('@/services/ActionService');
    const agentId = opts.rec.agentSlug ? `agent:${opts.rec.agentSlug}` : 'agent:unknown';
    const res = await proposeAction({
      orgId: opts.orgId,
      actionId: opts.rec.actionId,
      input: opts.rec.input,
      principal: { kind: 'agent', id: agentId, scope: { orgId: opts.orgId }, grants: ['*'], autonomy: 2 },
      invokedBy: opts.userId ?? agentId,
      proposal: {
        confidence: opts.rec.confidence,
        rationale: opts.rec.rationale,
      },
      dedupKey: deriveRecommendationDedupKey(opts.rec.actionId, opts.rec.input),
    });
    const runId = (res as { runId?: number }).runId;
    return typeof runId === 'number' ? runId : null;
  } catch {
    return null;
  }
}
