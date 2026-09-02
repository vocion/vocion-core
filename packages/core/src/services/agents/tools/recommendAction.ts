/**
 * recommend_action — A2UI: surface a one-tap recommended action in the answer.
 *
 * Unlike propose_action (which creates a gated action_run immediately), this
 * only RECOMMENDS: it emits a `recommended_action` event the chat renders as a
 * clickable card. The gated review item is JIT-created only if the user taps it
 * (review.propose), reusing the agent's authority so it still lands `pending`
 * for approval. Use it to turn "you should follow up with Carlo" into a button
 * the user can act on, instead of leaving the recommendation as dead text.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listActions } from '@/libs/actions/registry';

export function recommendActionTool(ctx: RuntimeContext) {
  const available = listActions().map(a => `${a.id} — ${a.description}`).join('\n');

  return tool(
    async (input) => {
      const { action_id, action_input, label, rationale, confidence } = input as {
        action_id: string;
        action_input: Record<string, unknown>;
        label: string;
        rationale?: string;
        confidence?: number;
      };
      ctx.emit({
        type: 'recommended_action',
        recommendation: {
          actionId: action_id,
          input: action_input ?? {},
          label,
          rationale,
          confidence,
          agentSlug: ctx.agentSlug,
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
        label: z.string().describe('Short human button label, e.g. "Draft the note to Carlo Marcelino"'),
        rationale: z.string().optional().describe('One line: why this action, now'),
        confidence: z.number().min(0).max(1).optional().describe('Your confidence 0–1 from grounding quality'),
      }),
    },
  );
}
