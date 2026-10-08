/**
 * DecisionService — raise a Decision where the person is, and take their
 * answer as a typed event.
 *
 * A Decision is the ask (`AskService`), read as one shape
 * (`libs/decisions/decision.ts`). This service is the seam the chat needs on
 * top of it:
 *
 *   - `raiseDecision` puts one in a conversation, docked above its composer,
 *     owned by the person in it and asked by the agent that raised it.
 *   - `openDecisions` is what a conversation is waiting on, oldest first —
 *     what the dock draws and what the next message is judged against BEFORE
 *     it is routed (answers first).
 *   - `answerDecision` records the answer — options by id, free text, or a
 *     skip — through the ask's own `decideAsk` / `skipAsk`, so the chosen
 *     option's effect runs as the person, `ask.decided` reaches every
 *     subscriber, and a parked run hears it. It never writes a word the person
 *     did not type: the answer is a record, and the turn that follows reads it
 *     as one.
 *
 * Every read and write is scoped by orgId AND conversation: a Decision in
 * another workspace, or in another conversation of this one, is not found.
 */

import type { DecisionAnswer, DecisionChannel, DecisionView } from '@/libs/decisions/decision';
import type { AskKind, AskObjectRef, AskOption, AskRisk } from '@/models/Schema';
import type { Ask } from '@/services/AskService';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { answerProblem, decisionViewOf } from '@/libs/decisions/decision';
import { askSchema } from '@/models/Schema';

/** Errors a caller maps onto its own surface — the code names the situation. */
export class DecisionError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'DecisionError';
  }
}

export type RaiseDecisionInput = {
  orgId: string;
  /** The conversation it docks in. */
  conversationId: number;
  /** The person it waits on — the one in the conversation. */
  ownerUserId: string;
  /** The agent asking. */
  agentSlug: string | null;
  kind: AskKind;
  question: string;
  body?: string | null;
  options?: AskOption[];
  allowOther?: boolean;
  multiple?: boolean;
  objectRefs?: AskObjectRef[];
  risk?: AskRisk | null;
  dueAt?: Date | null;
  contextUrl?: string | null;
  contextMd?: string | null;
  sourceRef?: string | null;
  groupKey?: string | null;
  groupTitle?: string | null;
};

/**
 * Put a Decision in a conversation. One question is one row: the same open
 * question asked again is refreshed in place (`upsertAsk`), never doubled.
 * @param input - The Decision.
 */
export async function raiseDecision(input: RaiseDecisionInput): Promise<{ view: DecisionView; created: boolean }> {
  const { upsertAsk } = await import('@/services/AskService');
  const { ask, created } = await upsertAsk({
    orgId: input.orgId,
    createdBy: input.agentSlug ? `agent:${input.agentSlug}` : input.ownerUserId,
    ask: {
      kind: input.kind,
      title: input.question,
      body: input.body ?? undefined,
      agentSlug: input.agentSlug,
      options: input.options ?? [],
      objectRefs: input.objectRefs ?? [],
      risk: input.risk ?? undefined,
      dueAt: input.dueAt ?? undefined,
      contextUrl: input.contextUrl ?? undefined,
      contextMd: input.contextMd ?? undefined,
      sourceRef: input.sourceRef ?? undefined,
      groupKey: input.groupKey ?? undefined,
      groupTitle: input.groupTitle ?? undefined,
      conversationId: input.conversationId,
      ownerUserId: input.ownerUserId,
      allowOther: input.allowOther ?? true,
      multiSelect: input.multiple ?? false,
    },
  });
  return { view: decisionViewOf(ask), created };
}

/**
 * The Decisions a conversation is waiting on, oldest first — the first is
 * the one docked; the rest are the queue behind it.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 */
export async function openDecisions(orgId: string, conversationId: number): Promise<DecisionView[]> {
  const rows = await db
    .select()
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.conversationId, conversationId), eq(askSchema.status, 'open')))
    .orderBy(asc(askSchema.createdAt), asc(askSchema.id))
    .limit(20);
  return rows.map(r => decisionViewOf(r));
}

/**
 * One Decision in a conversation, or null when this workspace has none by
 * that id IN THAT CONVERSATION. Scoping by conversation is what keeps an
 * answer sent from one thread off a question asked in another.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 * @param id - The Decision (ask) id.
 */
export async function decisionInConversation(orgId: string, conversationId: number, id: number): Promise<Ask | null> {
  const [row] = await db
    .select()
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.conversationId, conversationId), eq(askSchema.id, id)))
    .limit(1);
  return row ?? null;
}

export type AnsweredDecision = {
  /** The Decision as it was asked, before the answer — what the turn reads. */
  asked: DecisionView;
  /** The Decision as it stands now. */
  view: DecisionView;
  answer: DecisionAnswer;
  /** The action the chosen option started, when it started one. */
  effect: { runId: number; actionId: string; status: string; undoable: boolean; label: string } | null;
};

/**
 * Record a person's answer to a Decision in a conversation.
 *
 * Options and free text go through `decideAsk` (an option chosen runs its
 * effect as the person; free text is the `other` answer with their words as
 * the note); a skip through `skipAsk`. Refuses an answer the Decision cannot
 * take (`answerProblem`) and one already decided — never a silent overwrite.
 * @param opts - The answer.
 * @param opts.orgId - The workspace.
 * @param opts.conversationId - The conversation it was answered in.
 * @param opts.id - The Decision.
 * @param opts.answer - What they answered.
 * @param opts.by - The person.
 * @param opts.via - Where.
 */
export async function answerDecision(opts: { orgId: string; conversationId: number; id: number; answer: DecisionAnswer; by: string; via: DecisionChannel }): Promise<AnsweredDecision> {
  const row = await decisionInConversation(opts.orgId, opts.conversationId, opts.id);
  if (!row) {
    throw new DecisionError('NOT_FOUND', `No decision ${opts.id} in this conversation`);
  }
  const asked = decisionViewOf(row);
  if (asked.state !== 'open' && asked.state !== 'expired') {
    throw new DecisionError('CONFLICT', `Decision ${opts.id} was already ${asked.state}`);
  }
  const problem = answerProblem(asked, opts.answer);
  if (problem) {
    throw new DecisionError('VALIDATION_FAILED', `That does not answer "${asked.question}": ${problem}.`);
  }
  const { AskError, decideAsk, skipAsk } = await import('@/services/AskService');
  let written: Ask;
  try {
    if (opts.answer.kind === 'skip') {
      written = await skipAsk({ orgId: opts.orgId, id: opts.id, by: opts.by, via: opts.via });
    } else if (opts.answer.kind === 'free_text') {
      written = await decideAsk({ orgId: opts.orgId, id: opts.id, decision: 'other', note: opts.answer.text, decidedBy: opts.by, via: opts.via });
    } else {
      written = await decideAsk({ orgId: opts.orgId, id: opts.id, decision: opts.answer.optionIds[0]!, decidedBy: opts.by, via: opts.via, chosenOptionIds: opts.answer.optionIds });
    }
  } catch (err) {
    if (err instanceof AskError) {
      throw new DecisionError(err.code, err.message);
    }
    throw err;
  }
  return { asked, view: decisionViewOf(written), answer: opts.answer, effect: await effectOf(written) };
}

/**
 * The action the chosen option started, read off its run — with whether its
 * kind can be undone, so the receipt promises Undo only where it is real.
 * @param row - The decided ask.
 */
async function effectOf(row: Ask): Promise<AnsweredDecision['effect']> {
  if (!row.effectRunId) {
    return null;
  }
  const { actionRunSchema } = await import('@/models/Schema');
  const [run] = await db
    .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, status: actionRunSchema.status })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, row.orgId), eq(actionRunSchema.id, row.effectRunId)))
    .limit(1);
  if (!run) {
    return null;
  }
  const { actionIsUndoable, actionLabel } = await import('@/libs/actions/undoable');
  const chosen = row.options.find(o => o.id === row.decision);
  return { runId: run.id, actionId: run.actionId, status: run.status, undoable: run.status === 'done' && actionIsUndoable(run.actionId), label: chosen?.label ?? actionLabel(run.actionId) };
}
