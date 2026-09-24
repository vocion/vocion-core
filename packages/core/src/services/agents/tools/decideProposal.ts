import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { deferUntil } from '@/features/dashboard/chat/deferral';
import { isAgentsOwnSchedule } from '@/services/proposals/ProposalBudgetService';

/**
 * A PERSON DECIDES A CARD BY SAYING SO.
 *
 * "Approve the first one." "Reject the admin panel, not now." "Defer the
 * rename a week." The cards in chat are proposals in the review queue; this
 * tool is the same decision the card's buttons make, taken on the person's
 * behalf in their own turn, so a reply in the composer and a tap on the card
 * are one path (principle 2). The card polls its run's status, so it redraws
 * as decided within a tick — the person sees the card change, not a sentence
 * claiming it did.
 *
 * Only a person may decide. On an agent's own schedule (a mission, an
 * automation, a run with no conversation) this tool refuses: an agent
 * approving its own proposals is the loop this tool must never close.
 * @param ctx - The runtime context of the turn.
 */
export function decideProposalTool(ctx: RuntimeContext) {
  return tool(
    async (input) => {
      if (isAgentsOwnSchedule(ctx) || !ctx.userId) {
        return 'Refused: only a person can decide a proposal, in their own turn. Say what you recommend and let them decide.';
      }
      const { decide, snooze } = await import('@/services/ReviewService');
      const item = { kind: 'action' as const, id: input.id };
      if (input.decision === 'defer') {
        const until = deferUntil();
        await snooze(ctx.orgId, item, until, ctx.userId, { note: input.note ?? 'Deferred from chat' });
        return `Deferred proposal #${input.id} until ${until.toISOString().slice(0, 10)}. The card now reads Deferred; it comes back to review then.`;
      }
      const result = await decide(item, input.decision, ctx.orgId, { reviewedBy: ctx.userId, note: input.note, reason: input.note });
      const status = (result as { status?: string } | null)?.status ?? input.decision;
      return `${input.decision === 'approve' ? 'Approved' : 'Rejected'} proposal #${input.id} (${status}). The card updates on its own; do not restate what it shows.`;
    },
    {
      name: 'decide_proposal',
      description: 'Decide a pending proposal card on the person\'s behalf, in their own turn: approve, reject, or defer a week. Use when the person says which card and what to do with it ("approve the first one", "reject the admin panel", "defer the rename"). Never on your own schedule. The card redraws itself; reply in one sentence.',
      schema: z.object({
        id: z.number().int().positive().describe('The proposal (action run) id — on the card, or from list_proposals'),
        decision: z.enum(['approve', 'reject', 'defer']).describe('What the person said to do with it'),
        note: z.string().max(500).optional().describe('The person\'s reason, in their words, when they gave one'),
      }),
    },
  );
}
