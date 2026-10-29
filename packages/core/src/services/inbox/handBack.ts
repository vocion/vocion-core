/**
 * AN ANSWER GOES BACK TO THE AGENT THAT ASKED (SEO walk 2, 2026-10-27: the
 * strategist asked "Name the author for each of the 3 sample posts", the
 * person answered on Needs you, and nothing happened — the sheet even said
 * "nothing runs on its own").
 *
 * An ask answered in its own conversation's turn is already heard: the chat
 * route runs the asking agent with the answer as a typed decision event
 * (`decisions/answersFirst.ts`). Everywhere else — Needs you, a decision
 * sheet, the dock's queue, Slack, the API — the answer used to be recorded and
 * left there. Now, when an agent filed the ask, its answer is handed back as a
 * follow-up turn: the same typed decision event (`decisionForModel`) is
 * written into the conversation the question came from (the ask's own, else
 * the one its filing run was in, else a new one for the person who answered),
 * and the agent runs on it there and carries on, in the background
 * (`ask.hand-back`, a durable job, once per ask).
 *
 * It stands aside where something else already carries the answer on: an
 * asker that said what each answer does (`ask.outcomes` — the SEO sign-offs),
 * a routine's or a resume gate's own asks, a parked run waiting on it (the
 * resume gate resumes that run), and an automation subscribed to the answer.
 * Only a person's answer is handed back; the trust bar and the deadline's
 * default are not.
 */

import type { DecisionAnswer } from '@/libs/decisions/decision';
import type { Ask } from '@/services/AskService';

/** Where a decision taken in the conversation's own turn came from; that turn already ran the agent. A chip bound to the card is the card's answer. */
const IN_TURN_CHANNELS = new Set(['card', 'composer', 'chat_chip']);

/** Asks whose answer is carried on by their own filer, by source ref. */
const SELF_CONTINUING_PREFIXES = ['routine-', 'resume-gate:', 'seo-page:', 'seo-plan:'];

/** Statuses that are an answer (or a person's choice not to give one). */
const ANSWERED = new Set(['approved', 'rejected', 'done', 'skipped']);

/** The ask fields the hand-back reads. */
export type HandBackAsk = Pick<Ask, 'agentSlug' | 'sourceRef' | 'outcomes'>;

/**
 * Whether an answer to this ask goes back to the agent that filed it — what
 * the sheet says before it is answered. Pure: an agent asked, and nothing of
 * its own already carries the answer on.
 * @param ask - The ask.
 */
export function answerGoesBack(ask: HandBackAsk): boolean {
  if (!ask.agentSlug) {
    return false;
  }
  if (ask.sourceRef && SELF_CONTINUING_PREFIXES.some(p => ask.sourceRef!.startsWith(p))) {
    return false;
  }
  const o = ask.outcomes;
  return !(o && (o.onApprove?.trim() || o.onRevise?.trim() || o.onReject?.trim()));
}

/**
 * Whether a decided ask is handed back now. Pure: the ask as written, and what
 * the caller found about it.
 * @param ask - The decided ask.
 * @param found - What else already carries it on.
 * @param found.parked - A parked run waits on this ask; its gate resumes the run.
 * @param found.subscribed - An automation or workflow on `ask.decided` matches this answer.
 */
export function handsBackNow(ask: HandBackAsk & Pick<Ask, 'status' | 'decidedBy' | 'decidedVia' | 'conversationId'>, found: { parked: boolean; subscribed: boolean }): boolean {
  if (!answerGoesBack(ask) || !ANSWERED.has(ask.status)) {
    return false;
  }
  // A person's answer only: not the trust bar, the deadline's default, an agent or an API token.
  const by = ask.decidedBy ?? '';
  if (!by || by.includes(':') || by === 'trust-ladder' || by === 'by-default') {
    return false;
  }
  // Answered in its own conversation's turn: that turn is the follow-up.
  if (ask.conversationId && IN_TURN_CHANNELS.has(ask.decidedVia ?? '')) {
    return false;
  }
  // Recorded by an agent from the person's own words (`decide_ask`): that
  // agent's turn is running now and says what the answer did.
  if (ask.decidedVia === 'chat') {
    return false;
  }
  return !found.parked && !found.subscribed;
}

/**
 * The answer as the decision event types it.
 * @param ask - The decided ask.
 */
export function answerOf(ask: Pick<Ask, 'status' | 'decision' | 'decisionNote' | 'chosenOptionIds'>): DecisionAnswer {
  if (ask.status === 'skipped') {
    return { kind: 'skip' };
  }
  if (ask.decision === 'other') {
    return { kind: 'free_text', text: ask.decisionNote?.trim() || '(no words given)' };
  }
  return { kind: 'option', optionIds: ask.chosenOptionIds?.length ? ask.chosenOptionIds : [ask.decision ?? 'done'] };
}

/**
 * What the asking agent reads: the typed decision event, the person's note
 * when they added one to an option, and where the question was answered.
 * @param ask - The decided ask.
 * @param where - Where it was answered, in words ("on Needs you").
 */
export async function handBackMessage(ask: Ask, where: string): Promise<string> {
  const { decisionForModel, decisionViewOf } = await import('@/libs/decisions/decision');
  const answer = answerOf(ask);
  const view = decisionViewOf(ask);
  const note = answer.kind === 'option' && ask.decisionNote?.trim() ? `\nTheir note: ${ask.decisionNote.trim()}` : '';
  return `${decisionForModel(view, answer)}${note}\nThey answered ${where}, not in this conversation's turn: carry on with the work it was asked for, and say in a line or two what you did with it.`;
}

/**
 * Where an answer was given, in words.
 * @param via - `ask.decided_via`.
 */
function whereAnswered(via: string | null): string {
  switch (via) {
    case 'slack':
      return 'in Slack';
    case 'email':
      return 'by email';
    case 'needs_you':
    case null:
    case undefined:
      return 'on Needs you';
    default:
      return `from ${via.replace(/_/g, ' ')}`;
  }
}

/**
 * The run that filed an ask through the action rail (`ask.file`), and where
 * it came up: the conversation or mission run its filing named.
 * @param orgId - The workspace.
 * @param askId - The ask.
 */
async function filingOrigin(orgId: string, askId: number): Promise<{ conversationId: number | null; missionRunId: number | null; missionSlug: string | null }> {
  const { and, desc, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const [row] = await db.select({ result: actionRunSchema.result })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.actionId, 'ask.file'), sql`(${actionRunSchema.result} ->> 'askId')::int = ${askId}`))
    .orderBy(desc(actionRunSchema.id))
    .limit(1)
    .catch(() => []);
  const result = (row?.result ?? {}) as { origin?: { conversationId?: unknown; missionRunId?: unknown } | null; missionSlug?: unknown };
  const id = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
  return {
    conversationId: id(result.origin?.conversationId),
    missionRunId: id(result.origin?.missionRunId),
    missionSlug: typeof result.missionSlug === 'string' && result.missionSlug ? result.missionSlug : null,
  };
}

/**
 * Whether a parked run is waiting on this ask (its gate resumes the run).
 * @param ask - The ask.
 */
async function parkedOn(ask: Ask): Promise<boolean> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { resumeGateSchema } = await import('@/models/Schema');
  const rows = await db.select({ id: resumeGateSchema.id })
    .from(resumeGateSchema)
    .where(and(eq(resumeGateSchema.orgId, ask.orgId), eq(resumeGateSchema.status, 'parked'), sql`${resumeGateSchema.waitingOn} @> ${JSON.stringify([ask.id])}::jsonb`))
    .limit(1)
    .catch(() => []);
  return rows.length > 0;
}

/**
 * Whether an automation or workflow on `ask.decided` matches this answer.
 * @param ask - The decided ask.
 */
async function subscribedTo(ask: Ask): Promise<boolean> {
  if (!ask.decision) {
    return false;
  }
  const { loadAnswerListeners } = await import('./answerListeners');
  const listeners = await loadAnswerListeners(ask.orgId, [ask]).catch(() => new Map<number, Record<string, string[]>>());
  return (listeners.get(ask.id)?.[ask.decision] ?? []).length > 0;
}

/** What the hand-back job carries. */
export type HandBackInput = { orgId: string; askId: number };

/**
 * After an ask settles: when its answer goes back to the agent that asked,
 * start the follow-up turn in the background. Never throws: the answer is
 * already written.
 * @param ask - The ask as written.
 * @param start - Starts the job (tests).
 */
export async function handBackAnswer(ask: Ask, start?: (input: HandBackInput) => Promise<unknown>): Promise<boolean> {
  try {
    if (!answerGoesBack(ask) || !ANSWERED.has(ask.status)) {
      return false;
    }
    const [parked, subscribed] = await Promise.all([parkedOn(ask), subscribedTo(ask)]);
    if (!handsBackNow(ask, { parked, subscribed })) {
      return false;
    }
    const input: HandBackInput = { orgId: ask.orgId, askId: ask.id };
    if (start) {
      await start(input);
      return true;
    }
    const { startJob } = await import('@/libs/durable/jobs');
    const { JOB } = await import('@/services/background/catalog');
    await startJob(`ask-hand-back:${ask.orgId}:${ask.id}`, { job: JOB.askHandBack, input });
    return true;
  } catch (err) {
    const { logger } = await import('@/libs/Logger');
    logger.warn('an answer could not be handed back to the agent that asked', { askId: ask.id, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * The follow-up turn itself: the decision event written into the asking
 * agent's conversation, then the agent run on it there, its reply kept.
 * @param input - The ask.
 */
export async function runHandBack(input: HandBackInput): Promise<{ conversationId: number | null; said: boolean; why?: string }> {
  const { getAsk } = await import('@/services/AskService');
  const ask = await getAsk(input.orgId, input.askId);
  if (!ask || !ask.agentSlug || !ask.decidedBy) {
    return { conversationId: null, said: false, why: 'no such answered ask' };
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');
  const [agent] = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(and(eq(agentSchema.orgId, ask.orgId), eq(agentSchema.slug, ask.agentSlug))).limit(1);
  if (!agent) {
    return { conversationId: null, said: false, why: `${ask.agentSlug} is not an agent in this workspace` };
  }
  const { appendMessage, createConversation, getConversation, listMessages, toHistoryTurns } = await import('@/services/ConversationService');
  const origin = await filingOrigin(ask.orgId, ask.id);
  let conversationId = ask.conversationId ?? origin.conversationId;
  if (conversationId && !(await getConversation({ orgId: ask.orgId, id: conversationId }))) {
    conversationId = null;
  }
  if (!conversationId) {
    // Asked from a mission or an automation: the answer opens a conversation
    // with the agent, for the person who gave it, so what it did is readable.
    const created = await createConversation({ orgId: ask.orgId, agentSlug: ask.agentSlug, createdBy: ask.decidedBy, initialTitle: ask.title.slice(0, 120), titleSource: 'person' });
    conversationId = created.id;
  }
  const message = await handBackMessage(ask, whereAnswered(ask.decidedVia));
  const answer = answerOf(ask);
  const { answerLine, decisionViewOf } = await import('@/libs/decisions/decision');
  const view = decisionViewOf(ask);
  const history = toHistoryTurns(await listMessages({ orgId: ask.orgId, conversationId }));
  await appendMessage({
    orgId: ask.orgId,
    conversationId,
    role: 'decision',
    content: message,
    runs: [{ type: 'decision_answer', id: ask.id, question: ask.title, answer, line: answerLine(view, answer), via: ask.decidedVia ?? 'needs_you' }],
  });
  const { runAgentDeep } = await import('@/services/AgentService');
  const { withRunCost } = await import('@/services/budget/runCost');
  try {
    const { cost, result } = await withRunCost({ conversationId }, async scope => ({
      cost: scope,
      result: await runAgentDeep({
        orgId: ask.orgId,
        agentSlug: ask.agentSlug!,
        message,
        userId: ask.decidedBy!,
        conversationId: conversationId!,
        conversationHistory: history,
        ...(origin.missionSlug ? { missionSlug: origin.missionSlug } : {}),
        ...(origin.missionRunId ? { missionRunId: origin.missionRunId } : {}),
      }),
    }));
    const text = (result.response ?? '').trim();
    await appendMessage({ orgId: ask.orgId, conversationId, role: 'assistant', content: text || 'Read your answer.', status: text ? 'complete' : 'stalled', agentSlug: ask.agentSlug, cost: { tokens: cost.tokens, microCents: cost.microCents } });
    return { conversationId, said: true };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    // Said where the person reads it, never silent; not retried, since the answer is already written there.
    await appendMessage({ orgId: ask.orgId, conversationId, role: 'assistant', content: '', status: 'failed', statusReason: `Your answer reached ${ask.agentSlug}, but its turn on it failed: ${why}`.slice(0, 500), agentSlug: ask.agentSlug }).catch(() => undefined);
    return { conversationId, said: false, why };
  }
}
