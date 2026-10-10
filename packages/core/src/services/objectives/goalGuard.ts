/**
 * WHAT A GOAL MAY ASK FOR — the two rules a running goal holds its agent to
 * when it proposes an action, read off stored facts rather than the model's
 * say-so.
 *
 * 1. NO OUTREACH NOBODY ASKED FOR. A goal that imports or stages data ends
 *    when the data is in ("N items in the data room — open it?"). It drafts
 *    and sends nothing unless the person told the agent to (the consent
 *    read on their words, never a keyword match). A phone walk (2026-10-10): a leads import
 *    became eight "draft email to …" approvals the person never asked for.
 *
 * 2. DENY MEANS DROP. A denied action is not asked again, revised, in the
 *    same goal — not until the person has typed new direction since the
 *    denial. The same walk: each Deny or Skip brought back a reworded card,
 *    and the queue only grew.
 *
 * The pure parts are exported for tests; `goalProposalRefusal` reads the
 * conversation and the runs, and answers with the refusal the agent reads,
 * or null.
 */

import { nounCode } from '@/libs/codes';

/**
 * Grants that reach a person outside the workspace: an email, an enrollment
 * in a sequence that sends one. Read off the action's own grant, never its id.
 */
const OUTREACH_GRANTS: ReadonlySet<string> = new Set(['send_email', 'enroll_lead']);

/**
 * Whether an action drafts or sends outreach.
 * @param action - The registered action's id and grant.
 * @param action.id - Its id.
 * @param action.grant - Its grant.
 */
export function isOutreachAction(action: { id: string; grant?: string }): boolean {
  return action.grant !== undefined && OUTREACH_GRANTS.has(action.grant);
}

/**
 * Whether a goal may put this outreach in front of the person. Only when the
 * person told the agent to do it — the consent read on their own words
 * (`owedDecision.personSaidToDecide`, a model's reading, never matched here).
 * Anything else that drafts or sends is the agent's own idea, and a goal does
 * not have it.
 * @param action - The proposed action.
 * @param action.id - Its id.
 * @param action.grant - Its grant.
 * @param personAsked - The person told the agent to take exactly this action.
 */
export function outreachAllowed(action: { id: string; grant?: string }, personAsked: boolean): boolean {
  return personAsked || !isOutreachAction(action);
}

/**
 * Who or what an action is about, when its input says: a recipient, a record.
 * @param input - The action's input.
 */
export function subjectOf(input: Record<string, unknown> | null | undefined): string | null {
  if (!input) {
    return null;
  }
  for (const key of ['to', 'recipient', 'email', 'contactId', 'objectId', 'recordId', 'id']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) {
      return `${key}:${v.trim().toLowerCase()}`;
    }
    if (typeof v === 'number') {
      return `${key}:${v}`;
    }
    if (Array.isArray(v) && v.length > 0) {
      return `${key}:${v.map(x => String(x).trim().toLowerCase()).sort().join(',')}`;
    }
  }
  return null;
}

export type DeniedRun = { id: number; actionId: string; subject: string | null; decidedAt: Date };

/**
 * The denial a new proposal would re-ask, or null. The same action about the
 * same subject (or, when neither names one, the same action) denied since the
 * person last typed is a re-ask: revised wording does not make it new.
 * @param proposal - What the agent is proposing now.
 * @param proposal.actionId - Its action.
 * @param proposal.subject - Its subject (`subjectOf`).
 * @param denied - What the person denied in this goal.
 * @param lastTypedAt - When the person last typed in this conversation, or null.
 */
export function deniedReAsk(proposal: { actionId: string; subject: string | null }, denied: readonly DeniedRun[], lastTypedAt: Date | null): DeniedRun | null {
  return denied.find(d => d.actionId === proposal.actionId
    && (d.subject === null || proposal.subject === null || d.subject === proposal.subject)
    && (lastTypedAt === null || d.decidedAt.getTime() > lastTypedAt.getTime())) ?? null;
}

/**
 * When the person last gave new direction: a message they typed, or their own
 * words on a card ("Something else…"). Picking an option on a card — Deny,
 * Skip — is an answer, not new direction. Rows newest first.
 * @param rows - The conversation's `user` and `decision` rows, newest first.
 */
export function lastDirection(rows: ReadonlyArray<{ role: string; runs: unknown; createdAt: Date }>): Date | null {
  for (const r of rows) {
    if (r.role === 'user') {
      return r.createdAt;
    }
    const runs = Array.isArray(r.runs) ? r.runs as Array<{ type?: unknown; answer?: { kind?: unknown } }> : [];
    if (runs.some(x => x?.type === 'decision_answer' && x.answer?.kind === 'free_text')) {
      return r.createdAt;
    }
  }
  return null;
}

/**
 * The refusal for a proposal made while a goal runs, or null when it may go
 * ahead. Only a conversation whose objective is a running goal is held here.
 * @param input - The proposal and where.
 * @param input.orgId - The workspace.
 * @param input.conversationId - The conversation, when there is one.
 * @param input.actionId - The proposed action.
 * @param input.grant - Its grant.
 * @param input.actionInput - Its input.
 * @param input.personAsked - The person told the agent to take exactly this action (the consent read).
 */
export async function goalProposalRefusal(input: { orgId: string; conversationId?: number | null; actionId: string; grant?: string; actionInput: Record<string, unknown>; personAsked: boolean }): Promise<string | null> {
  if (!input.conversationId) {
    return null;
  }
  const [{ db }, { and, desc, eq, inArray, sql }, { actionRunSchema, conversationMessageSchema, conversationSchema }, { readObjective }, { decidedByMachine }] = await Promise.all([
    import('@/libs/DB'),
    import('drizzle-orm'),
    import('@/models/Schema'),
    import('@/libs/objectives/objective'),
    import('@/libs/actions/decider'),
  ]);
  const [conv] = await db.select({ objective: conversationSchema.objective }).from(conversationSchema).where(and(eq(conversationSchema.orgId, input.orgId), eq(conversationSchema.id, input.conversationId))).limit(1);
  const objective = readObjective(conv?.objective);
  if (objective?.kind !== 'goal' || objective.state !== 'running') {
    return null;
  }
  if (!outreachAllowed({ id: input.actionId, grant: input.grant }, input.personAsked)) {
    return 'Not proposed: nobody asked this goal for outreach. A goal drafts and sends nothing unless the person tells you to. If it imported or staged data, finish with one line — "N items in the data room — open it?" — and stop.';
  }
  const said = await db
    .select({ role: conversationMessageSchema.role, runs: conversationMessageSchema.runsJson, createdAt: conversationMessageSchema.createdAt })
    .from(conversationMessageSchema)
    .where(and(eq(conversationMessageSchema.conversationId, input.conversationId), inArray(conversationMessageSchema.role, ['user', 'decision'])))
    .orderBy(desc(conversationMessageSchema.id))
    .limit(30);
  const since = new Date(objective.startedAt);
  const deniedRows = await db
    .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input, decidedAt: actionRunSchema.decidedAt, decidedBy: actionRunSchema.decidedBy })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, input.orgId),
      inArray(actionRunSchema.status, ['rejected']),
      eq(actionRunSchema.actionId, input.actionId),
      sql`(${actionRunSchema.proposal} -> 'origin' ->> 'conversationId') = ${String(input.conversationId)}`,
    ))
    .orderBy(desc(actionRunSchema.id))
    .limit(50);
  const denied: DeniedRun[] = deniedRows
    .filter(r => r.decidedAt && r.decidedAt.getTime() >= since.getTime() && !decidedByMachine(r.decidedBy))
    .map(r => ({ id: r.id, actionId: r.actionId, subject: subjectOf(r.input as Record<string, unknown>), decidedAt: r.decidedAt! }));
  const hit = deniedReAsk({ actionId: input.actionId, subject: subjectOf(input.actionInput) }, denied, lastDirection(said));
  if (hit) {
    return `Not proposed: the person denied this (${nounCode('action', hit.id)}) in this goal, and denied means dropped. Do not propose it again, reworded or revised, unless they type new direction. Move on, or say in one line what is done.`;
  }
  return null;
}
