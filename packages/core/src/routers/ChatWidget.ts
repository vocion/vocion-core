import { os } from '@orpc/server';
import { z } from 'zod';
import { getWidgetState, setRailState, setWidgetState } from '@/services/ChatWidgetStateService';
import { guardAuth } from './AuthGuards';

export const getState = os.handler(async () => {
  const { orgId, userId } = await guardAuth();
  const row = await getWidgetState({ orgId, userId });
  return row
    ? { agentSlug: row.agentSlug, conversationId: row.conversationId, updatedAt: row.updatedAt, railWidth: row.railWidth ?? null, railOpen: row.railOpen ?? null }
    : null;
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

/** The rail's width and open state, per user (0094). Fields left out are left alone. */
export const setRail = os
  .input(z.object({
    railWidth: z.number().int().min(280).max(2000).nullable().optional(),
    railOpen: z.boolean().nullable().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const row = await setRailState({ orgId, userId, railWidth: input.railWidth, railOpen: input.railOpen });
    return { railWidth: row.railWidth ?? null, railOpen: row.railOpen ?? null };
  });
