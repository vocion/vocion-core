/**
 * APPROVAL BY A REPLY IN THE THREAD, ON ANY MEDIUM (backlog 057, gap 5; Chris, 2026-10-04:
 * "Wait for approval (app or slack) then deploy to prod"). A card Vocion
 * put in front of a person for work that came from a Slack thread can be
 * decided by a reply in that thread — "ship it", "approve", "hold" — the same
 * as pressing it in the app.
 *
 * Two readings guard it, and neither is a word match:
 *   1. CONSENT is a model's reading of the person's own words against the
 *      card's decision sentence (`turnJudge.saidToDecide`), the same read a
 *      decide tool uses in chat (accelerate-never-block 1 and 4).
 *   2. IDENTITY: a sender's id on a medium authorises nothing (decision 025).
 *      The reply runs as the Vocion member the medium's channel resolves the
 *      sender to (`conversationChannel.ts`: Slack by the email on the profile,
 *      email by the address written from). No match, and the thread is told
 *      what to do, in one line; nothing is decided.
 *
 * Anything else — no card waiting, words that are not consent — falls through
 * to the ordinary turn, which still sees the thread.
 *
 * A REPLY SETTLES ONLY THE ASK IT ANSWERS (2026-11-11). A thread shows no card, so
 * the only ask a person can be answering is the one in the agent's latest message.
 * A proposal filed before that (the person has written since, or the agent has said
 * something else since) is stale: its words describe a moment that has passed, and
 * running it on a later "approve" applies an old decision to whatever is there now.
 * A stale proposal is never run from a reply, and one the agent filed in this
 * conversation is withdrawn, so it cannot be run later from a queue either.
 *
 * What was settled is handed to the turn that follows (`settledNote`), which
 * answers in the agent's own words and does whatever else the message asked.
 */
import type { ChatInbound } from '@/libs/surfaces/types';
import { shortTitle } from '@/libs/actions/mcpCard';
import { channelBySurface } from './channels';

/** A card waiting on a person, as this reads it. */
export type PendingCard = {
  runId: number;
  actionId: string;
  input: Record<string, unknown>;
  title: string;
  /** When it was filed. Unknown reads as current. */
  createdAt?: Date;
  /** Filed from this conversation (not only about a record it follows). */
  filedHere?: boolean;
  /** `action_run.invoked_by`: who filed it. */
  filedBy?: string | null;
};

/** One message already in the thread's conversation, before the reply being read. */
export type ThreadTurn = { role: string; createdAt?: Date | string | null };

export type ThreadApprovalDeps = {
  /** Cards still pending whose origin is this conversation, newest first. */
  pending: (orgId: string, conversationId: number, recordId?: number) => Promise<PendingCard[]>;
  /** The card's decision as one sentence, for the consent read. */
  decisionSentence: (orgId: string, card: PendingCard, verb: 'approve' | 'reject') => Promise<string>;
  /** The model's reading of the person's words against that sentence. */
  consent: (orgId: string, words: string, decision: string, asked?: string | null) => Promise<{ said: boolean; quote: string | null }>;
  /** The Vocion member behind the sender, as the medium knows them (`conversationChannel.ts`). */
  member: (orgId: string, externalUserId: string, surface: string) => Promise<{ userId: string; name: string; email: string } | { userId: null; email: string | null }>;
  /** How a sender on this medium becomes someone Vocion knows. */
  signInHint: (surface: string, email: string | null) => string;
  /** Decide the card as that member. `result` is what the run returned, when it ran. */
  decide: (orgId: string, runId: number, verb: 'approve' | 'reject', by: string, note: string | null) => Promise<{ ok: boolean; what: string; result?: string }>;
  /** Take back a stale proposal the agent filed here. True when it was withdrawn. */
  withdraw: (orgId: string, card: PendingCard, reason: string) => Promise<boolean>;
};

export type ThreadApproval
  = | { decided: true; verb: 'approve' | 'reject'; runId: number; title: string; reply: string; result?: string; withdrawn?: PendingCard[] }
    | { decided: false; reply: string; withdrawn?: PendingCard[] }
    /** Nothing was read as a decision; stale proposals were withdrawn. */
    | { decided: false; reply: null; withdrawn: PendingCard[] }
    | null;

/** Why a stale proposal is withdrawn, as its note reads in Review. */
export const STALE_REASON = 'the thread moved on before it was decided, so what it asked for may no longer be what is wanted';

/**
 * What a person reads a proposal as: its title, else its summary's first
 * sentence (any action whose payload carries one), else the action and run.
 * @param actionId - The action.
 * @param runId - The run.
 * @param input - Its payload.
 */
export function cardTitle(actionId: string, runId: number, input: Record<string, unknown> | null | undefined): string {
  if (typeof input?.title === 'string' && input.title.trim()) {
    return input.title;
  }
  if (typeof input?.summary === 'string' && input.summary.trim()) {
    return shortTitle(input.summary);
  }
  return `${actionId} #${runId}`;
}

/**
 * Is this card the ask in the agent's latest message? It is when nothing a
 * person wrote, and at most one thing the agent said (the message that asked),
 * came after it was filed.
 * @param card - The pending card.
 * @param said - The conversation before the reply being read.
 */
export function askedInLastMessage(card: PendingCard, said: readonly ThreadTurn[]): boolean {
  const filed = card.createdAt?.getTime();
  if (filed === undefined) {
    return true;
  }
  const after = said.filter(m => m.createdAt && new Date(m.createdAt).getTime() > filed);
  return !after.some(m => m.role === 'user') && after.filter(m => m.role === 'assistant').length <= 1;
}

/**
 * Read the reply against the cards waiting in this thread. Null when there is
 * nothing to decide or the words do not say to decide it, and nothing stale
 * was withdrawn.
 * @param orgId - The workspace.
 * @param inbound - The reply.
 * @param conversationId - The thread's conversation.
 * @param deps - Seams.
 * @param asked - The agent's last message in the thread: the ask a short reply ("yes") answers. A thread shows no card, so the ask is those words.
 * @param said - The conversation before this reply. A card filed before the agent's latest message is stale: never run from here, and withdrawn when the agent filed it here. Omitted, every card reads as current.
 */
export async function approvalFromThread(orgId: string, inbound: ChatInbound, conversationId: number, deps: ThreadApprovalDeps, asked?: string | null, said?: readonly ThreadTurn[]): Promise<ThreadApproval> {
  const waiting = await deps.pending(orgId, conversationId);
  const withdrawn: PendingCard[] = [];
  const cards: PendingCard[] = [];
  for (const card of waiting) {
    if (!said || askedInLastMessage(card, said)) {
      cards.push(card);
    } else if (card.filedHere && card.filedBy?.startsWith('agent:') && await deps.withdraw(orgId, card, STALE_REASON).catch(() => false)) {
      withdrawn.push(card);
    }
  }
  const also = withdrawn.length > 0 ? { withdrawn } : {};
  for (const card of cards.slice(0, 3)) {
    for (const verb of ['approve', 'reject'] as const) {
      const decision = await deps.decisionSentence(orgId, card, verb);
      const read = await deps.consent(orgId, inbound.text, decision, asked);
      if (!read.said) {
        continue;
      }
      const who = await deps.member(orgId, inbound.externalUserId, inbound.surface);
      if (who.userId === null) {
        const email = deps.signInHint(inbound.surface, who.email);
        return { decided: false, reply: `I read that as ${verb === 'approve' ? 'approval' : 'a hold'} for "${card.title}", but a decision has to come from someone Vocion knows. Sign in to Vocion with ${email}, or decide it in Vocion, and it runs as yours.`, ...also };
      }
      const out = await deps.decide(orgId, card.runId, verb, who.userId, read.quote);
      const reply = out.ok
        ? `${verb === 'approve' ? 'Approved' : 'Held'} by ${who.name}: "${card.title}". ${out.what}`.trim()
        : `I read that as ${verb === 'approve' ? 'approval' : 'a hold'} for "${card.title}" from ${who.name}, but it could not be decided: ${out.what}`;
      return out.ok
        ? { decided: true, verb, runId: card.runId, title: card.title, reply, ...(out.result ? { result: out.result } : {}), ...also }
        : { decided: false, reply, ...also };
    }
  }
  return withdrawn.length > 0 ? { decided: false, reply: null, withdrawn } : null;
}

/**
 * What the turn after a reply is told, so the agent neither repeats what was
 * just settled on the person's word nor asks for it again, and still does
 * whatever else the message says. Facts only; the words to the person are the
 * agent's own.
 * @param approval - What the reply settled.
 */
export function settledNote(approval: ThreadApproval): string {
  if (!approval) {
    return '';
  }
  const lines: string[] = [];
  if (approval.decided) {
    lines.push(
      `Their message was read as ${approval.verb === 'approve' ? 'approval of' : 'a hold on'} proposal #${approval.runId}, "${approval.title}", and that was settled as theirs before this turn began: ${approval.reply}`,
      ...(approval.result ? [`What it returned: ${approval.result}`] : []),
      'Do not run it, propose it or ask about it again. Say in one line what was done, then do everything else their message asks. If it asks nothing else, that line is your whole reply.',
    );
  } else if (approval.reply) {
    lines.push(`Their message was read as a decision, and it was NOT settled: ${approval.reply}`, 'Tell them so in one line, then do everything else their message asks.');
  }
  if (approval.withdrawn?.length) {
    lines.push(
      `Withdrawn before this turn, and NOT run, because the thread moved on after you asked: ${approval.withdrawn.map(c => `proposal #${c.runId} "${c.title}"`).join('; ')}.`,
      'If their message asks for what one of these did, read how things stand now and act on that; never assume the old proposal still fits.',
    );
  }
  return lines.length > 0 ? `\n\n--- what was already settled from this message ---\n${lines.join('\n')}` : '';
}

export const defaultThreadApprovalDeps: ThreadApprovalDeps = {
  async pending(orgId, conversationId, recordId) {
    const { db } = await import('@/libs/DB');
    const { and, desc, eq, or, sql } = await import('drizzle-orm');
    const { actionRunSchema, businessObjectSchema } = await import('@/models/Schema');
    // Cards this conversation filed, and cards about a record it follows (FE-133: the plan card
    // the factory filed after a Build from the thread could not be decided from the thread).
    const followed = sql`(${actionRunSchema.input} ->> 'requestId' in (select ${businessObjectSchema.id}::text from ${businessObjectSchema} where ${businessObjectSchema.orgId} = ${orgId} and ${businessObjectSchema.metadata} -> 'followConversations' @> ${JSON.stringify([conversationId])}::jsonb)
      or ${actionRunSchema.input} ->> 'planId' in (select p.id::text from ${businessObjectSchema} p join ${businessObjectSchema} r on r.id::text = p.metadata ->> 'requestId' and r.org_id = p.org_id where p.org_id = ${orgId} and r.metadata -> 'followConversations' @> ${JSON.stringify([conversationId])}::jsonb))`;
    const about = recordId ? sql`(${actionRunSchema.input} ->> 'requestId' = ${String(recordId)} or ${actionRunSchema.input} ->> 'planId' in (select ${businessObjectSchema.id}::text from ${businessObjectSchema} where ${businessObjectSchema.orgId} = ${orgId} and ${businessObjectSchema.metadata} ->> 'requestId' = ${String(recordId)}))` : null;
    const rows = await db
      .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input, createdAt: actionRunSchema.createdAt, invokedBy: actionRunSchema.invokedBy, origin: sql<string | null>`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId'` })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending'), or(sql`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId' = ${String(conversationId)}`, followed), ...(about ? [about] : [])))
      .orderBy(desc(actionRunSchema.id))
      .limit(5);
    return rows.map(r => ({ runId: r.id, actionId: r.actionId, input: r.input ?? {}, title: cardTitle(r.actionId, r.id, r.input), createdAt: r.createdAt, filedHere: r.origin === String(conversationId), filedBy: r.invokedBy }));
  },
  async decisionSentence(orgId, card, verb) {
    const { consentDecision } = await import('@/services/agents/consentDecision');
    return `${verb} proposal #${card.runId}: ${await consentDecision(orgId, card.actionId, card.input, card.title)}`;
  },
  async consent(orgId, words, decision, asked) {
    const { saidToDecide } = await import('@/services/agents/turnJudge');
    return saidToDecide({ orgId, messages: [words], decision, ...(asked ? { asked } : {}) });
  },
  async member(orgId, externalUserId, surface) {
    const channel = channelBySurface(surface);
    return channel ? channel.memberOf(orgId, externalUserId) : { userId: null, email: null };
  },
  signInHint: (surface, email) => channelBySurface(surface)?.signInHint(email) ?? (email ? `the email ${email}` : 'your email'),
  async decide(orgId, runId, verb, by, note) {
    const { decide } = await import('@/services/ReviewService');
    try {
      const res = await decide({ kind: 'action', id: runId }, verb, orgId, { reviewedBy: by, ...(note ? { note } : {}) });
      const status = res.execution?.status;
      const stale = res.execution?.stale;
      if (stale && (status === 'stale' || status === 'pending')) {
        return { ok: false, what: `Not run: ${stale.line}. It is still waiting in Vocion, where you can run it anyway or have it redrafted.` };
      }
      const what = verb === 'reject'
        ? 'It is held; the work goes back with your words as the note.'
        : status === 'done'
          ? 'It ran; Undo is in Vocion.'
          : status === 'awaiting_execution'
            ? 'It is approved and handed to whoever runs it.'
            : status === 'failed'
              ? `It was approved but failed to run: ${res.execution?.error ?? 'no reason recorded'}.`
              : 'It is approved.';
      const returned = verb === 'approve' && status === 'done' && res.execution?.result ? JSON.stringify(res.execution.result).slice(0, 800) : '';
      return { ok: status !== 'failed', what, ...(returned ? { result: returned } : {}) };
    } catch (err) {
      return { ok: false, what: (err as Error).message };
    }
  },
  async withdraw(orgId, card, reason) {
    const { withdrawProposal } = await import('@/services/proposals/ProposalBudgetService');
    const out = await withdrawProposal({ orgId, agentSlug: (card.filedBy ?? '').replace(/^agent:/, ''), kind: 'run', id: card.runId, reason });
    return out.ok;
  },
};
