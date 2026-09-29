import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { isAgentsOwnSchedule } from '@/services/proposals/ProposalBudgetService';
import { personMessages } from '../owedDecision';
import { saidToDecide } from '../turnJudge';

/**
 * A PERSON ANSWERS AN ASK BY SAYING SO.
 *
 * Conversation 378 (2026-09-29): request #201's page carried a Stopped ask
 * (#221, "Approve to build again") and the person wrote "approve, fix and
 * run" in the page's dock. The agent could decide a card (`decide_proposal`)
 * but had no way to answer the ask, so the one decision on the page stayed
 * open under a turn that said it would do it. This is the ask's Approve
 * button, from the composer: the same `decideAsk` the Needs you sheet calls,
 * so an option that carries an action runs it as the person
 * (`AskService.carryOutChosenOption`) and `ask.decided` reaches every
 * subscriber (the factory's recovery count among them).
 *
 * Gated on the person's own words: the answer must be one their message this
 * turn says (`owedDecision.personSaid`) — never the model's reading of the
 * thread. Only a person may decide; on an agent's own schedule it refuses.
 * @param ctx - The runtime context of the turn.
 */
export function decideAskTool(ctx: RuntimeContext) {
  return tool(
    async (input) => {
      if (isAgentsOwnSchedule(ctx) || !ctx.userId) {
        return 'Refused: only a person can answer an ask, in their own turn. Say what you recommend and let them answer.';
      }
      const { AskError, decideAsk, getAsk } = await import('@/services/AskService');
      const ask = await getAsk(ctx.orgId, input.id);
      if (!ask) {
        return `Refused: there is no ask #${input.id} in this workspace.`;
      }
      if (ask.status !== 'open') {
        return `Ask #${input.id} was already decided (${ask.status}${ask.decision ? `: ${ask.decision}` : ''}); nothing to do.`;
      }
      const option = (ask.options ?? []).find(o => o.id === input.decision);
      if (!ctx.userId.startsWith('token:') && !(await saidToDecide({ orgId: ctx.orgId, messages: await personMessages(ctx), decision: `answer ask #${input.id} "${ask.title}" with "${option?.label ?? input.decision}"` })).said) {
        return `Refused: the person has not said to answer ask #${input.id} with "${input.decision}" in their message. Recommend the answer and let them say so.`;
      }
      try {
        const row = await decideAsk({ orgId: ctx.orgId, id: input.id, decision: input.decision, note: input.note ?? null, decidedBy: ctx.userId });
        const carried = row.decisionNote && row.decisionNote !== (input.note ?? null) ? ` ${row.decisionNote.split('\n').at(-1)}` : '';
        // The records it was about, named — so the answer can point at what
        // the decision set moving (the turn's follow chips read this line).
        const about = (row.objectRefs ?? []).slice(0, 3).map(r => `${r.type} #${r.id}`).join(', ');
        return `Decided ask #${row.id} "${row.title}": ${row.decision} (${row.status}).${carried}${about ? ` About: ${about}.` : ''} It leaves Needs you now; say what it did in one sentence.`;
      } catch (err) {
        if (err instanceof AskError) {
          return `Refused: ${err.message}`;
        }
        throw err;
      }
    },
    {
      name: 'decide_ask',
      description: 'Answer an open ask (a question or approval waiting on the person, e.g. a Stopped ask on a request) on the person\'s behalf, in their own turn — when their message says the answer ("approve", "leave it stopped", an option\'s label). The same answer as the ask\'s own buttons: an option that carries an action runs it as the person. Refuses an answer they did not say. Never on your own schedule.',
      schema: z.object({
        id: z.number().int().positive().describe('The ask id'),
        decision: z.string().min(1).max(80).describe('approve, reject, done, or one of the ask\'s option ids'),
        note: z.string().max(500).optional().describe('The person\'s words, when they gave a reason or what to change'),
      }),
    },
  );
}
