import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { deferUntil } from '@/features/dashboard/chat/deferral';
import { isAgentsOwnSchedule } from '@/services/proposals/ProposalBudgetService';
import { personSaidToDecide } from '../owedDecision';

/**
 * The decision as the consent read should see it: what the card does, to
 * what, in the words of its own review card (`consentDecision`), with the
 * verb. Falls back to the bare number when the card cannot be read.
 * @param orgId - The workspace.
 * @param verb - approve, reject or defer.
 * @param id - The proposal (action run) id.
 */
async function describedDecision(orgId: string, verb: string, id: number): Promise<string> {
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { actionRunSchema } = await import('@/models/Schema');
    const [run] = await db.select({ actionId: actionRunSchema.actionId, input: actionRunSchema.input, proposal: actionRunSchema.proposal }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, id))).limit(1);
    if (!run) {
      return `${verb} proposal #${id}`;
    }
    const { consentDecision } = await import('../consentDecision');
    const rationale = String((run.proposal as { rationale?: unknown } | null)?.rationale ?? '').slice(0, 200);
    return `${verb} the card waiting for them (proposal #${id}), which does this:\n${await consentDecision(orgId, run.actionId, (run.input ?? {}) as Record<string, unknown>, rationale)}`;
  } catch {
    return `${verb} proposal #${id}`;
  }
}

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
      // THE PERSON'S WORDS ARE THE GATE (conversation 378): a decision taken
      // for a person is one they said, in this turn's message (or the one
      // before, when this one is a bare "do it") — read by a model, never a
      // word match (`turnJudge.saidToDecide`). A workspace token is the
      // person's own client acting directly, so it carries no message.
      // The card as the person knows it, never its number alone: they say
      // "build it", not "approve #6061" (Walk 6, 2026-10-02, FE-130).
      if (!ctx.userId.startsWith('token:') && !(await personSaidToDecide(ctx, await describedDecision(ctx.orgId, input.decision, input.id))).said) {
        return `Refused: the person has not said to ${input.decision} proposal #${input.id} in their message. Recommend it and let them say so, or let them press the card.`;
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
      description: 'Decide a pending proposal card on the person\'s behalf, in their own turn: approve, reject, or defer a week. Use when the person says which card and what to do with it ("approve the first one", "reject the admin panel", "defer the rename") — their words this turn are the gate; the tool refuses a decision they did not say. Never on your own schedule. The card redraws itself; reply in one sentence.',
      schema: z.object({
        id: z.number().int().positive().describe('The proposal (action run) id: the proposal number a card in this conversation carries, or one listed under what is waiting on the page\'s record. There is no tool that lists proposals; never guess an id.'),
        decision: z.enum(['approve', 'reject', 'defer']).describe('What the person said to do with it'),
        note: z.string().max(500).optional().describe('The person\'s reason, in their words, when they gave one'),
      }),
    },
  );
}
