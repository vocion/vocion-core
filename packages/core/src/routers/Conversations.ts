import { os } from '@orpc/server';
import { z } from 'zod';
import { MODEL_STRENGTHS, THINKING_EFFORTS } from '@/libs/llm/modelPrefs';
import { listArtifactsByIdsForChips, listAttachmentsByMessage } from '@/services/ArtifactService';
import { artifactChipsByMessage } from '@/services/chat/artifactChips';
import { attachmentFromArtifact } from '@/services/chat/attachments';
import {
  appendMessage,
  CONVERSATION_AUTONOMY,
  createConversation,
  deleteConversation,
  getConversation,
  latestConversationForScope,
  listConversations,
  listMessages,
  markCardRun,
  renameConversation,
  searchConversations,
  setConversationAutonomy,
  setConversationModel,
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
    const { orgId, userId } = await guardAuth();
    return listConversations({ orgId, agentSlug: input.agentSlug, limit: input.limit, viewerId: userId });
  });

export const get = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const conv = await getConversation({ orgId, id: input.id, viewerId: userId });
    if (!conv) {
      throw ApiError.notFound({ id: input.id });
    }
    const [messages, uploads, produced] = await Promise.all([
      listMessages({ orgId, conversationId: input.id }),
      listAttachmentsByMessage({ orgId, conversationId: input.id }),
      listArtifactsByIdsForChips({ orgId, conversationId: input.id }),
    ]);
    // The files a person attached ride on their message, so a reloaded
    // transcript shows the chips they saw when they sent it — and so do the
    // artifacts the agent produced, under the turn that made them
    // (`artifactChipsByMessage`): the chip is a persisted fact, not a
    // memory of the live stream.
    const chips = artifactChipsByMessage(messages, produced);
    const { answeringIn } = await import('@/libs/streams/buffer');
    return {
      ...conv,
      // Whether a turn is running for it now: a client waits for a reply only then.
      answering: answeringIn(orgId, input.id),
      messages: messages.map(m => ({
        ...m,
        attachments: (uploads.get(m.id) ?? []).map(attachmentFromArtifact),
        artifacts: chips.get(m.id) ?? [],
      })),
    };
  });

/**
 * The workspace's intake (`services/chat/intake.ts`): which record type a
 * chat card's Build it files, and which agent files it. Null when there is
 * none, and then no card offers it.
 */
export const intake = os.handler(async () => {
  const { orgId } = await guardAuth();
  const { workspaceIntake } = await import('@/services/chat/intake');
  return workspaceIntake(orgId);
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

/**
 * A person names a thread. Org-scoped (another workspace's id is not found),
 * and marks the title `person`, so the generator never replaces it.
 */
export const rename = os
  .input(z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(500) }))
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
/** How strong a model answers this thread and how much it thinks (`libs/llm/modelPrefs.ts`). */
export const setModel = os
  .input(z.object({ id: z.number().int().positive(), strength: z.enum(MODEL_STRENGTHS), effort: z.enum(THINKING_EFFORTS) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await setConversationModel({ orgId, id: input.id, strength: input.strength, effort: input.effort });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return { id: row.id, strength: row.modelStrength ?? 'balanced', effort: row.thinkingEffort ?? 'off' };
  });

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

/**
 * A person decided a card (backlog 025). The decision is written as a USER
 * turn the model can bind to — the card's id, the action, the proposal —
 * never as words the model has to parse ("approve filing it" bound to the
 * wrong record three times on 2026-09-24).
 */
export const recordCardDecision = os
  .input(z.object({
    id: z.number().int().positive(),
    cardId: z.string().min(1),
    label: z.string().min(1),
    action: z.enum(['approve', 'reject', 'defer', 'undo']),
    runId: z.number().int().optional(),
    /**
     * False: the card records the run it became and nothing is said in the
     * conversation. A setup card (`cards/SetupCard.tsx`) is the person's own
     * press on a step they were offered; the next turn reads what became of it
     * from the card's run (`withLiveCardState`), not from words written for them.
     */
    turn: z.boolean().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const conversation = await getConversation({ orgId, id: input.id, viewerId: userId });
    if (!conversation) {
      throw ApiError.notFound({ id: input.id });
    }
    if (input.turn === false) {
      const marked = input.runId !== undefined && (input.action === 'approve' || input.action === 'reject')
        ? await markCardRun({ orgId, conversationId: input.id, cardId: input.cardId, patch: { runId: input.runId, state: 'decided', decision: { action: input.action, at: new Date().toISOString(), ...(userId ? { by: userId } : {}) } } }).catch(() => false)
        : false;
      return { id: null, marked };
    }
    const verb = { approve: 'Approved', reject: 'Rejected', defer: 'Deferred', undo: 'Undid' }[input.action];
    const row = await appendMessage({
      orgId,
      conversationId: input.id,
      role: 'user',
      userId,
      content: `${verb} the card "${input.label}"${input.runId !== undefined ? ` (proposal #${input.runId})` : ''}.`,
      runs: [{ type: 'card_decision', cardId: input.cardId, action: input.action, label: input.label, ...(input.runId !== undefined ? { runId: input.runId } : {}) }],
    });
    // The card itself remembers the run it became, so a reload draws the run
    // (done, Undo) where the button was, rather than the button again.
    if (input.runId !== undefined && (input.action === 'approve' || input.action === 'reject')) {
      await markCardRun({ orgId, conversationId: input.id, cardId: input.cardId, patch: { runId: input.runId, state: 'decided', decision: { action: input.action, at: new Date().toISOString(), ...(userId ? { by: userId } : {}) } } }).catch(() => false);
    }
    return { id: row.id, marked: input.runId !== undefined };
  });
