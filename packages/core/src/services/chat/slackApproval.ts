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
 */
import type { ChatInbound } from '@/libs/surfaces/types';
import { channelBySurface } from './channels';

/** A card waiting on a person, as this reads it. */
export type PendingCard = { runId: number; actionId: string; input: Record<string, unknown>; title: string };

export type ThreadApprovalDeps = {
  /** Cards still pending whose origin is this conversation, newest first. */
  pending: (orgId: string, conversationId: number, recordId?: number) => Promise<PendingCard[]>;
  /** The card's decision as one sentence, for the consent read. */
  decisionSentence: (orgId: string, card: PendingCard, verb: 'approve' | 'reject') => Promise<string>;
  /** The model's reading of the person's words against that sentence. */
  consent: (orgId: string, words: string, decision: string) => Promise<{ said: boolean; quote: string | null }>;
  /** The Vocion member behind the sender, as the medium knows them (`conversationChannel.ts`). */
  member: (orgId: string, externalUserId: string, surface: string) => Promise<{ userId: string; name: string; email: string } | { userId: null; email: string | null }>;
  /** How a sender on this medium becomes someone Vocion knows. */
  signInHint: (surface: string, email: string | null) => string;
  /** Decide the card as that member. */
  decide: (orgId: string, runId: number, verb: 'approve' | 'reject', by: string, note: string | null) => Promise<{ ok: boolean; what: string }>;
};

export type ThreadApproval
  = | { decided: true; verb: 'approve' | 'reject'; runId: number; reply: string }
    | { decided: false; reply: string }
    | null;

/**
 * Read the reply against the cards waiting in this thread. Null when there is
 * nothing to decide or the words do not say to decide it.
 * @param orgId - The workspace.
 * @param inbound - The reply.
 * @param conversationId - The thread's conversation.
 * @param deps - Seams.
 */
export async function approvalFromThread(orgId: string, inbound: ChatInbound, conversationId: number, deps: ThreadApprovalDeps): Promise<ThreadApproval> {
  const cards = (await deps.pending(orgId, conversationId)).slice(0, 3);
  if (cards.length === 0) {
    return null;
  }
  for (const card of cards) {
    for (const verb of ['approve', 'reject'] as const) {
      const decision = await deps.decisionSentence(orgId, card, verb);
      const read = await deps.consent(orgId, inbound.text, decision);
      if (!read.said) {
        continue;
      }
      const who = await deps.member(orgId, inbound.externalUserId, inbound.surface);
      if (who.userId === null) {
        const email = deps.signInHint(inbound.surface, who.email);
        return { decided: false, reply: `I read that as ${verb === 'approve' ? 'approval' : 'a hold'} for "${card.title}", but a decision has to come from someone Vocion knows. Sign in to Vocion with ${email}, or decide it in Vocion, and it runs as yours.` };
      }
      const out = await deps.decide(orgId, card.runId, verb, who.userId, read.quote);
      const reply = out.ok
        ? `${verb === 'approve' ? 'Approved' : 'Held'} by ${who.name}: "${card.title}". ${out.what}`.trim()
        : `I read that as ${verb === 'approve' ? 'approval' : 'a hold'} for "${card.title}" from ${who.name}, but it could not be decided: ${out.what}`;
      return { decided: out.ok, verb, runId: card.runId, reply };
    }
  }
  return null;
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
      .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending'), or(sql`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId' = ${String(conversationId)}`, followed), ...(about ? [about] : [])))
      .orderBy(desc(actionRunSchema.id))
      .limit(5);
    return rows.map(r => ({ runId: r.id, actionId: r.actionId, input: r.input ?? {}, title: typeof r.input?.title === 'string' ? r.input.title : `${r.actionId} #${r.id}` }));
  },
  async decisionSentence(orgId, card, verb) {
    const { consentDecision } = await import('@/services/agents/consentDecision');
    return `${verb} proposal #${card.runId}: ${await consentDecision(orgId, card.actionId, card.input, card.title)}`;
  },
  async consent(orgId, words, decision) {
    const { saidToDecide } = await import('@/services/agents/turnJudge');
    return saidToDecide({ orgId, messages: [words], decision });
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
      const what = verb === 'reject'
        ? 'It is held; the work goes back with your words as the note.'
        : status === 'done'
          ? 'It ran; Undo is in Vocion.'
          : status === 'awaiting_execution'
            ? 'It is approved and handed to whoever runs it.'
            : status === 'failed'
              ? `It was approved but failed to run: ${res.execution?.error ?? 'no reason recorded'}.`
              : 'It is approved.';
      return { ok: status !== 'failed', what };
    } catch (err) {
      return { ok: false, what: (err as Error).message };
    }
  },
};
