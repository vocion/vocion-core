import { os } from '@orpc/server';
import { z } from 'zod';
import { getConversation } from '@/services/ConversationService';
import { currentObjective, setObjectiveState } from '@/services/objectives/ObjectiveService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * What a conversation is in the middle of (`libs/objectives/objective.ts`):
 * the one quiet line above its dock, its steps, Stop and Resume. The next
 * visit's "Resume setting up …" is the opening hint's (`services/chat/openingHints.ts`). Scoped to the workspace AND to a
 * conversation this person can see.
 */

const conversationInput = z.object({ conversationId: z.number().int().positive() });

async function visibleConversation(conversationId: number) {
  const { orgId, userId } = await guardAuth();
  const conversation = await getConversation({ orgId, id: conversationId, viewerId: userId });
  if (!conversation) {
    throw ApiError.notFound({ conversationId });
  }
  return { orgId: orgId! };
}

/** objectives.current — the conversation's objective as the person sees it now, or null. */
export const currentRoute = os
  .input(conversationInput)
  .handler(async ({ input }) => {
    const { orgId } = await visibleConversation(input.conversationId);
    return currentObjective(orgId, input.conversationId);
  });

/** objectives.stop / objectives.resume — the strip's Stop, and the Resume that undoes it. */
export const stopRoute = os
  .input(conversationInput)
  .handler(async ({ input }) => {
    const { orgId } = await visibleConversation(input.conversationId);
    return setObjectiveState(orgId, input.conversationId, 'stopped');
  });

export const resumeRoute = os
  .input(conversationInput)
  .handler(async ({ input }) => {
    const { orgId } = await visibleConversation(input.conversationId);
    return setObjectiveState(orgId, input.conversationId, 'running');
  });
