import { os } from '@orpc/server';
import { z } from 'zod';
import { getConversation } from '@/services/ConversationService';
import { openDecisions } from '@/services/decisions/DecisionService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * decisions.open — what a conversation is waiting on, oldest first: the first
 * is docked above its composer, the rest are the queue behind it ("1 of 3").
 * Read when a thread is opened or resumed; a turn that raises or answers one
 * says so on the stream as a `decision` event. Scoped to the workspace AND to
 * a conversation this person can see — another thread's Decisions are not
 * listed here.
 *
 * Answering is not a call here: an answer goes to the agent that asked, as a
 * typed `decision_answer` on the turn it starts (`/rpc/agent/stream`).
 */
export const openRoute = os
  .input(z.object({ conversationId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const conversation = await getConversation({ orgId, id: input.conversationId, viewerId: userId });
    if (!conversation) {
      throw ApiError.notFound({ conversationId: input.conversationId });
    }
    return openDecisions(orgId, input.conversationId);
  });
