import { os } from '@orpc/server';
import { z } from 'zod';
import { getWidgetState, setWidgetState } from '@/services/ChatWidgetStateService';
import { guardAuth } from './AuthGuards';

export const getState = os.handler(async () => {
  const { orgId, userId } = await guardAuth();
  const row = await getWidgetState({ orgId, userId });
  return row ? { agentSlug: row.agentSlug, conversationId: row.conversationId, updatedAt: row.updatedAt } : null;
});

export const setState = os
  .input(z.object({
    agentSlug: z.string(),
    conversationId: z.number().int().positive().nullable(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const row = await setWidgetState({
      orgId,
      userId,
      agentSlug: input.agentSlug,
      conversationId: input.conversationId,
    });
    return { agentSlug: row.agentSlug, conversationId: row.conversationId };
  });
