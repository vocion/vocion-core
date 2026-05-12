/**
 * ConversationService — persistent chat threads (Phase 5).
 *
 * 1:1 port of rev-ai's server/conversations.py:
 *   - Auto-titled from the first user message.
 *   - Per-agent scoping for the chat sidebar.
 *   - `runs_json` stores `[{type:'text'|'tool', ...}]` breadcrumbs.
 *   - `toHistoryTurns` drops tool entries before replaying to the agent.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { conversationMessageSchema, conversationSchema } from '@/models/Schema';

const DEFAULT_TITLE = 'New conversation';

export type ConversationRun
  = | { type: 'text'; text: string }
    | { type: 'tool'; name: string; input?: Record<string, unknown>; output?: string };

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export async function createConversation(opts: {
  orgId: string;
  agentSlug: string;
  initialTitle?: string;
  createdBy?: string;
}) {
  const title = (opts.initialTitle ?? DEFAULT_TITLE).trim() || DEFAULT_TITLE;
  const [row] = await db
    .insert(conversationSchema)
    .values({
      orgId: opts.orgId,
      agentSlug: opts.agentSlug,
      title,
      createdBy: opts.createdBy ?? null,
    })
    .returning();
  return row!;
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
    })
    .returning();

  await db
    .update(conversationSchema)
    .set({
      title: derivedTitle,
      messageCount: sql`${conversationSchema.messageCount} + 1`,
    })
    .where(eq(conversationSchema.id, opts.conversationId));

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
