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

import type { DecisionAnswer, DecisionChannel, DecisionSubject, DecisionView } from '@/libs/decisions/decision';
import type { AskKind, AskObjectRef, AskOption, AskRisk } from '@/models/Schema';
import type { Ask } from '@/services/AskService';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { ALLOW_ONCE_ID, ALWAYS_ALLOW_ID, answerProblem, decisionViewOf } from '@/libs/decisions/decision';
import { waitsForPerson } from '@/libs/needsYou/deadlines';
import { askSchema, conversationSchema } from '@/models/Schema';

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
 * The deadlines the decision clock runs, keyed as `decisionKey` keys them —
 * what every card shows under its question. Never throws: a card without its
 * deadline is still a card.
 * @param orgId - The workspace.
 */
async function deadlines(orgId: string): Promise<Map<string, NonNullable<DecisionView['deadline']> & { held: boolean }>> {
  try {
    const { runningClocks } = await import('@/services/needsYou/DecisionClockService');
    const clocks = await runningClocks(orgId);
    return new Map([...clocks].map(([key, c]) => [key, { at: c.deadlineAt.toISOString(), defaultLabel: c.defaultLabel, held: c.status === 'held' }]));
  } catch {
    return new Map();
  }
}

/**
 * Ask rows as Decisions, each with its clock.
 * @param rows - The asks.
 * @param clocks - The running clocks.
 * @param inObjective
 */
function askViews(rows: Ask[], clocks: Awaited<ReturnType<typeof deadlines>>, inObjective = false): DecisionView[] {
  return rows.map((r) => {
    // A setup step (or a question mid-objective) waits for its person: no
    // "Default in 23h" under it, even from a clock opened before that rule.
    const clock = waitsForPerson(r, inObjective) ? undefined : clocks.get(`ask:${r.id}`);
    return decisionViewOf(r, clock ? { deadline: { at: clock.at, defaultLabel: clock.defaultLabel }, clockHeld: clock.held } : {});
  });
}

/**
 * The action kind an ask's Allow once runs, when it runs one — what "Always
 * allow" would move up the ladder.
 * @param row - The ask.
 */
function approvalActionOf(row: Pick<Ask, 'options'>): string | null {
  return row.options.find(o => o.id === ALLOW_ONCE_ID)?.action?.id ?? null;
}

/**
 * Asks and proposals as the person sees them: an open approval offers
 * "Always allow" where the trust ladder would take it for them.
 * @param orgId - The workspace.
 * @param viewerId - The person, when known.
 * @param asks - Ask rows with their views, in order.
 * @param runs - Proposal runs with their views, in order.
 */
async function forViewer(orgId: string, viewerId: string | null, asks: Array<[Ask, DecisionView]>, runs: Array<[{ actionId: string }, DecisionView]>): Promise<DecisionView[]> {
  const { withAlwaysAllow } = await import('./alwaysAllow');
  return Promise.all([
    ...asks.map(([row, view]) => withAlwaysAllow(orgId, viewerId, view, approvalActionOf(row))),
    ...runs.map(([run, view]) => withAlwaysAllow(orgId, viewerId, view, run.actionId)),
  ]);
}

/**
 * Oldest first, by when each started waiting.
 * @param views - Decisions.
 */
function oldestFirst(views: DecisionView[]): DecisionView[] {
  return [...views].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id - b.id);
}

/**
 * The Decisions a conversation is waiting on, oldest first — the first is
 * the one docked; the rest are the queue behind it. Its open asks and the
 * proposals filed from it, which are their own approval Decisions
 * (`proposals.ts`).
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 * @param viewerId
 */
export async function openDecisions(orgId: string, conversationId: number, viewerId: string | null = null): Promise<DecisionView[]> {
  const { pendingProposalsIn, proposalDecisionView } = await import('./proposals');
  const [rows, runs, clocks, conversation] = await Promise.all([
    db
      .select()
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.conversationId, conversationId), eq(askSchema.status, 'open')))
      .orderBy(asc(askSchema.createdAt), asc(askSchema.id))
      .limit(20),
    pendingProposalsIn(orgId, conversationId),
    deadlines(orgId),
    db.select({ objective: conversationSchema.objective }).from(conversationSchema).where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId))).limit(1).then(r => r[0] ?? null).catch(() => null),
  ]);
  const proposals = await Promise.all(runs.map(async (run) => {
    const clock = clocks.get(`proposal:${run.id}`);
    return proposalDecisionView(run, clock ? { deadline: { at: clock.at, defaultLabel: clock.defaultLabel } } : {});
  }));
  const asks = askViews(rows, clocks, conversation?.objective != null);
  return oldestFirst(await forViewer(orgId, viewerId, rows.map((r, i) => [r, asks[i]!]), runs.map((r, i) => [r, proposals[i]!])));
}

/** How many waiting-elsewhere Decisions the dock carries behind a conversation's own. */
export const WAITING_IN_CHAT_LIMIT = 12;

/**
 * WHAT ELSE IS WAITING ON THIS PERSON — the Decisions nobody could ask them
 * in a conversation: questions a mission or an automation put on Needs you
 * (no conversation; theirs, or anyone's), and proposals filed from no
 * conversation. They queue behind the conversation's own in the dock ("1 of
 * 4"), so a person never has to leave chat to clear them (Jamie, 2026-10-07).
 * A Decision that belongs to another conversation stays in that one.
 * @param orgId - The workspace.
 * @param userId - The person.
 */
export async function waitingElsewhere(orgId: string, userId: string): Promise<DecisionView[]> {
  const { proposalDecisionView } = await import('./proposals');
  const { listReviewRows } = await import('@/services/inbox/reviewRows');
  const [rows, review, clocks] = await Promise.all([
    db
      .select()
      .from(askSchema)
      .where(and(
        eq(askSchema.orgId, orgId),
        eq(askSchema.status, 'open'),
        isNull(askSchema.conversationId),
        or(isNull(askSchema.ownerUserId), eq(askSchema.ownerUserId, userId)),
        // A credential's value never travels through chat; it is answered on Needs you.
        sql`${askSchema.kind} <> 'credential'`,
      ))
      .orderBy(asc(askSchema.createdAt), asc(askSchema.id))
      .limit(WAITING_IN_CHAT_LIMIT),
    listReviewRows(orgId, 'open'),
    deadlines(orgId),
  ]);
  const runs = review
    .filter(r => r.status === 'pending' && !(r.proposal as { origin?: { conversationId?: unknown } } | null)?.origin?.conversationId)
    .slice(0, WAITING_IN_CHAT_LIMIT);
  const proposals = await Promise.all(runs.map(async (r) => {
    const clock = clocks.get(`proposal:${r.id}`);
    return proposalDecisionView({ id: r.id, actionId: r.actionId, status: r.status, input: r.input, proposal: r.proposal, invokedBy: (r as { invokedBy?: string | null }).invokedBy ?? null, createdAt: r.createdAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt }, clock ? { deadline: { at: clock.at, defaultLabel: clock.defaultLabel } } : {});
  }));
  const asks = askViews(rows, clocks);
  return oldestFirst(await forViewer(orgId, userId, rows.map((r, i) => [r, asks[i]!]), runs.map((r, i) => [r, proposals[i]!]))).slice(0, WAITING_IN_CHAT_LIMIT);
}

/**
 * Answer a Decision that waits outside any conversation — from the dock's
 * queue, with no turn after it: whoever asked hears it the way it always
 * did (`ask.decided`, a parked run resuming, the proposal executing).
 * @param opts - The answer.
 * @param opts.orgId - The workspace.
 * @param opts.subject - Ask or proposal.
 * @param opts.id - Its id.
 * @param opts.answer - What they answered.
 * @param opts.by - The person.
 */
export async function answerElsewhere(opts: { orgId: string; subject: DecisionSubject; id: number; answer: DecisionAnswer; by: string }): Promise<AnsweredDecision> {
  if (opts.subject === 'proposal') {
    const { answerProposal } = await import('./proposals');
    return answerProposal({ orgId: opts.orgId, id: opts.id, conversationId: null, answer: opts.answer, by: opts.by });
  }
  const [row] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, opts.orgId), eq(askSchema.id, opts.id), isNull(askSchema.conversationId))).limit(1);
  if (!row) {
    throw new DecisionError('NOT_FOUND', `No decision ${opts.id} waiting outside a conversation`);
  }
  return answerRow(row, { ...opts, via: 'needs_you' });
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
 * @param opts.subject
 * @param opts.answer - What they answered.
 * @param opts.by - The person.
 * @param opts.via - Where.
 */
export async function answerDecision(opts: { orgId: string; conversationId: number; id: number; subject?: DecisionSubject; answer: DecisionAnswer; by: string; via: DecisionChannel }): Promise<AnsweredDecision> {
  if (opts.subject === 'proposal') {
    const { answerProposal } = await import('./proposals');
    return answerProposal({ orgId: opts.orgId, id: opts.id, conversationId: opts.conversationId, answer: opts.answer, by: opts.by });
  }
  const row = await decisionInConversation(opts.orgId, opts.conversationId, opts.id);
  if (!row) {
    throw new DecisionError('NOT_FOUND', `No decision ${opts.id} in this conversation`);
  }
  return answerRow(row, opts);
}

/**
 * Record an answer on an ask row already found in scope.
 * @param row - The ask.
 * @param opts - The answer.
 * @param opts.orgId - The workspace.
 * @param opts.id - The ask.
 * @param opts.answer - What they answered.
 * @param opts.by - The person.
 * @param opts.via - Where.
 */
async function answerRow(row: Ask, opts: { orgId: string; id: number; answer: DecisionAnswer; by: string; via: DecisionChannel }): Promise<AnsweredDecision> {
  // ALWAYS ALLOW: the kind moves up the trust ladder, then this one runs as
  // Allow once. The agent hears what was chosen, against the card as drawn.
  if (opts.answer.kind === 'option' && opts.answer.optionIds[0] === ALWAYS_ALLOW_ID) {
    const { takeAlwaysAllow, withAlwaysAllow } = await import('./alwaysAllow');
    const drawn = await withAlwaysAllow(opts.orgId, opts.by, decisionViewOf(row), approvalActionOf(row));
    if (drawn.state !== 'open') {
      throw new DecisionError('CONFLICT', `Decision ${opts.id} was already ${drawn.state}`);
    }
    await takeAlwaysAllow(opts.orgId, opts.by, approvalActionOf(row));
    const done = await answerRow(row, { ...opts, answer: { kind: 'option', optionIds: [ALLOW_ONCE_ID] } });
    return { ...done, asked: drawn, answer: opts.answer };
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
  // The receipt names what was done: an approval or a setup step is its
  // question ("Add Software Factory"), never the bare verb on its button; a
  // choice is the question with the path taken.
  const label = row.kind === 'approval' || row.kind === 'gate' || row.kind === 'setup'
    ? row.title
    : chosen ? `${row.title} — ${chosen.label}` : actionLabel(run.actionId);
  return { runId: run.id, actionId: run.actionId, status: run.status, undoable: run.status === 'done' && actionIsUndoable(run.actionId), label: label.slice(0, 200) };
}

/**
 * BUILD IT, AS A DECISION THE PERSON TAKES — not words put in their mouth.
 *
 * A card a turn drew (a feature idea) offers Build it when the workspace has
 * an intake to push it through (`services/chat/intake.ts`). Pressing it used
 * to send "Build it: **…**. File it as a request and start the build." as the
 * person's message, routed to the intake's owner. Now it is a Decision raised
 * for the person and answered by their press: the intake's owner hears a
 * typed record — build this card, its facts, its id — and files it through
 * the intake's own gates.
 * @param opts - The press.
 * @param opts.orgId - The workspace.
 * @param opts.userId - The person.
 * @param opts.conversationId - The conversation the card is in.
 * @param opts.artifactId - The card.
 */
export async function buildDecisionFor(opts: { orgId: string; userId: string; conversationId: number; artifactId: number }): Promise<DecisionView> {
  const { workspaceIntake } = await import('@/services/chat/intake');
  const { getArtifact } = await import('@/services/ArtifactService');
  const [intake, card] = await Promise.all([workspaceIntake(opts.orgId), getArtifact({ orgId: opts.orgId, id: opts.artifactId })]);
  if (!intake) {
    throw new DecisionError('NOT_FOUND', 'Nothing in this workspace builds a card');
  }
  if (!card) {
    throw new DecisionError('NOT_FOUND', `No card ${opts.artifactId} in this workspace`);
  }
  const spec = ((card as { spec?: unknown }).spec ?? {}) as { fields?: unknown };
  const fields = Array.isArray(spec.fields) ? spec.fields as Array<{ k?: unknown; v?: unknown }> : [];
  const facts = fields
    .filter(f => typeof f.k === 'string' && f.v !== null && f.v !== undefined && String(f.v).trim())
    .map(f => `${String(f.k)}: ${String(f.v)}`)
    .join('; ');
  const noun = intake.label.toLowerCase();
  const { view } = await raiseDecision({
    orgId: opts.orgId,
    conversationId: opts.conversationId,
    ownerUserId: opts.userId,
    agentSlug: intake.ownerSlug,
    kind: 'approval',
    question: `Build "${card.title}"`,
    body: facts || null,
    options: [{ id: 'build', label: 'Build it', description: `Files it as a ${noun} and starts the build.`, recommended: true }],
    allowOther: false,
    objectRefs: [{ type: 'artifact', id: String(card.id) }],
  });
  return view;
}
