/**
 * APPROVAL BY A REPLY IN THE THREAD (backlog 057, gap 5; Chris, 2026-10-04:
 * "Wait for approval (app or slack) then deploy to prod"). A card Vocion
 * put in front of a person for work that came from a Slack thread can be
 * decided by a reply in that thread — "ship it", "approve", "hold" — the same
 * as pressing it in the app.
 *
 * Two readings guard it, and neither is a word match:
 *   1. CONSENT is a model's reading of the person's own words against the
 *      card's decision sentence (`turnJudge.saidToDecide`), the same read a
 *      decide tool uses in chat (accelerate-never-block 1 and 4).
 *   2. IDENTITY: a Slack user id authorises nothing (decision 025). The reply
 *      runs as the Vocion member whose email is on the Slack profile
 *      (`users.info`, `users:read.email`). No match, and the thread is told
 *      what to do, in one line; nothing is decided.
 *
 * Anything else — no card waiting, words that are not consent — falls through
 * to the ordinary turn, which still sees the thread.
 */
import type { ChatInbound } from '@/libs/surfaces/types';
import process from 'node:process';

/** A card waiting on a person, as this reads it. */
export type PendingCard = { runId: number; actionId: string; input: Record<string, unknown>; title: string };

export type ThreadApprovalDeps = {
  /** Cards still pending whose origin is this conversation, newest first. */
  pending: (orgId: string, conversationId: number) => Promise<PendingCard[]>;
  /** The card's decision as one sentence, for the consent read. */
  decisionSentence: (orgId: string, card: PendingCard, verb: 'approve' | 'reject') => Promise<string>;
  /** The model's reading of the person's words against that sentence. */
  consent: (orgId: string, words: string, decision: string) => Promise<{ said: boolean; quote: string | null }>;
  /** The Vocion member behind the Slack user, by the email on their profile. */
  member: (orgId: string, externalUserId: string) => Promise<{ userId: string; name: string; email: string } | { userId: null; email: string | null }>;
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
      const who = await deps.member(orgId, inbound.externalUserId);
      if (who.userId === null) {
        const email = who.email ? `the email on your Slack profile (${who.email})` : 'the email on your Slack profile, which Vocion cannot read';
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
  async pending(orgId, conversationId) {
    const { db } = await import('@/libs/DB');
    const { and, desc, eq, sql } = await import('drizzle-orm');
    const { actionRunSchema } = await import('@/models/Schema');
    const rows = await db
      .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending'), sql`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId' = ${String(conversationId)}`))
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
  async member(orgId, externalUserId) {
    const { slackUserEmail } = await import('@/libs/surfaces/slackRead');
    const email = await slackUserEmail(externalUserId, process.env.SLACK_BOT_TOKEN).catch(() => null);
    if (!email) {
      return { userId: null, email: null };
    }
    const { db } = await import('@/libs/DB');
    const { eq } = await import('drizzle-orm');
    const { projectSchema } = await import('@/models/Schema');
    const [project] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    if (!project) {
      return { userId: null, email };
    }
    const { listMembers } = await import('@/services/MembersService');
    const hit = (await listMembers(project.accountId)).find(m => m.email.trim().toLowerCase() === email);
    return hit ? { userId: hit.userId, name: hit.name?.trim() || hit.email, email } : { userId: null, email };
  },
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
