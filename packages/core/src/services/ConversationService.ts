/**
 * ConversationService — persistent chat threads (Phase 5).
 *
 * 1:1 port of rev-ai's server/conversations.py:
 *   - Auto-titled from the first user message.
 *   - Per-agent scoping for the chat sidebar.
 *   - `runs_json` stores `[{type:'text'|'tool', ...}]` breadcrumbs.
 *   - `toHistoryTurns` drops tool entries before replaying to the agent.
 */

import type { HistoryTurn } from '@/services/chat/historyTools';
import type { PageContext } from '@/services/chat/pageContext';
import type { TurnStatus } from '@/services/chat/turnStatus';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { formatDateTime } from '@/libs/time/zone';
import { conversationMessageSchema, conversationSchema } from '@/models/Schema';
import { track } from '@/services/adoption/track';
import { isDroppedFromHistory, isTurnStatus } from '@/services/chat/turnStatus';
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
    /**
     * One tool step. `state` is persisted so a RELOADED transcript can still
     * tell a step that worked from one that failed — a hydrate that assumed
     * `done` for every stored step turned every failure into a success the
     * moment the page refreshed.
     */
    | { type: 'tool'; name: string; input?: Record<string, unknown>; output?: string; state?: 'pending' | 'done' | 'error' }
    /**
     * A card the turn put up (a `recommended_action`): what it offered and
     * the payload it carried. Persisted so the NEXT turn can be told which
     * card it is being asked to approve — "approve filing it" bound to a
     * lookup result three times on 2026-09-24 because the card lived only
     * in the browser.
     */
    | { type: 'card'; id?: string; kind?: string; label: string; actionId: string; input?: Record<string, unknown>; runId?: number; state?: string }
    | { type: 'card_decision'; cardId: string; action: string; runId?: number; label?: string };

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
  /** Both tenses of the step's name, when a labeler supplied them. */
  labels?: { running: string; done: string };
  confidence?: number;
  citations?: Array<{ sourceType: string; title: string; link?: string; snippet?: string; actorId: string }>;
  /** How many text runs had started when this step began — its place between the passages. */
  anchor?: number;
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

/**
 * The status to actually store, guarding the column against a word no reader knows.
 *
 * Every agent turn written from here on carries a status, so that reading one
 * is the same question every time instead of "is this NULL because the turn
 * finished, or because whoever wrote it forgot?". A caller that says nothing
 * means the ordinary case, `complete` — the statuses that matter are the ones
 * somebody chose deliberately.
 *
 * A person's own message gets NULL, because status describes how an agent's
 * turn ended and a person's message does not end: they pressed enter and it
 * was said. NULL also remains on every row written before this vocabulary
 * existed, and every reader treats it as an ordinary finished turn, which is
 * what those rows almost always were.
 *
 * A word outside the vocabulary is stored as `complete` with a warning naming
 * it, because a typo would otherwise be wrong quietly and forever — and the
 * row is still written either way, since the person's answer matters more than
 * the label on it.
 * @param status - What the caller asked for.
 * @param role - Who the message is from; only an assistant turn takes a status.
 * @returns The status to write into the column.
 */
function storableStatus(status: TurnStatus | null | undefined, role: 'user' | 'assistant'): TurnStatus | null {
  if (role === 'user') {
    return null;
  }
  if (status === null || status === undefined) {
    return 'complete';
  }
  if (!isTurnStatus(status)) {
    console.warn('appendMessage: unknown turn status, storing it as complete', { status });
    return 'complete';
  }
  return status;
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
  /** How the workspace chose this message's agent, when nobody named one (`services/agents/router.ts`). */
  routing?: import('@/services/agents/router').RoutingDecision | null;
  /**
   * How an assistant turn ended (`services/chat/turnStatus.ts`). Omitted means
   * `complete`; a `user` message is stored without one whatever is passed.
   * What it changes: the notice under the turn, and whether the text is
   * replayed to the model on the next turn.
   */
  status?: TurnStatus | null;
  /** Why it ended that way, in the runtime's own words. Only meaningful beside a `status` that owes an explanation. */
  statusReason?: string | null;
  /** Which agent spoke an assistant turn — the slug the runtime ran, so a reloaded transcript attributes the turn truthfully (backlog 009). */
  agentSlug?: string | null;
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
      routingJson: opts.routing ?? null,
      status: storableStatus(opts.status, opts.role),
      statusReason: opts.statusReason ?? null,
      agentSlug: opts.role === 'assistant' ? opts.agentSlug ?? null : null,
    })
    .returning();

  await db
    .update(conversationSchema)
    .set({
      title: derivedTitle,
      messageCount: sql`${conversationSchema.messageCount} + 1`,
      // A thread picked up again is open again; the idle sweep ends it anew.
      endedAt: null,
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

/** A person's turn is re-stamped with its time after this long a silence. */
const HISTORY_STAMP_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * Render persisted messages as the turns the agent replays. An agent turn
 * carries its `runs_json` so the loop can replay the tool calls and cards it
 * made as calls, not as prose (`services/chat/historyTools.ts`).
 * Turns that ended badly are dropped too — see `isDroppedFromHistory`.
 * @param messages - Persisted rows, oldest first; `createdAt` enables the sent-time stamp.
 * @param opts - Options.
 * @param opts.timeZone - The person's zone for the stamps; absent, no stamps.
 */
export function toHistoryTurns(messages: Array<{
  id?: string | number;
  role: string;
  content: string;
  createdAt?: Date | string | null;
  status?: string | null;
  /** The agent turn's ledger (`runs_json`): replayed as the tool calls it was, see `historyTools.ts`. */
  runsJson?: unknown;
}>, opts: { timeZone?: string } = {}): HistoryTurn[] {
  const out: HistoryTurn[] = [];
  // When a zone is given, a person's turn is stamped with when it was sent —
  // the first one always, later ones after a gap of six hours or more — so
  // the model can tell yesterday's question from one asked a minute ago.
  // History used to reach the model as bare role and content (2026-09-18).
  let previous: Date | null = null;
  for (const m of messages) {
    if (!m.content.trim()) {
      continue;
    }
    // Some endings are not replayed. A turn that died part-way stops
    // mid-thought — sometimes mid-word — and handing that back as something
    // the agent said lets a half-formed statement harden into fact over the
    // rest of the thread (issue #114); a turn that was refused or never ran
    // has nothing to hand back. A turn the PERSON stopped is replayed: they
    // read it and decided that was enough. The person still sees every one of
    // these rows; the model starts the next turn without some of them.
    if (isDroppedFromHistory(m.status)) {
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') {
      continue;
    }
    let content = m.content;
    const at = m.createdAt ? new Date(m.createdAt) : null;
    const dated = at !== null && !Number.isNaN(at.getTime());
    if (m.role === 'user' && dated && opts.timeZone) {
      const gapMs = previous ? at.getTime() - previous.getTime() : Number.POSITIVE_INFINITY;
      if (gapMs >= HISTORY_STAMP_GAP_MS) {
        content = `[sent ${formatDateTime(at, opts.timeZone)}] ${content}`;
      }
    }
    if (dated) {
      previous = at;
    }
    out.push({ role: m.role, content, ...(m.id ? { id: m.id } : {}), ...(m.role === 'assistant' && m.runsJson ? { runs: m.runsJson } : {}) });
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

/**
 * Set how strong a model answers this thread and how much it thinks
 * (`libs/llm/modelPrefs.ts`). Per conversation, like autonomy: appetite
 * differs by task, not by day.
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.strength
 * @param opts.effort
 */
export async function setConversationModel(opts: { orgId: string; id: number; strength: 'fast' | 'balanced' | 'deep'; effort: 'off' | 'low' | 'medium' | 'high' }) {
  const [row] = await db
    .update(conversationSchema)
    .set({ modelStrength: opts.strength, thinkingEffort: opts.effort })
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
  /** Where the thread began: 'app' | 'slack' | 'email'. */
  surface: string;
  /** Turns so far — how a list says "a question" apart from "a working session". */
  messageCount: number;
  /** The record this thread is about, when it was opened from one. */
  scopeRef: string | null;
  /** The matched message's content around the hit, when the match was in a message. */
  snippet: string | null;
};

/**
 * Find threads by title or message content — the rail's history search and
 * the command palette's conversation rows.
 *
 * Full-text (`simple` dictionary, no stemming surprises across languages)
 * plus a case-insensitive substring match so a two-letter fragment still
 * finds something. Everything-scoped threads by default: a record-scoped
 * thread is one person's and belongs to its record page
 * (agent-chat-surface.md §8.6). `includeScopedFor` widens that to the
 * caller's OWN scoped threads — what /dashboard/conversations shows, because
 * a person looking for "all my conversations" means the one about the deal
 * too, and it is still only ever their own. Never pass another user's id.
 * Indexed by the GIN builds in migrations/concurrent/0094 in production.
 * @param opts
 * @param opts.orgId
 * @param opts.q - The query; blank returns the most recent threads.
 * @param opts.limit
 * @param opts.agentSlug - Restrict to one agent's threads.
 * @param opts.includeScopedFor - Also include record-scoped threads this user created.
 */
export async function searchConversations(opts: {
  orgId: string;
  q: string;
  limit?: number;
  agentSlug?: string;
  includeScopedFor?: string;
}): Promise<ConversationSearchHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const q = opts.q.trim();
  const visible = opts.includeScopedFor
    ? or(sql`${conversationSchema.scopeRef} IS NULL`, eq(conversationSchema.createdBy, opts.includeScopedFor))
    : sql`${conversationSchema.scopeRef} IS NULL`;
  const base = [eq(conversationSchema.orgId, opts.orgId), visible];
  if (opts.agentSlug) {
    base.push(eq(conversationSchema.agentSlug, opts.agentSlug));
  }
  if (!q) {
    const rows = await db
      .select({
        id: conversationSchema.id,
        title: conversationSchema.title,
        agentSlug: conversationSchema.agentSlug,
        updatedAt: conversationSchema.updatedAt,
        surface: conversationSchema.surface,
        messageCount: conversationSchema.messageCount,
        scopeRef: conversationSchema.scopeRef,
      })
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
    .select({
      id: conversationSchema.id,
      title: conversationSchema.title,
      agentSlug: conversationSchema.agentSlug,
      updatedAt: conversationSchema.updatedAt,
      surface: conversationSchema.surface,
      messageCount: conversationSchema.messageCount,
      scopeRef: conversationSchema.scopeRef,
    })
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
