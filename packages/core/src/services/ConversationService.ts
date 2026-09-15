/**
 * ConversationService — persistent chat threads (Phase 5).
 *
 * 1:1 port of rev-ai's server/conversations.py:
 *   - Auto-titled from the first user message.
 *   - Per-agent scoping for the chat sidebar.
 *   - `runs_json` stores `[{type:'text'|'tool', ...}]` breadcrumbs.
 *   - `toHistoryTurns` drops tool entries before replaying to the agent.
 */

import type { PageContext } from '@/services/chat/pageContext';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { conversationMessageSchema, conversationSchema } from '@/models/Schema';
import { track } from '@/services/adoption/track';
import { enqueue } from '@/services/FeedbackWorkerService';

const DEFAULT_TITLE = 'New conversation';

/**
 * How recommended actions behave in a thread (0094). Neither rung executes
 * anything — the review queue and trust rules still gate every outward step.
 */
export const CONVERSATION_AUTONOMY = ['ask', 'act-within-bounds'] as const;
export type ConversationAutonomy = typeof CONVERSATION_AUTONOMY[number];

export type MessageFeedbackRating = 'up' | 'down';

export type ConversationRun
  = | { type: 'text'; text: string }
    | { type: 'tool'; name: string; input?: Record<string, unknown>; output?: string };

/** One persisted node of the turn's activity trace (the UI's TraceNode shape). */
export type ConversationTraceNode = {
  id: string;
  parentId?: string;
  actor: { id: string; kind: string; name: string };
  kind: string;
  status: string;
  label: string;
  detail?: string;
  tool?: string;
  args?: string;
  resultDetail?: string;
  text?: string;
  result?: string;
  confidence?: number;
  citations?: Array<{ sourceType: string; title: string; link?: string; snippet?: string; actorId: string }>;
};

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export async function createConversation(opts: {
  orgId: string;
  agentSlug: string;
  initialTitle?: string;
  createdBy?: string;
  /** The record this conversation is scoped to (CRM mirror ref), when opened from a dock. */
  scopeRef?: string;
  /** Where the first turn was asked from — persisted once (R4). */
  context?: PageContext | null;
}) {
  const title = (opts.initialTitle ?? DEFAULT_TITLE).trim() || DEFAULT_TITLE;
  const [row] = await db
    .insert(conversationSchema)
    .values({
      orgId: opts.orgId,
      agentSlug: opts.agentSlug,
      title,
      createdBy: opts.createdBy ?? null,
      scopeRef: opts.scopeRef ?? null,
      contextJson: opts.context ?? null,
    })
    .returning();
  if (opts.createdBy) {
    void track({ orgId: opts.orgId, userId: opts.createdBy }, 'chat.conversation_created', {
      agentSlug: opts.agentSlug,
      resource: ['conversation', row!.id],
    });
  }
  return row!;
}

/**
 * Record where a conversation started, once: the first turn's page context.
 * A no-op when the row already has one, so a later turn from another page
 * never overwrites the origin.
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.context
 */
export async function setConversationContextIfEmpty(opts: { orgId: string; id: number; context: PageContext }): Promise<void> {
  await db
    .update(conversationSchema)
    .set({ contextJson: opts.context })
    .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.id, opts.id), isNull(conversationSchema.contextJson)));
}

export async function listConversations(opts: {
  orgId: string;
  agentSlug?: string;
  limit?: number;
}) {
  const limit = opts.limit ?? 50;
  if (opts.agentSlug) {
    return db
      .select()
      .from(conversationSchema)
      .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.agentSlug, opts.agentSlug)))
      .orderBy(desc(conversationSchema.updatedAt))
      .limit(limit);
  }
  return db
    .select()
    .from(conversationSchema)
    .where(eq(conversationSchema.orgId, opts.orgId))
    .orderBy(desc(conversationSchema.updatedAt))
    .limit(limit);
}

/**
 * The current user's most recent conversation for a record — what the dock
 * resumes on reopen. Scoped conversations are per user and never visible
 * between users (agent-chat-surface.md §8.6), so `createdBy` is part of the
 * key, not a display detail.
 * @param opts - Lookup key.
 * @param opts.orgId - Tenant.
 * @param opts.scopeRef - The record's CRM mirror ref.
 * @param opts.createdBy - The requesting user; scoped threads are theirs alone.
 */
export async function latestConversationForScope(opts: {
  orgId: string;
  scopeRef: string;
  createdBy: string;
}) {
  const [row] = await db
    .select()
    .from(conversationSchema)
    .where(and(
      eq(conversationSchema.orgId, opts.orgId),
      eq(conversationSchema.scopeRef, opts.scopeRef),
      eq(conversationSchema.createdBy, opts.createdBy),
    ))
    .orderBy(desc(conversationSchema.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function getConversation(opts: { orgId: string; id: number }) {
  const [row] = await db
    .select()
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.id, opts.id)));
  return row ?? null;
}

export async function deleteConversation(opts: { orgId: string; id: number }) {
  await db
    .delete(conversationSchema)
    .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.id, opts.id)));
}

export async function renameConversation(opts: { orgId: string; id: number; title: string }) {
  const title = opts.title.trim();
  if (!title) {
    throw new Error('title must not be empty');
  }
  const [row] = await db
    .update(conversationSchema)
    .set({ title })
    .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.id, opts.id)))
    .returning();
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export async function listMessages(opts: { orgId: string; conversationId: number }) {
  const conv = await getConversation({ orgId: opts.orgId, id: opts.conversationId });
  if (!conv) {
    return [];
  }
  return db
    .select()
    .from(conversationMessageSchema)
    .where(eq(conversationMessageSchema.conversationId, opts.conversationId))
    .orderBy(asc(conversationMessageSchema.id));
}

export async function appendMessage(opts: {
  orgId: string;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  runs?: ConversationRun[] | null;
  /** Cited source documents for an assistant turn — persisted so citations survive reload. */
  documents?: Array<{ document_id: string; semantic_identifier: string; link: string; source_type: string; blurb: string; citationIndex?: number; foundBy?: string }> | null;
  /** The person sending a `user` turn — feeds the adoption stream. */
  userId?: string;
  /** The turn's activity trace, persisted so levels 2 and 3 survive reload. */
  trace?: ConversationTraceNode[] | null;
}) {
  const conv = await getConversation({ orgId: opts.orgId, id: opts.conversationId });
  if (!conv) {
    throw new Error(`conversation ${opts.conversationId} not found`);
  }
  // Auto-title from the first user message if the title is still the default.
  const isFirstUser = conv.messageCount === 0
    && opts.role === 'user'
    && (conv.title === DEFAULT_TITLE || conv.title === '');
  const derivedTitle = isFirstUser ? deriveTitle(opts.content) : conv.title;

  const [msg] = await db
    .insert(conversationMessageSchema)
    .values({
      conversationId: opts.conversationId,
      role: opts.role,
      content: opts.content,
      runsJson: opts.runs ?? null,
      documentsJson: opts.documents && opts.documents.length > 0 ? opts.documents : null,
      traceJson: opts.trace && opts.trace.length > 0 ? opts.trace : null,
    })
    .returning();

  await db
    .update(conversationSchema)
    .set({
      title: derivedTitle,
      messageCount: sql`${conversationSchema.messageCount} + 1`,
    })
    .where(eq(conversationSchema.id, opts.conversationId));

  if (opts.role === 'user' && opts.userId) {
    void track({ orgId: opts.orgId, userId: opts.userId }, 'chat.message_sent', {
      agentSlug: conv.agentSlug,
      resource: ['conversation_message', msg!.id],
    });
  }

  return msg!;
}

/**
 * Render persisted messages as the {role, content} list the agent
 * expects in its history. Tool runs are intentionally dropped —
 * they're UI ornaments only. (See rev-ai's to_history_turns.)
 * @param messages
 */
export function toHistoryTurns(messages: Array<{
  role: string;
  content: string;
}>): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    if (!m.content.trim()) {
      continue;
    }
    if (m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function deriveTitle(content: string, maxLen = 60): string {
  const s = content.split(/\s+/).filter(Boolean).join(' ');
  if (s.length <= maxLen) {
    return s || DEFAULT_TITLE;
  }
  return `${s.slice(0, maxLen - 1)}…`;
}

/* ------------------------------------------------------------------ */
/* Autonomy (0094)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Set how recommended actions behave in one thread. The per-conversation
 * setting is the unit because a person's appetite for autonomy differs by
 * task, not by day (Manifesto §8: earned one rung at a time).
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.autonomy
 */
export async function setConversationAutonomy(opts: { orgId: string; id: number; autonomy: ConversationAutonomy }) {
  const [row] = await db
    .update(conversationSchema)
    .set({ autonomy: opts.autonomy })
    .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.id, opts.id)))
    .returning();
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Feedback (0094)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Record a thumb (and an optional note) on one assistant turn.
 *
 * The rating is a metric — it lands on the row and in the adoption stream as
 * `chat.feedback`. The note is what teaches: with text present and a rating
 * beside it, the pair is queued for the feedback classifier under source
 * `chat`, keyed on the message id so a re-submit updates rather than
 * duplicates. A cleared rating (null) wipes both columns. Never throws past
 * the row write: the queue ride-along is best-effort, like every other
 * feedback entry point.
 * @param opts
 * @param opts.orgId
 * @param opts.messageId
 * @param opts.rating - Up, down, or null to clear.
 * @param opts.note - What the person wrote, if anything.
 * @param opts.userId
 */
export async function setMessageFeedback(opts: {
  orgId: string;
  messageId: number;
  rating: MessageFeedbackRating | null;
  note?: string | null;
  userId?: string;
}) {
  const [found] = await db
    .select({
      id: conversationMessageSchema.id,
      role: conversationMessageSchema.role,
      conversationId: conversationMessageSchema.conversationId,
      agentSlug: conversationSchema.agentSlug,
    })
    .from(conversationMessageSchema)
    .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
    .where(and(eq(conversationMessageSchema.id, opts.messageId), eq(conversationSchema.orgId, opts.orgId)));
  if (!found) {
    return null;
  }
  if (found.role !== 'assistant') {
    throw new Error('feedback is recorded on assistant turns only');
  }
  const note = opts.rating ? (opts.note?.trim() || null) : null;
  const [row] = await db
    .update(conversationMessageSchema)
    .set({
      feedbackRating: opts.rating,
      feedbackNote: note,
      feedbackAt: opts.rating ? new Date() : null,
      feedbackBy: opts.rating ? (opts.userId ?? null) : null,
    })
    .where(eq(conversationMessageSchema.id, opts.messageId))
    .returning();

  if (opts.userId) {
    void track({ orgId: opts.orgId, userId: opts.userId }, 'chat.feedback', {
      agentSlug: found.agentSlug,
      resource: ['conversation_message', found.id],
      meta: { rating: opts.rating, hasNote: Boolean(note) },
    });
  }
  if (note && opts.rating) {
    try {
      await enqueue({
        orgId: opts.orgId,
        source: 'chat',
        externalId: `conversation_message:${found.id}:feedback`,
        payload: {
          text: note,
          agentSlug: found.agentSlug,
          submittedBy: opts.userId,
          polarityHint: opts.rating === 'up' ? 'reinforce' : 'correct',
        },
      });
    } catch (error) {
      console.error(`[ConversationService] could not queue feedback on message ${found.id} for learning`, error);
    }
  }
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Search (0094)                                                       */
/* ------------------------------------------------------------------ */

export type ConversationSearchHit = {
  id: number;
  title: string;
  agentSlug: string;
  updatedAt: Date;
  /** The matched message's content around the hit, when the match was in a message. */
  snippet: string | null;
};

/**
 * Find threads by title or message content — the rail's history search and
 * the command palette's conversation rows.
 *
 * Full-text (`simple` dictionary, no stemming surprises across languages)
 * plus a case-insensitive substring match so a two-letter fragment still
 * finds something. Everything-scoped threads only: a record-scoped thread is
 * one person's and belongs to its record page (agent-chat-surface.md §8.6).
 * Indexed by the GIN builds in migrations/concurrent/0094 in production.
 * @param opts
 * @param opts.orgId
 * @param opts.q - The query; blank returns the most recent threads.
 * @param opts.limit
 * @param opts.agentSlug - Restrict to one agent's threads.
 */
export async function searchConversations(opts: {
  orgId: string;
  q: string;
  limit?: number;
  agentSlug?: string;
}): Promise<ConversationSearchHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const q = opts.q.trim();
  const base = [eq(conversationSchema.orgId, opts.orgId), sql`${conversationSchema.scopeRef} IS NULL`];
  if (opts.agentSlug) {
    base.push(eq(conversationSchema.agentSlug, opts.agentSlug));
  }
  if (!q) {
    const rows = await db
      .select({ id: conversationSchema.id, title: conversationSchema.title, agentSlug: conversationSchema.agentSlug, updatedAt: conversationSchema.updatedAt })
      .from(conversationSchema)
      .where(and(...base))
      .orderBy(desc(conversationSchema.updatedAt))
      .limit(limit);
    return rows.map(r => ({ ...r, snippet: null }));
  }
  const like = `%${q.replaceAll(/[%_\\]/g, ch => `\\${ch}`)}%`;
  const tsMatch = (col: unknown) => sql`to_tsvector('simple', ${col}) @@ plainto_tsquery('simple', ${q})`;
  // Messages whose content matches — one snippet per conversation (the newest).
  const matchedMessages = await db
    .select({
      conversationId: conversationMessageSchema.conversationId,
      content: conversationMessageSchema.content,
      id: conversationMessageSchema.id,
    })
    .from(conversationMessageSchema)
    .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
    .where(and(...base, or(tsMatch(conversationMessageSchema.content), sql`${conversationMessageSchema.content} ILIKE ${like}`)))
    .orderBy(desc(conversationMessageSchema.id))
    .limit(limit * 4);
  const snippetByConv = new Map<number, string>();
  for (const m of matchedMessages) {
    if (!snippetByConv.has(m.conversationId)) {
      snippetByConv.set(m.conversationId, snippetAround(m.content, q));
    }
  }
  const convIds = [...snippetByConv.keys()];
  const rows = await db
    .select({ id: conversationSchema.id, title: conversationSchema.title, agentSlug: conversationSchema.agentSlug, updatedAt: conversationSchema.updatedAt })
    .from(conversationSchema)
    .where(and(
      ...base,
      or(
        tsMatch(conversationSchema.title),
        sql`${conversationSchema.title} ILIKE ${like}`,
        convIds.length > 0 ? inArray(conversationSchema.id, convIds) : sql`false`,
      ),
    ))
    .orderBy(desc(conversationSchema.updatedAt))
    .limit(limit);
  return rows.map(r => ({ ...r, snippet: snippetByConv.get(r.id) ?? null }));
}

/**
 * A short window of text around the first occurrence of the query.
 * @param content
 * @param q
 * @param radius
 */
function snippetAround(content: string, q: string, radius = 70): string {
  const flat = content.replaceAll(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) {
    return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat;
  }
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + q.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/**
 * The last N message rows of a thread, newest last — how the client learns
 * the persisted id of the turn it just streamed, so the feedback control
 * has a row to write to.
 * @param opts
 * @param opts.orgId
 * @param opts.conversationId
 * @param opts.limit
 */
export async function tailMessages(opts: { orgId: string; conversationId: number; limit?: number }) {
  const conv = await getConversation({ orgId: opts.orgId, id: opts.conversationId });
  if (!conv) {
    return [];
  }
  const rows = await db
    .select({ id: conversationMessageSchema.id, role: conversationMessageSchema.role, createdAt: conversationMessageSchema.createdAt })
    .from(conversationMessageSchema)
    .where(eq(conversationMessageSchema.conversationId, opts.conversationId))
    .orderBy(desc(conversationMessageSchema.id))
    .limit(Math.min(Math.max(opts.limit ?? 2, 1), 20));
  return rows.reverse();
}
