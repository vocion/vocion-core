import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { deferUntil } from '@/features/dashboard/chat/deferral';
import { isAgentsOwnSchedule } from '@/services/proposals/ProposalBudgetService';
import { personMessages } from '../owedDecision';
import { saidToDecide } from '../turnJudge';

/**
 * What a card is, in a line the consent read can match a person's words to:
 * "drop the incident card" names no number (conversation 420), so the read
 * is given the card's action, who filed it and why, not its id alone.
 * @param orgId - The workspace.
 * @param id - The proposal (action run) id.
 */
export async function describeCard(orgId: string, id: number): Promise<string | null> {
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { actionRunSchema } = await import('@/models/Schema');
    const [row] = await db
      .select({ actionId: actionRunSchema.actionId, invokedBy: actionRunSchema.invokedBy, proposal: actionRunSchema.proposal })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, id)))
      .limit(1);
    if (!row) {
      return null;
    }
    const proposal = (row.proposal ?? {}) as { agentSlug?: unknown; rationale?: unknown };
    const by = typeof proposal.agentSlug === 'string' ? proposal.agentSlug : row.invokedBy;
    const why = typeof proposal.rationale === 'string' ? proposal.rationale.slice(0, 240) : '';
    return `a ${row.actionId} card${by ? ` filed by ${by}` : ''}${why ? `: "${why}"` : ''}`;
  } catch {
    return null;
  }
}

/**
 * A person's decision on any card, taken in their turn on their word — the
 * same decision the card's buttons make, whoever filed the card.
 * @param ctx - The turn.
 * @param input - Which card, what to do, and the person's note.
 * @param input.id - The proposal id.
 * @param input.decision - Approve, reject or defer.
 * @param input.note - The person's reason.
 */
export async function decideAsPerson(ctx: RuntimeContext, input: { id: number; decision: 'approve' | 'reject' | 'defer'; note?: string }): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (isAgentsOwnSchedule(ctx) || !ctx.userId) {
    return { ok: false, message: 'Refused: only a person can decide a proposal, in their own turn. Say what you recommend and let them decide.' };
  }
  // THE PERSON'S WORDS ARE THE GATE (conversation 378): a decision taken
  // for a person is one they said, in this turn's message (or the one
  // before, when this one is a bare "do it") — read by a model, never a
  // word match (`turnJudge.saidToDecide`). A workspace token is the
  // person's own client acting directly, so it carries no message.
  if (!ctx.userId.startsWith('token:')) {
    const card = await describeCard(ctx.orgId, input.id);
    const decision = `${input.decision} proposal #${input.id}${card ? ` — ${card}` : ''}`;
    if (!(await saidToDecide({ orgId: ctx.orgId, messages: await personMessages(ctx), decision })).said) {
      return { ok: false, message: `Refused: the person has not said to ${input.decision} proposal #${input.id} in their message. Recommend it and let them say so, or let them press the card.` };
    }
  }
  const { decide, snooze } = await import('@/services/ReviewService');
  const item = { kind: 'action' as const, id: input.id };
  if (input.decision === 'defer') {
    const until = deferUntil();
    await snooze(ctx.orgId, item, until, ctx.userId, { note: input.note ?? 'Deferred from chat' });
    return { ok: true, message: `Deferred proposal #${input.id} until ${until.toISOString().slice(0, 10)}. The card now reads Deferred; it comes back to review then.` };
  }
  const result = await decide(item, input.decision, ctx.orgId, { reviewedBy: ctx.userId, note: input.note, reason: input.note });
  const status = (result as { status?: string } | null)?.status ?? input.decision;
  return { ok: true, message: `${input.decision === 'approve' ? 'Approved' : 'Rejected'} proposal #${input.id} (${status}). The card updates on its own; do not restate what it shows.` };
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
      return (await decideAsPerson(ctx, input)).message;
    },
    {
      name: 'decide_proposal',
      description: 'Decide a pending proposal card on the person\'s behalf, in their own turn: approve, reject, or defer a week — ANY card, whichever seat or agent filed it. Use when the person says which card and what to do with it ("approve the first one", "reject the admin panel", "drop the incident card", "defer the rename") — their words this turn are the gate; the tool refuses a decision they did not say. Never on your own schedule. The card redraws itself; reply in one sentence.',
      schema: z.object({
        id: z.number().int().positive().describe('The proposal (action run) id — on the card, or from list_proposals'),
        decision: z.enum(['approve', 'reject', 'defer']).describe('What the person said to do with it'),
        note: z.string().max(500).optional().describe('The person\'s reason, in their words, when they gave one'),
      }),
    },
  );
}
