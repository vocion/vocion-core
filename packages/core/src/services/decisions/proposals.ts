/**
 * A PROPOSAL IS ITS OWN APPROVAL DECISION.
 *
 * A pending action_run already records everything an approval needs — what
 * it does, who proposed it, why, where it came up (`proposal.origin`), and,
 * once decided, who decided it and when. So an approval Decision is that run,
 * read as a Decision (`proposalDecisionView`), never a second row wrapping it:
 * a wrapping ask would put every proposal on Needs you twice and in front of
 * every reader of open asks.
 *
 * Answered through the review queue's own path (`ReviewService.decide`), as
 * the person, so the trust ladder, the alignment row, the learning signal and
 * the action's Undo all apply exactly as they do on Review:
 *
 *   Approve        the run executes as theirs
 *   Reject         nothing runs
 *   their words    a rejection with their note: the asker revises and proposes again
 *   Skip           not now — it leaves the dock and comes back to Review in a week
 */

import type { AnsweredDecision } from './DecisionService';
import type { DecisionAnswer, DecisionOption, DecisionView } from '@/libs/decisions/decision';
import type { ActionRunLike } from '@/services/inbox/describeActionRun';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { ALLOW_ONCE_ID, ALWAYS_ALLOW_ID, answerProblem, DENY_ID } from '@/libs/decisions/decision';
import { actionRunSchema } from '@/models/Schema';

type RunRow = Pick<typeof actionRunSchema.$inferSelect, 'id' | 'actionId' | 'status' | 'input' | 'proposal' | 'invokedBy' | 'createdAt' | 'decidedBy' | 'decidedAt'>;

const RUN_FIELDS = {
  id: actionRunSchema.id,
  actionId: actionRunSchema.actionId,
  status: actionRunSchema.status,
  input: actionRunSchema.input,
  proposal: actionRunSchema.proposal,
  invokedBy: actionRunSchema.invokedBy,
  createdAt: actionRunSchema.createdAt,
  decidedBy: actionRunSchema.decidedBy,
  decidedAt: actionRunSchema.decidedAt,
};

/**
 * The agent a proposal came from: the proposal's own stamp, else `agent:<slug>`
 * on the run.
 * @param run - The run.
 */
function proposerOf(run: Pick<RunRow, 'proposal' | 'invokedBy'>): string | null {
  const stamped = (run.proposal as { agentSlug?: unknown } | null)?.agentSlug;
  if (typeof stamped === 'string' && stamped) {
    return stamped;
  }
  const by = run.invokedBy ?? '';
  return /^(?:agent|factory):/.test(by) ? by.slice(by.indexOf(':') + 1) : null;
}

/**
 * The conversation a proposal was filed from, when it was.
 * @param run - The run.
 */
function originConversation(run: Pick<RunRow, 'proposal'>): number | null {
  const id = Number((run.proposal as { origin?: { conversationId?: unknown } } | null)?.origin?.conversationId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * A pending (or decided) proposal as a Decision: its title as the question,
 * the proposer's reason as the why, Approve and Reject with what each does,
 * and the proposer's own recommendation first.
 * @param run - The run.
 * @param extra - What the run alone cannot say.
 * @param extra.deadline - The decision clock's deadline and default, when one runs.
 */
export async function proposalDecisionView(run: RunRow, extra: { deadline?: DecisionView['deadline'] } = {}): Promise<DecisionView> {
  const { describeActionRun } = await import('@/services/inbox/describeActionRun');
  const { actionIsUndoable } = await import('@/libs/actions/undoable');
  const { inboxHref } = await import('@/services/inbox/inboxRef');
  const { payloadPreview } = await import('./preview');
  const described = describeActionRun({ ...run, input: run.input ?? {}, proposal: run.proposal ?? null } as unknown as ActionRunLike);
  const proposal = (run.proposal ?? {}) as { suggestedDecision?: unknown; suggestedDecisionReason?: unknown };
  const suggested = proposal.suggestedDecision;
  const changes = described.changes.map(c => `${c.field} → ${c.to}`).join('; ');
  const undo = actionIsUndoable(run.actionId) ? 'with Undo' : 'it cannot be undone';
  const options: DecisionOption[] = [
    { id: ALLOW_ONCE_ID, label: 'Allow once', consequence: `Runs it as you, this once — ${undo}.`, ...(suggested !== 'reject' ? { recommended: true } : {}) },
    { id: DENY_ID, label: 'Deny', consequence: 'Nothing runs; the agent revises from your no.', ...(suggested === 'reject' ? { recommended: true } : {}) },
  ];
  const decided = run.status !== 'pending';
  const approved = ['done', 'approved', 'executing', 'awaiting_execution'].includes(run.status);
  return {
    id: run.id,
    subject: 'proposal',
    kind: 'approval',
    question: described.title,
    body: described.rationale ?? (typeof proposal.suggestedDecisionReason === 'string' ? proposal.suggestedDecisionReason : null),
    options: [...options.filter(o => o.recommended), ...options.filter(o => !o.recommended)],
    // Their own words reject it with a note the proposer revises from.
    allowOther: true,
    multiple: false,
    state: !decided ? 'open' : run.status === 'undone' ? 'undone' : 'answered',
    agentSlug: proposerOf(run) ?? described.agentSlug,
    ownerUserId: null,
    conversationId: originConversation(run),
    ...(extra.deadline ? { deadline: extra.deadline } : {}),
    answer: decided
      ? { kind: 'option', optionIds: [approved ? ALLOW_ONCE_ID : DENY_ID], labels: [approved ? 'Allow once' : 'Deny'], freeText: null, by: run.decidedBy ?? null, at: run.decidedAt ? new Date(run.decidedAt).toISOString() : null, via: null }
      : null,
    createdAt: run.createdAt ? new Date(run.createdAt).toISOString() : null,
    preview: changes ? described.changes.map(c => `${c.field} → ${c.to}`).join('\n') : payloadPreview(run.input as Record<string, unknown> | null),
    href: inboxHref('proposal', run.id),
    hrefLabel: 'Details',
  };
}

/**
 * The proposals waiting on a person in one conversation — filed from it —
 * oldest first.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 */
export async function pendingProposalsIn(orgId: string, conversationId: number): Promise<RunRow[]> {
  return db
    .select(RUN_FIELDS)
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.status, 'pending'),
      sql`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId' = ${String(conversationId)}`,
    ))
    .orderBy(asc(actionRunSchema.createdAt), asc(actionRunSchema.id))
    .limit(20);
}

/**
 * One proposal, scoped to the workspace.
 * @param orgId - The workspace.
 * @param id - The run.
 */
export async function proposalById(orgId: string, id: number): Promise<RunRow | null> {
  const [row] = await db.select(RUN_FIELDS).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, id))).limit(1);
  return row ?? null;
}

/**
 * Answer a proposal as the person, through Review's own decide path.
 * @param opts - The answer.
 * @param opts.orgId - The workspace.
 * @param opts.id - The run.
 * @param opts.conversationId - The conversation it was answered in; a proposal filed from another is not found there. Null answers it from anywhere in the workspace.
 * @param opts.answer - What they answered.
 * @param opts.by - The person.
 */
export async function answerProposal(opts: { orgId: string; id: number; conversationId: number | null; answer: DecisionAnswer; by: string }): Promise<AnsweredDecision> {
  const { DecisionError } = await import('./DecisionService');
  const run = await proposalById(opts.orgId, opts.id);
  if (!run || (opts.conversationId !== null && originConversation(run) !== opts.conversationId)) {
    throw new DecisionError('NOT_FOUND', `No proposal ${opts.id} in this conversation`);
  }
  const asked = await proposalDecisionView(run);
  if (asked.state !== 'open') {
    throw new DecisionError('CONFLICT', `Proposal ${opts.id} was already decided (${run.status})`);
  }
  // ALWAYS ALLOW: the kind moves up the trust ladder, then this one is
  // approved as Allow once; the agent hears what was chosen.
  if (opts.answer.kind === 'option' && opts.answer.optionIds[0] === ALWAYS_ALLOW_ID) {
    const { takeAlwaysAllow, withAlwaysAllow } = await import('./alwaysAllow');
    const drawn = await withAlwaysAllow(opts.orgId, opts.by, asked, run.actionId);
    await takeAlwaysAllow(opts.orgId, opts.by, run.actionId);
    const done = await answerProposal({ ...opts, answer: { kind: 'option', optionIds: [ALLOW_ONCE_ID] } });
    return { ...done, asked: drawn, answer: opts.answer };
  }
  const problem = answerProblem(asked, opts.answer);
  if (problem) {
    throw new DecisionError('VALIDATION_FAILED', `That does not answer "${asked.question}": ${problem}.`);
  }
  const { decide, snooze } = await import('@/services/ReviewService');
  const item = { kind: 'action' as const, id: opts.id };
  let effect: AnsweredDecision['effect'] = null;
  if (opts.answer.kind === 'skip') {
    const { deferUntil } = await import('@/features/dashboard/chat/deferral');
    await snooze(opts.orgId, item, deferUntil(), opts.by, { note: 'Skipped from chat' });
  } else if (opts.answer.kind === 'free_text') {
    await decide(item, 'reject', opts.orgId, { reviewedBy: opts.by, note: opts.answer.text, reason: opts.answer.text });
  } else {
    const verb = opts.answer.optionIds[0] === ALLOW_ONCE_ID ? 'approve' : 'reject';
    const result = await decide(item, verb, opts.orgId, { reviewedBy: opts.by });
    if (verb === 'approve') {
      const status = (result as { execution?: { status?: string } } | null)?.execution?.status ?? 'approved';
      const { actionIsUndoable, actionLabel } = await import('@/libs/actions/undoable');
      effect = { runId: opts.id, actionId: run.actionId, status, undoable: status === 'done' && actionIsUndoable(run.actionId), label: asked.question || actionLabel(run.actionId) };
    }
  }
  const after = (await proposalById(opts.orgId, opts.id)) ?? run;
  const view = await proposalDecisionView(after);
  // A skip leaves it pending (snoozed), so it reads as what the person did.
  const answered: DecisionView = opts.answer.kind === 'skip'
    ? { ...view, state: 'skipped', answer: { kind: 'skip', optionIds: [], labels: [], freeText: null, by: opts.by, at: new Date().toISOString(), via: null } }
    : opts.answer.kind === 'free_text'
      ? { ...view, answer: { kind: 'free_text', optionIds: [], labels: [], freeText: opts.answer.text, by: opts.by, at: new Date().toISOString(), via: null } }
      : view;
  return { asked, view: answered, answer: opts.answer, effect };
}
