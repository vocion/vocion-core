import { os } from '@orpc/server';
import { z } from 'zod';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
} from '@/services/ConversationService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

export const list = os
  .input(z.object({
    agentSlug: z.string().optional(),
    limit: z.number().int().positive().max(200).default(50),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return listConversations({ orgId, agentSlug: input.agentSlug, limit: input.limit });
  });

export const get = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const conv = await getConversation({ orgId, id: input.id });
    if (!conv) {
      throw ApiError.notFound({ id: input.id });
    }
    const messages = await listMessages({ orgId, conversationId: input.id });
    return { ...conv, messages };
  });

export const create = os
  .input(z.object({
    agentSlug: z.string(),
    initialTitle: z.string().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return createConversation({
      orgId,
      agentSlug: input.agentSlug,
      initialTitle: input.initialTitle,
      createdBy: userId,
    });
  });

export const remove = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    await deleteConversation({ orgId, id: input.id });
    return { ok: true };
  });

export const rename = os
  .input(z.object({ id: z.number().int().positive(), title: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await renameConversation({ orgId, id: input.id, title: input.title });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return row;
  });

export const append = os
  .input(z.object({
    conversationId: z.number().int().positive(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return appendMessage({
      orgId,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      userId,
    });
  });
