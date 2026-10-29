/**
 * What the daily usage review reads — rows the platform already writes, for
 * one workspace and one window. Nothing here is new data, and nothing is
 * written: the review's judgement lives only in the report it publishes.
 *
 *   threads     conversations a person wrote in during the window, each with
 *               its messages in the window (`conversation_message`), the
 *               model calls behind its turns (`model_call`: model, effort
 *               level) and the tool calls made in it (`tool_call`)
 *   approvals   decisions people took in the window on agents' proposals and
 *               asks (`decision_alignment`), with when each was raised
 *
 * Content is loaded so code can compare a person's messages for re-asks; in
 * metadata mode it goes no further than that comparison (`UsageReviewService`).
 */

import type { ReviewDecision, ReviewMessage, ReviewModelCall, ReviewToolCall } from './facts';
import { and, asc, eq, gte, inArray, isNotNull, lt, notLike, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  actionRunSchema,
  askSchema,
  conversationMessageSchema,
  conversationSchema,
  decisionAlignmentSchema,
  modelCallSchema,
  toolCallSchema,
} from '@/models/Schema';

/** At most this many messages of one thread are read for one day. */
const MESSAGES_PER_THREAD = 80;

/** At most this many threads are read for one day; the report says when there were more. */
export const THREADS_READ_CAP = 400;

export type ReviewThread = {
  id: number;
  agentSlug: string;
  title: string;
  /** A thread opened from a record page belongs to one person; it is read as metadata only. */
  scoped: boolean;
  createdBy: string | null;
  surface: string;
  messages: ReviewMessage[];
  calls: ReviewModelCall[];
  tools: ReviewToolCall[];
  decisions: ReviewDecision[];
};

/** A decided proposal or ask not tied to a thread read today. */
export type ReviewApproval = ReviewDecision & {
  /** What was proposed or asked — content, used only in content mode. */
  title: string;
  /** Why the agent recommended what it did, or the person's note — content. */
  reason: string | null;
  conversationId: number | null;
};

export type UsageWindow = { since: Date; until: Date };

/**
 * Whether anyone used the workspace in the window: a person's message, or a
 * decision on an agent's proposal or ask. The cheap read the daily check
 * makes before anything else runs — no model, two indexed counts.
 * @param orgId - The workspace.
 * @param window - The window.
 */
export async function hadActivity(orgId: string, window: UsageWindow): Promise<boolean> {
  const [msg] = await db
    .select({ id: conversationMessageSchema.id })
    .from(conversationMessageSchema)
    .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
    .where(and(
      eq(conversationSchema.orgId, orgId),
      eq(conversationMessageSchema.role, 'user'),
      gte(conversationMessageSchema.createdAt, window.since),
      lt(conversationMessageSchema.createdAt, window.until),
    ))
    .limit(1);
  if (msg) {
    return true;
  }
  const [decision] = await db
    .select({ id: decisionAlignmentSchema.id })
    .from(decisionAlignmentSchema)
    .where(and(eq(decisionAlignmentSchema.orgId, orgId), gte(decisionAlignmentSchema.decidedAt, window.since), lt(decisionAlignmentSchema.decidedAt, window.until)))
    .limit(1);
  return Boolean(decision);
}

/**
 * The threads a person wrote in during the window, with everything the facts need.
 * @param orgId - The workspace.
 * @param window - The window.
 */
export async function readThreads(orgId: string, window: UsageWindow): Promise<{ threads: ReviewThread[]; total: number }> {
  // A person's thread: someone wrote in it. A run's own conversation is
  // written by `automation:`/`agent:` principals and is not a person's chat.
  const active = await db
    .select({ id: conversationSchema.id })
    .from(conversationSchema)
    .where(and(
      eq(conversationSchema.orgId, orgId),
      isNotNull(conversationSchema.createdBy),
      notLike(conversationSchema.createdBy, '%:%'),
      sql`exists (select 1 from ${conversationMessageSchema} m where m.conversation_id = ${conversationSchema.id} and m.role = 'user' and m.created_at >= ${window.since} and m.created_at < ${window.until})`,
    ))
    .orderBy(asc(conversationSchema.id));
  const total = active.length;
  const ids = active.slice(0, THREADS_READ_CAP).map(r => r.id);
  if (ids.length === 0) {
    return { threads: [], total };
  }
  const [convs, messages, calls, tools] = await Promise.all([
    db.select({ id: conversationSchema.id, agentSlug: conversationSchema.agentSlug, title: conversationSchema.title, scopeRef: conversationSchema.scopeRef, createdBy: conversationSchema.createdBy, surface: conversationSchema.surface })
      .from(conversationSchema)
      .where(inArray(conversationSchema.id, ids)),
    db.select({
      id: conversationMessageSchema.id,
      conversationId: conversationMessageSchema.conversationId,
      role: conversationMessageSchema.role,
      content: conversationMessageSchema.content,
      createdAt: conversationMessageSchema.createdAt,
      status: conversationMessageSchema.status,
      statusReason: conversationMessageSchema.statusReason,
      microCents: conversationMessageSchema.microCents,
      feedbackRating: conversationMessageSchema.feedbackRating,
      agentSlug: conversationMessageSchema.agentSlug,
      turn: conversationMessageSchema.turnJson,
    })
      .from(conversationMessageSchema)
      .where(and(inArray(conversationMessageSchema.conversationId, ids), gte(conversationMessageSchema.createdAt, window.since), lt(conversationMessageSchema.createdAt, window.until)))
      .orderBy(asc(conversationMessageSchema.createdAt), asc(conversationMessageSchema.id)),
    db.select({ conversationId: modelCallSchema.conversationId, messageId: modelCallSchema.messageId, model: modelCallSchema.model, effortLevel: modelCallSchema.effortLevel, createdAt: modelCallSchema.createdAt })
      .from(modelCallSchema)
      .where(and(eq(modelCallSchema.orgId, orgId), inArray(modelCallSchema.conversationId, ids), gte(modelCallSchema.createdAt, window.since), lt(modelCallSchema.createdAt, window.until)))
      .orderBy(asc(modelCallSchema.createdAt)),
    db.select({ conversationId: toolCallSchema.conversationId, tool: toolCallSchema.tool, error: toolCallSchema.error, durationMs: toolCallSchema.durationMs, createdAt: toolCallSchema.createdAt })
      .from(toolCallSchema)
      .where(and(eq(toolCallSchema.orgId, orgId), inArray(toolCallSchema.conversationId, ids), gte(toolCallSchema.createdAt, window.since), lt(toolCallSchema.createdAt, window.until)))
      .orderBy(asc(toolCallSchema.createdAt)),
  ]);
  const threads = new Map<number, ReviewThread>(convs.map(c => [c.id, {
    id: c.id,
    agentSlug: c.agentSlug,
    title: c.title,
    scoped: c.scopeRef !== null,
    createdBy: c.createdBy,
    surface: c.surface,
    messages: [],
    calls: [],
    tools: [],
    decisions: [],
  }]));
  for (const m of messages) {
    const t = threads.get(m.conversationId);
    if (!t || t.messages.length >= MESSAGES_PER_THREAD) {
      continue;
    }
    const started = m.turn?.startedAt ? new Date(m.turn.startedAt) : null;
    const finished = m.turn?.finishedAt ? new Date(m.turn.finishedAt) : null;
    t.messages.push({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      status: m.status,
      statusReason: m.statusReason,
      microCents: m.microCents,
      feedbackRating: m.feedbackRating,
      agentSlug: m.agentSlug,
      startedAt: started && !Number.isNaN(started.getTime()) ? started : null,
      finishedAt: finished && !Number.isNaN(finished.getTime()) ? finished : null,
    });
  }
  for (const c of calls) {
    threads.get(c.conversationId ?? -1)?.calls.push({ messageId: c.messageId, model: c.model, effortLevel: c.effortLevel, createdAt: c.createdAt });
  }
  for (const t of tools) {
    threads.get(t.conversationId ?? -1)?.tools.push({ tool: t.tool, failed: t.error !== null, durationMs: t.durationMs, createdAt: t.createdAt });
  }
  return { threads: [...threads.values()].filter(t => t.messages.length > 0), total };
}

/**
 * The decisions people took in the window on agents' proposals and asks.
 * @param orgId - The workspace.
 * @param window - The window.
 */
export async function readApprovals(orgId: string, window: UsageWindow): Promise<ReviewApproval[]> {
  const rows = await db
    .select({
      subjectKind: decisionAlignmentSchema.subjectKind,
      subjectKey: decisionAlignmentSchema.subjectKey,
      subjectId: decisionAlignmentSchema.subjectId,
      agentSlug: decisionAlignmentSchema.agentSlug,
      decision: decisionAlignmentSchema.decision,
      recommended: decisionAlignmentSchema.recommended,
      agreed: decisionAlignmentSchema.agreed,
      hasNote: decisionAlignmentSchema.hasNote,
      decidedAt: decisionAlignmentSchema.decidedAt,
    })
    .from(decisionAlignmentSchema)
    .where(and(eq(decisionAlignmentSchema.orgId, orgId), gte(decisionAlignmentSchema.decidedAt, window.since), lt(decisionAlignmentSchema.decidedAt, window.until)))
    .orderBy(asc(decisionAlignmentSchema.decidedAt))
    .limit(THREADS_READ_CAP);
  const actionIds = rows.filter(r => r.subjectKind === 'action').map(r => r.subjectId);
  const askIds = rows.filter(r => r.subjectKind === 'ask').map(r => r.subjectId);
  const [actions, asks] = await Promise.all([
    actionIds.length === 0
      ? []
      : db.select({ id: actionRunSchema.id, createdAt: actionRunSchema.createdAt, proposal: actionRunSchema.proposal, actionId: actionRunSchema.actionId })
          .from(actionRunSchema)
          .where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, actionIds))),
    askIds.length === 0
      ? []
      : db.select({ id: askSchema.id, createdAt: askSchema.createdAt, title: askSchema.title, note: askSchema.decisionNote, conversationId: askSchema.conversationId })
          .from(askSchema)
          .where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, askIds))),
  ]);
  const action = new Map(actions.map(a => [a.id, a]));
  const ask = new Map(asks.map(a => [a.id, a]));
  return rows.map((r) => {
    const a = r.subjectKind === 'action' ? action.get(r.subjectId) : undefined;
    const k = r.subjectKind === 'ask' ? ask.get(r.subjectId) : undefined;
    const proposal = (a?.proposal ?? {}) as { suggestedDecisionReason?: string; rationale?: string };
    return {
      ...r,
      proposedAt: a?.createdAt ?? k?.createdAt ?? null,
      title: k?.title ?? a?.actionId ?? r.subjectKey,
      reason: k?.note ?? proposal.suggestedDecisionReason ?? proposal.rationale ?? null,
      conversationId: k?.conversationId ?? null,
    };
  });
}
