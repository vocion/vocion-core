/**
 * THE TURN LEDGER: a chat turn is a record from its first token (backlog 056).
 *
 * Before this, the assistant row was written in the stream route's `finally`,
 * so a restart mid-answer left nothing: the person's question with no reply,
 * and the client's resume answered 404 ("the app restarted while it was
 * answering. Send your message again"). Now the row is written when the turn
 * BEGINS — `status: running`, with the stream id, the process answering it,
 * the attempt, and the request needed to answer it again — and finished in
 * place when the turn ends. A row still `running` from a process that is gone
 * is what `turnRecovery.ts` picks up on boot.
 *
 * Rules:
 *   - `beginTurn` never throws: a ledger that cannot be written must not stop
 *     the answer. The route then falls back to writing the row at the end.
 *   - Progress (the tool steps so far) is recorded as they finish, so a re-run
 *     knows what already happened and does nothing with a side effect twice.
 *   - A running row carries no text the model should see: `toHistoryTurns`
 *     drops `running` and `interrupted` (turnStatus.ts).
 */

import type { HistoryTurn } from '@/services/chat/historyTools';
import type { TurnStatus } from '@/services/chat/turnStatus';
import type { ConversationRun, ConversationTraceNode } from '@/services/ConversationService';
import { hostname } from 'node:os';
import process from 'node:process';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { conversationMessageSchema, conversationSchema } from '@/models/Schema';

/** What the route knew when it started the turn, enough to run it again. */
export type TurnRequest = {
  /** The person's words, as typed. */
  message: string;
  /** The words the model was given: the message with its page context and grounding. */
  messageForModel: string;
  agentSlug: string;
  userId: string;
  allowedSourceSlugs: string[];
  timeZone: string;
  deliverable?: unknown;
  attachmentIds: number[];
  modelPrefs?: unknown;
  pageContext?: unknown;
  autonomy?: string;
  /** The history handed to the first attempt, when the thread had none in the database (a client-held history). */
  clientHistory?: HistoryTurn[];
};

export type TurnJson = {
  /** The SSE stream id the client holds; a re-run streams under the same id. */
  streamId: string;
  /** The process answering (`processInstanceId`); another process finding it running knows it is orphaned. */
  processId: string;
  startedAt: string;
  /** 1 for the first answer; 2 for the one re-run after a restart. */
  attempt: number;
  /** The person's message this turn answers; the history a re-run reads stops before it. */
  userMessageId: number | null;
  request: TurnRequest;
  interruptedAt?: string;
  resumedAt?: string;
  resumedBy?: string;
  finishedAt?: string;
};

const BOOTED_AT = Date.now();

/** This process, as the ledger names it: host, pid and boot time, so a restarted container is a new one. */
export function processInstanceId(): string {
  return `${hostname()}:${process.pid}:${BOOTED_AT}`;
}

export type TurnRow = {
  id: number;
  conversationId: number;
  orgId: string;
  agentSlug: string | null;
  status: string | null;
  content: string;
  runs: ConversationRun[];
  turn: TurnJson;
};

/**
 * Write the assistant turn as it begins. Never throws: null means the ledger
 * could not be written and the caller writes the row at the end as before.
 * @param input - The turn.
 * @param input.orgId - The workspace.
 * @param input.conversationId - The thread.
 * @param input.agentSlug - Who answers.
 * @param input.turn - Its stream, the person's message and the request.
 */
export async function beginTurn(input: { orgId: string; conversationId: number; agentSlug: string; turn: Pick<TurnJson, 'streamId' | 'userMessageId' | 'request'> }): Promise<{ id: number } | null> {
  try {
    const turn: TurnJson = { ...input.turn, processId: processInstanceId(), startedAt: new Date().toISOString(), attempt: 1 };
    const [row] = await db
      .insert(conversationMessageSchema)
      .values({ conversationId: input.conversationId, role: 'assistant', content: '', status: 'running', agentSlug: input.agentSlug, turnJson: turn })
      .returning({ id: conversationMessageSchema.id });
    await db
      .update(conversationSchema)
      .set({ messageCount: sql`${conversationSchema.messageCount} + 1`, endedAt: null })
      .where(eq(conversationSchema.id, input.conversationId));
    return row ? { id: row.id } : null;
  } catch (err) {
    logger.warn('turn ledger: the turn could not be written as it began', { conversationId: input.conversationId, error: (err as Error).message });
    return null;
  }
}

/**
 * The steps so far, written as they finish, so a re-run after a restart knows
 * what already happened. Never throws.
 * @param id - The turn row.
 * @param runs - The turn's runs so far.
 */
export async function recordTurnProgress(id: number, runs: ConversationRun[]): Promise<void> {
  try {
    const [stored] = await db.select({ runs: conversationMessageSchema.runsJson }).from(conversationMessageSchema).where(eq(conversationMessageSchema.id, id)).limit(1);
    await db.update(conversationMessageSchema).set({ runsJson: keepCardDecisions(runs, stored?.runs ?? null) }).where(eq(conversationMessageSchema.id, id));
  } catch (err) {
    logger.warn('turn ledger: progress not recorded', { id, error: (err as Error).message });
  }
}

/**
 * Finish the turn in place: its text, steps, documents, trace, ending and cost.
 * @param input - What the turn ended with.
 * @param input.id - The turn row.
 * @param input.conversationId - The thread (its cost sum).
 * @param input.content - The answer.
 * @param input.runs - The steps.
 * @param input.documents - Cited documents.
 * @param input.trace - The activity trace.
 * @param input.status - How it ended.
 * @param input.statusReason - Why, when the ending owes one.
 * @param input.agentSlug - Who answered.
 * @param input.cost - What it cost.
 */
export async function finishTurn(input: {
  id: number;
  conversationId: number;
  content: string;
  runs?: ConversationRun[] | null;
  documents?: unknown[] | null;
  trace?: ConversationTraceNode[] | null;
  status: TurnStatus;
  statusReason?: string | null;
  agentSlug?: string | null;
  cost?: { tokens: number; microCents: number } | null;
}): Promise<{ id: number }> {
  // A card the person decided while the turn was still being written down
  // keeps what it became: the runs written here are the collector's, which
  // never saw the press (`keepCardDecisions`).
  const [stored] = await db
    .select({ runs: conversationMessageSchema.runsJson })
    .from(conversationMessageSchema)
    .where(eq(conversationMessageSchema.id, input.id))
    .limit(1);
  const [row] = await db
    .update(conversationMessageSchema)
    .set({
      content: input.content,
      runsJson: keepCardDecisions(input.runs ?? null, stored?.runs ?? null),
      documentsJson: (input.documents && input.documents.length > 0 ? input.documents : null) as never,
      traceJson: input.trace && input.trace.length > 0 ? input.trace : null,
      status: input.status,
      statusReason: input.statusReason ?? null,
      ...(input.agentSlug ? { agentSlug: input.agentSlug } : {}),
      ...(input.cost ? { tokens: input.cost.tokens, microCents: input.cost.microCents } : {}),
      turnJson: sql`coalesce(${conversationMessageSchema.turnJson}, '{}'::jsonb) || ${JSON.stringify({ finishedAt: new Date().toISOString() })}::jsonb`,
    })
    .where(eq(conversationMessageSchema.id, input.id))
    .returning({ id: conversationMessageSchema.id });
  if (input.cost && input.cost.microCents > 0) {
    await db
      .update(conversationSchema)
      .set({
        tokens: sql`coalesce(${conversationSchema.tokens}, 0) + ${input.cost.tokens}`,
        microCents: sql`coalesce(${conversationSchema.microCents}, 0) + ${input.cost.microCents}`,
      })
      .where(eq(conversationSchema.id, input.conversationId));
  }
  return { id: row?.id ?? input.id };
}

/**
 * The runs a finished turn writes, with every card the person already decided
 * kept as decided.
 *
 * A card is on screen the moment it is surfaced, and its row is written while
 * the turn is still running; the person can press it then. The press is
 * written onto the stored card (`markCardRun`), and the turn's own copy of its
 * runs — written when the turn finishes — has never heard of it. Writing that
 * copy over the row put the button back on a step that had already run (a
 * setup card pressed before a slow turn finished, 2026-10-08).
 * @param next - The runs the finishing turn holds.
 * @param stored - The runs on the row now.
 */
export function keepCardDecisions(next: ConversationRun[] | null, stored: ConversationRun[] | null): ConversationRun[] | null {
  if (!next || !stored) {
    return next;
  }
  const decided = new Map<string, Extract<ConversationRun, { type: 'card' }>>();
  for (const run of stored) {
    if (run.type === 'card' && run.id && (run.runId !== undefined || run.decision || (run.state && run.state !== 'proposed'))) {
      decided.set(run.id, run);
    }
  }
  if (decided.size === 0) {
    return next;
  }
  return next.map((run) => {
    const was = run.type === 'card' && run.id ? decided.get(run.id) : undefined;
    if (!was || run.type !== 'card' || (run.runId !== undefined && run.state && run.state !== 'proposed')) {
      return run;
    }
    return {
      ...run,
      ...(was.runId !== undefined ? { runId: was.runId } : {}),
      ...(was.state ? { state: was.state } : {}),
      ...(was.decision ? { decision: was.decision } : {}),
      ...(was.lastAttempt ? { lastAttempt: was.lastAttempt } : {}),
    };
  });
}

/**
 * Replace the turn's ledger entry (a re-run's attempt, when it was interrupted and by whom).
 * @param id - The turn row.
 * @param turn - The entry as it now stands.
 */
export async function writeTurn(id: number, turn: TurnJson): Promise<void> {
  await db.update(conversationMessageSchema).set({ turnJson: turn }).where(eq(conversationMessageSchema.id, id));
}

function rowOf(r: { id: number; conversationId: number; orgId: string; agentSlug: string | null; status: string | null; content: string; runsJson: unknown; turnJson: unknown }): TurnRow | null {
  const turn = r.turnJson as TurnJson | null;
  if (!turn || typeof turn.streamId !== 'string' || !turn.request) {
    return null;
  }
  return { id: r.id, conversationId: r.conversationId, orgId: r.orgId, agentSlug: r.agentSlug, status: r.status, content: r.content, runs: Array.isArray(r.runsJson) ? r.runsJson as ConversationRun[] : [], turn };
}

/**
 * Turns still `running` that belong to another process: the ones a restart
 * left behind, for this process to finish.
 * @param processId - This process (`processInstanceId`).
 */
export async function runningTurnsOfOtherProcesses(processId: string): Promise<TurnRow[]> {
  const rows = await db
    .select({
      id: conversationMessageSchema.id,
      conversationId: conversationMessageSchema.conversationId,
      orgId: conversationSchema.orgId,
      agentSlug: conversationMessageSchema.agentSlug,
      status: conversationMessageSchema.status,
      content: conversationMessageSchema.content,
      runsJson: conversationMessageSchema.runsJson,
      turnJson: conversationMessageSchema.turnJson,
    })
    .from(conversationMessageSchema)
    .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
    .where(and(eq(conversationMessageSchema.role, 'assistant'), eq(conversationMessageSchema.status, 'running'), ne(sql`${conversationMessageSchema.turnJson}->>'processId'`, processId)))
    .orderBy(conversationMessageSchema.id);
  return rows.map(rowOf).filter((r): r is TurnRow => r !== null);
}

/**
 * The turn a stream id names, when it is this person's.
 * @param orgId - The workspace.
 * @param userId - The person who holds the stream id.
 * @param streamId - The id.
 */
export async function turnByStreamId(orgId: string, userId: string, streamId: string): Promise<TurnRow | null> {
  const rows = await db
    .select({
      id: conversationMessageSchema.id,
      conversationId: conversationMessageSchema.conversationId,
      orgId: conversationSchema.orgId,
      agentSlug: conversationMessageSchema.agentSlug,
      status: conversationMessageSchema.status,
      content: conversationMessageSchema.content,
      runsJson: conversationMessageSchema.runsJson,
      turnJson: conversationMessageSchema.turnJson,
    })
    .from(conversationMessageSchema)
    .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
    .where(and(eq(conversationSchema.orgId, orgId), eq(sql`${conversationMessageSchema.turnJson}->>'streamId'`, streamId), eq(sql`${conversationMessageSchema.turnJson}->'request'->>'userId'`, userId)))
    .limit(1);
  const r = rows[0];
  return r ? rowOf(r) : null;
}
