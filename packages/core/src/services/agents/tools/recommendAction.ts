/**
 * recommend_action — A2UI: surface a one-tap recommended action in the answer.
 *
 * Unlike propose_action (which creates a gated action_run immediately), this
 * only RECOMMENDS: it emits a `recommended_action` event the chat renders as a
 * clickable card. The gated review item is JIT-created only if the user taps it
 * (review.propose), reusing the agent's authority so it still lands `pending`
 * for approval. Use it to turn "you should follow up with Nadia" into a button
 * the user can act on, instead of leaving the recommendation as dead text.
 */

import type { RuntimeContext } from '../types';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getAction, listActions } from '@/libs/actions/registry';
import { SUGGESTED_DECISIONS } from '@/libs/actions/suggestedDecision';

export function recommendActionTool(ctx: RuntimeContext) {
  const available = listActions().map(a => `${a.id} — ${a.description}`).join('\n');

  return tool(
    async (input) => {
      const { action_id, action_input, label, rationale, confidence, suggested_decision, suggested_decision_reason } = input as {
        action_id: string;
        action_input: Record<string, unknown>;
        label: string;
        rationale?: string;
        confidence?: number;
        suggested_decision?: SuggestedDecision;
        suggested_decision_reason?: string;
      };
      // A card is never lost to a missing sentence: the reviewer's suggested
      // decision defaults to approve — the tool is recommending — and its
      // reason to the rationale (2026-09-24: a decline case died in the
      // reference run on exactly this field).
      const suggestedDecision: SuggestedDecision = suggested_decision ?? 'approve';
      const suggestedDecisionReason = suggested_decision_reason?.trim() || rationale?.trim() || `Recommended: ${label}`;
      // The card's Approve calls the action with this payload, so a payload the
      // action rejects is a card that can only fail — on 2026-09-18 one reached
      // production as "Couldn't prepare it: Internal server error". Validate
      // here, where the model can still fix it, and say exactly what is wrong.
      if (action_id) {
        const action = getAction(action_id);
        if (!action) {
          return JSON.stringify({ ok: false, error: `No registered action "${action_id}". Registered: ${listActions().map(a => a.id).join(', ')}. Pick one of these, or recommend without an action id when the next step is a person's, not a system's.` });
        }
        const check = action.inputSchema.safeParse(action_input ?? {});
        if (!check.success) {
          const issues = check.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
          return JSON.stringify({ ok: false, error: `action_input for ${action_id} is invalid — ${issues}. Fill those fields from what you know, or recommend without an action id.` });
        }
      }
      ctx.emit({
        type: 'recommended_action',
        recommendation: {
          actionId: action_id,
          input: action_input ?? {},
          label,
          rationale,
          confidence,
          agentSlug: ctx.agentSlug,
          suggestedDecision,
          suggestedDecisionReason,
        },
      });
      return `Surfaced a one-tap recommendation to the user: "${label}". They can prepare it for review with a single tap. Do NOT also paste the full draft as text — the card carries it.`;
    },
    {
      name: 'recommend_action',
      description: `Surface a recommended action as a ONE-TAP CARD in your answer (not dead text). Use this for every concrete next action you suggest that maps to a connector action — the user taps to prepare it for review; nothing sends without their approval. Prefer this over spelling the action out in prose. Available actions:\n${available}`,
      schema: z.object({
        action_id: z.string().describe('Registered action id, e.g. "gmail.send"'),
        action_input: z.record(z.string(), z.unknown()).describe('Pre-filled payload for the action — for gmail.send: { to, subject, body, draft: true }'),
        label: z.string().describe('Short human button label, e.g. "Draft the note to Nadia Brandt"'),
        rationale: z.string().optional().describe('One line: why this action, now'),
        confidence: z.number().min(0).max(1).optional().describe('Your confidence 0–1 from grounding quality'),
        // Required, and asked as a separate question from `rationale`: the
        // card this becomes goes into the review queue with a recommendation
        // on it, and whatever stands there is scored against what the reviewer
        // then does. Core used to fill this in — an "approve" on every card,
        // which the agreement rate read as the agent's own view.
        suggested_decision: z.enum(SUGGESTED_DECISIONS).optional().describe('What you think the reviewer should do with this once it reaches the queue: "approve", "reject" or "snooze". Almost always "approve" for something you are recommending — say "snooze" when it should wait for something you name, and "reject" when you are surfacing it for a person to turn down. Omitted means approve.'),
        suggested_decision_reason: z.string().optional().describe('ONE short sentence for why that recommendation, in your own words — "the renewal is 11 days out and nobody has replied", "worth doing, but not until the contract is signed". Not the same as `rationale`: that argues the payload is right, this argues what should happen to the card. Omitted means the rationale.'),
      }),
    },
  );
}
