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
/**
 * What a card filed from a conversation recommendation says about itself.
 *
 * Every review card carries a recommendation and a reason, and nothing here
 * has a model judging the card at the moment it is filed: the agent already
 * argued for the action in the conversation, and filing it IS the ask. So core
 * states that plainly rather than leaving the row with no opinion for the
 * agreement metric to measure. Shared with the two places a person can file
 * one by hand — `RecommendedActionCard` and `RecommendedActionStack` — so the
 * queue reads the same sentence however the card got there.
 */
export const RECOMMENDED_ACTION_ADVICE = {
  suggestedDecision: 'approve' as const,
  suggestedDecisionReason: 'The agent recommended this action in the conversation and it is waiting to be carried out.',
};

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
        ...RECOMMENDED_ACTION_ADVICE,
      },
      dedupKey: deriveRecommendationDedupKey(opts.rec.actionId, opts.rec.input),
    });
    const runId = (res as { runId?: number }).runId;
    return typeof runId === 'number' ? runId : null;
  } catch {
    return null;
  }
}
