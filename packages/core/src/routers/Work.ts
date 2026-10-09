import { os } from '@orpc/server';
import { z } from 'zod';
import { getConversation } from '@/services/ConversationService';
import { stopWork, workSince } from '@/services/work/WorkService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * The long and background work behind a conversation — the chat's "N running ›"
 * chip and its panel (`services/work/WorkService.ts`): what runs in this
 * workspace now, and what finished since the conversation began.
 */
export const forConversationRoute = os
  .input(z.object({ conversationId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const conversation = await getConversation({ orgId, id: input.conversationId, viewerId: userId });
    if (!conversation) {
      throw ApiError.notFound({ conversationId: input.conversationId });
    }
    const since = (conversation as { createdAt?: Date | string }).createdAt;
    return workSince(orgId!, since ? new Date(since) : new Date(Date.now() - 60 * 60 * 1000));
  });

/** work.stop — Stop on a running job, where its run has one. */
export const stopRoute = os
  .input(z.object({ key: z.string().min(3).max(80) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return { stopped: await stopWork(orgId!, input.key) };
  });
