import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { proposalBudgetLine, withdrawProposal } from '@/services/proposals/ProposalBudgetService';

/**
 * withdraw_proposal — the agent takes back one of its own undecided items in
 * Review (a pending proposal or an open ask) because a better idea supersedes
 * it or the thing it asked about went away. The other half of the proposal
 * budget: the cap says "no more until one is decided or withdrawn", this is
 * the withdrawal. Refuses anything the agent did not file.
 * @param ctx - The turn.
 */
export function withdrawProposalTool(ctx: RuntimeContext) {
  return tool(
    async (input) => {
      const { kind, id, reason, superseded_by } = input as { kind: 'proposal' | 'ask'; id: number; reason: string; superseded_by?: string };
      if (!ctx.agentSlug) {
        return 'Only an agent withdraws its own proposals.';
      }
      const res = await withdrawProposal({ orgId: ctx.orgId, agentSlug: ctx.agentSlug, kind: kind === 'ask' ? 'ask' : 'run', id, reason, supersededBy: superseded_by ?? null });
      if (!res.ok) {
        return res.message;
      }
      const line = await proposalBudgetLine(ctx.orgId, ctx.agentSlug);
      return `Withdrawn ${kind} #${id}${superseded_by ? ` (superseded by ${superseded_by})` : ''}. Your budget now: ${line}.`;
    },
    {
      name: 'withdraw_proposal',
      description: 'Take back ONE of your own undecided items in Review — a pending proposal (an action card) or an open ask — because a better idea supersedes it or what it asked about went away. Use it when propose_action or file_ask refused you for holding too many undecided items. You can only withdraw what you filed; a person\'s or another agent\'s items are not yours.',
      schema: z.object({
        kind: z.enum(['proposal', 'ask']).describe('"proposal" for a pending action card, "ask" for an open ask'),
        id: z.number().int().positive().describe('The id, as the refusal listed it'),
        reason: z.string().min(3).max(500).describe('Why, in one sentence a person can read on the record'),
        superseded_by: z.string().max(80).optional().describe('What replaces it, e.g. "proposal #412" or "request #77" — so the record shows the idea moved on rather than died'),
      }),
    },
  );
}
