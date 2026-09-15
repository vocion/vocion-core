import { os } from '@orpc/server';
import { z } from 'zod';
import {
  appendMessage,
  CONVERSATION_AUTONOMY,
  createConversation,
  deleteConversation,
  getConversation,
  latestConversationForScope,
  listConversations,
  listMessages,
  renameConversation,
  searchConversations,
  setConversationAutonomy,
  setMessageFeedback,
  tailMessages,
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
    scopeRef: z.string().max(120).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return createConversation({
      orgId,
      agentSlug: input.agentSlug,
      initialTitle: input.initialTitle,
      createdBy: userId,
      scopeRef: input.scopeRef,
    });
  });

/**
 * The current user's most recent conversation for a record — the dock's
 * resume target. Per user by design: another member's conversations about
 * the same record are never returned (agent-chat-surface.md §8.6).
 */
export const latestForScope = os
  .input(z.object({ scopeRef: z.string().min(1).max(120) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    if (!userId) {
      return null;
    }
    return latestConversationForScope({ orgId, scopeRef: input.scopeRef, createdBy: userId });
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

/**
 * Threads matching a query, by title or message content (0094) — the rail's
 * history search and the command palette's conversation rows. Blank query =
 * the most recent threads.
 */
export const search = os
  .input(z.object({
    q: z.string().max(200).default(''),
    limit: z.number().int().positive().max(100).default(20),
    agentSlug: z.string().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return searchConversations({ orgId, q: input.q, limit: input.limit, agentSlug: input.agentSlug });
  });

/** The last N message rows (id + role) of a thread, oldest first. */
export const tail = os
  .input(z.object({ id: z.number().int().positive(), limit: z.number().int().positive().max(20).default(2) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return tailMessages({ orgId, conversationId: input.id, limit: input.limit });
  });

/** A thumb (and optional note) on one assistant turn (0094). Null rating clears it. */
export const feedback = os
  .input(z.object({
    messageId: z.number().int().positive(),
    rating: z.enum(['up', 'down']).nullable(),
    note: z.string().max(4000).nullable().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const row = await setMessageFeedback({ orgId, messageId: input.messageId, rating: input.rating, note: input.note ?? null, userId });
    if (!row) {
      throw ApiError.notFound({ messageId: input.messageId });
    }
    return { id: row.id, feedbackRating: row.feedbackRating, feedbackNote: row.feedbackNote, feedbackAt: row.feedbackAt };
  });

/** How recommended actions behave in one thread (0094). */
export const setAutonomy = os
  .input(z.object({ id: z.number().int().positive(), autonomy: z.enum(CONVERSATION_AUTONOMY) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await setConversationAutonomy({ orgId, id: input.id, autonomy: input.autonomy });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return { id: row.id, autonomy: row.autonomy };
  });
