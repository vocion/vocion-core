import { os } from '@orpc/server';
import { z } from 'zod';
import { DECISION_SUBJECTS, readDecisionAnswerWire } from '@/libs/decisions/decision';
import { getConversation } from '@/services/ConversationService';
import { answerElsewhere, buildDecisionFor, DecisionError, openDecisions, waitingElsewhere } from '@/services/decisions/DecisionService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * A Decision's own errors, as the API's: not found here, already decided, not
 * an answer it takes.
 * @param err - What was thrown.
 */
function asApiError(err: unknown): never {
  if (err instanceof DecisionError) {
    throw err.code === 'NOT_FOUND' ? ApiError.notFound({ reason: err.message }) : ApiError.badRequest(err.message);
  }
  throw err;
}

/**
 * decisions.open — what a conversation is waiting on, oldest first: its open
 * questions and the proposals filed from it. The first is docked above its
 * composer, the rest are the queue behind it ("1 of 3"). Scoped to the
 * workspace AND to a conversation this person can see.
 *
 * Answering one is not a call here: an answer goes to the agent that asked,
 * as a typed `decision_answer` on the turn it starts (`/rpc/agent/stream`).
 */
export const openRoute = os
  .input(z.object({ conversationId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const conversation = await getConversation({ orgId, id: input.conversationId, viewerId: userId });
    if (!conversation) {
      throw ApiError.notFound({ conversationId: input.conversationId });
    }
    return openDecisions(orgId, input.conversationId, userId);
  });

/**
 * decisions.waiting — what else waits on this person outside any
 * conversation: questions a mission or automation put on Needs you, and
 * proposals filed from no conversation. They queue in the dock behind the
 * conversation's own, so a person clears them without leaving chat.
 */
export const waitingRoute = os.handler(async () => {
  const { orgId, userId } = await guardAuth();
  return waitingElsewhere(orgId, userId);
});

/**
 * decisions.answer — answer one of those, from the dock. No turn follows:
 * whoever asked hears it the way it always did. A conversation's own Decision
 * is answered in its conversation, never here.
 */
export const answerRoute = os
  .input(z.object({ id: z.number().int().positive(), subject: z.enum(DECISION_SUBJECTS).default('ask'), option_ids: z.array(z.string().min(1).max(80)).max(8).optional(), free_text: z.string().max(4_000).optional(), skip: z.boolean().optional() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const typed = readDecisionAnswerWire(input);
    if (!typed) {
      throw ApiError.badRequest('An answer is options, words or a skip — exactly one.');
    }
    try {
      const out = await answerElsewhere({ orgId, subject: typed.subject, id: typed.id, answer: typed.answer, by: userId });
      return { decision: out.view, effect: out.effect };
    } catch (err) {
      return asApiError(err);
    }
  });

/**
 * decisions.build — Build it on a card a turn drew, as a Decision raised for
 * the person; the client answers it with their press on the turn it starts.
 */
export const buildRoute = os
  .input(z.object({ conversationId: z.number().int().positive(), artifactId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const conversation = await getConversation({ orgId, id: input.conversationId, viewerId: userId });
    if (!conversation) {
      throw ApiError.notFound({ conversationId: input.conversationId });
    }
    try {
      return await buildDecisionFor({ orgId, userId, conversationId: input.conversationId, artifactId: input.artifactId });
    } catch (err) {
      return asApiError(err);
    }
  });
