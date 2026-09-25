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
import { recommendedActionAdvice } from '@/services/chat/recommendedActionAdvice';

export const CONVERSATION_AUTONOMY = ['ask-before-acting', 'act-within-bounds'] as const;
export type ConversationAutonomy = (typeof CONVERSATION_AUTONOMY)[number];

/**
 * Read an autonomy value off whatever the client or the conversation row
 * carries. Unknown / missing → `ask-before-acting`, the safe default.
 * @param raw - `body.autonomy` or `conversation.autonomy`.
 */
export function readAutonomy(raw: unknown): ConversationAutonomy {
  // Nothing said (no conversation row yet) is the default — done for you since
  // 2026-09-18. A value that is neither rung is a client bug, and a bug asks.
  if (raw === undefined || raw === null) {
    return 'act-within-bounds';
  }
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
  const filed = await autoProposeRecommendationDetailed(opts);
  return filed?.runId ?? null;
}

/** What a filed card came to: the proposal id, its status, and the record it created when it ran (finding 24). */
export type FiledCard = { runId: number; status: string; ref?: { type: string; id: number } };

/**
 * File a recommendation and say what happened — the proposal id, whether it
 * executed on the spot (done-for-you), and the record it created if so.
 * @param opts - The recommendation and who is filing.
 * @param opts.orgId
 * @param opts.userId
 * @param opts.rec
 */
export async function autoProposeRecommendationDetailed(opts: {
  orgId: string;
  userId?: string;
  rec: RecommendedActionPayload;
}): Promise<FiledCard | null> {
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
        ...recommendedActionAdvice(opts.rec),
      },
      dedupKey: deriveRecommendationDedupKey(opts.rec.actionId, opts.rec.input),
    });
    const out = res as { runId?: number; status?: string; result?: Record<string, unknown> | null };
    if (typeof out.runId !== 'number') {
      return null;
    }
    return { runId: out.runId, status: out.status ?? 'pending', ...(refOf(opts.rec, out.result) ? { ref: refOf(opts.rec, out.result)! } : {}) };
  } catch {
    return null;
  }
}

/**
 * The record an executed proposal created, when the action's result names
 * one — `objects.propose_candidate` returns `objectId` + `objectType`; any
 * action returning a numeric `id` counts, typed by the input's objectType.
 * @param rec - The recommendation that was filed.
 * @param result - What `execute` returned, if it ran.
 */
export function refOf(rec: RecommendedActionPayload, result: Record<string, unknown> | null | undefined): { type: string; id: number } | null {
  if (!result) {
    return null;
  }
  const id = typeof result.objectId === 'number' ? result.objectId : typeof result.id === 'number' ? result.id : null;
  if (id === null) {
    return null;
  }
  const type = typeof result.objectType === 'string' ? result.objectType : typeof rec.input?.objectType === 'string' ? rec.input.objectType : rec.actionId;
  return { type, id };
}
