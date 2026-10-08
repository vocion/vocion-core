/**
 * THE PERSON ASKING IS THE OWNER (backlog 044).
 *
 * Conversation 392, turn 2 (2026-09-30): the product manager filed "Merge PR
 * #127: engineering owner's call" — an ask routing the merge to "the owner" —
 * to the person who owned it and was talking to it. And the "Stuck?" on #269
 * ended on "I'll bring you the merge card", though merges of that class now
 * run themselves on their trust rule once QA approves (backlog 042).
 *
 * Who holds a decision is a fact the records answer, so the ask and card
 * tools answer it rather than a line in a prompt:
 *
 *   - An ask filed in a person's own turn is decided by that person: any
 *     person in the workspace decides an ask (asks carry no addressee), and
 *     this one is here. It is asked HERE, as a Decision docked above their
 *     composer, never routed to "the owner" — and what they answer runs as
 *     theirs. Unless they said to put it on the queue (a model's reading of
 *     their words, `saidToDecide`), or it is a credential, whose value must
 *     never travel through the chat.
 *   - A merge whose trust rule runs within bounds has no one to ask, in any
 *     turn: it merges on its own once QA approves. A merge already recorded
 *     merged has nothing left to decide.
 *
 * The facts are the feature report's own (`libs/factory/workFacts.ts`), read
 * off the record the ask names, so what the tool says matches the page.
 * Nothing here reads the ask's words; it routes on the ask's kind, the
 * records it names and who is in the turn. It never fails the filing: a
 * check that cannot read files as before.
 */

import type { RuntimeContext } from './types';
import type { WorkFacts } from '@/libs/factory/workFacts';
import { isAgentsOwnSchedule } from '@/services/proposals/ProposalBudgetService';

/** What an ask or a card is about, as the tool received it. */
export type DecisionSubject = {
  /** The ask's kind (`merge`, `ruling` …), when it is an ask. */
  kind?: string | null;
  title: string;
  /** The records it names. */
  objectRefs?: ReadonlyArray<{ type: string; id: string | number }>;
};

/** The feature the decision is about, with its facts and its page. */
type Subject = { facts: WorkFacts; href: string; title: string };

/**
 * Is this the person's own turn — a person in a conversation, not an agent on
 * its schedule, not an outside client acting for its holder?
 * @param ctx - The turn.
 */
export function personIsHere(ctx: Pick<RuntimeContext, 'userId' | 'conversationId' | 'missionRunId'>): boolean {
  // An outside client acting with a workspace token is its holder acting on
  // purpose; what it files, it meant to file.
  return !!ctx.userId && !ctx.userId.startsWith('token:') && !isAgentsOwnSchedule(ctx);
}

/**
 * The feature the decision is about: the first named record with a status,
 * or the request a named task serves.
 * @param orgId - Tenant.
 * @param refs - The records the ask names.
 */
async function subjectOf(orgId: string, refs: DecisionSubject['objectRefs']): Promise<Subject | null> {
  const { loadRecordStatus } = await import('@/services/objects/recordStatus');
  for (const ref of (refs ?? []).slice(0, 3)) {
    const id = Number(ref.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      continue;
    }
    let read = await loadRecordStatus(orgId, id);
    if (!read.ok) {
      // A task names the request it serves; the status is the request's.
      const { getBusinessObject } = await import('@/services/BusinessObjectService');
      const row = await getBusinessObject(id, orgId);
      const parent = Number(((row?.metadata ?? {}) as Record<string, unknown>).requestId);
      if (Number.isSafeInteger(parent) && parent > 0) {
        read = await loadRecordStatus(orgId, parent);
      }
    }
    if (read.ok && read.status.facts) {
      return { facts: read.status.facts, href: read.status.record.href, title: read.status.record.title };
    }
  }
  return null;
}

/**
 * The person in the turn, by name, for the refusal to address.
 * @param userId - Their id.
 */
async function personName(userId: string): Promise<string | null> {
  try {
    const { eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { userSchema } = await import('@/models/Schema');
    const [row] = await db.select({ name: userSchema.name, email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
    return row?.name?.trim() || row?.email || null;
  } catch {
    return null;
  }
}

/**
 * What the facts say about a merge of this work, in one sentence, or null
 * when there is no pull request to merge.
 * @param f - The feature's facts.
 */
function mergeSentence(f: WorkFacts): string | null {
  if (f.pullRequest.merge === 'no_pull_request') {
    return null;
  }
  if (f.pullRequest.merge === 'merged') {
    return `${f.pullRequest.line}: there is no merge left to decide.`;
  }
  if (f.verdict.value !== 'approve') {
    return `${f.verdict.line}; ${f.ci.line}; ${f.pullRequest.line}. It does not merge before QA approves it${f.mergeRule.runsItself === true ? ', and then it merges on its own on its trust rule' : ''}.`;
  }
  return `${f.verdict.line}; ${f.mergeRule.line}.`;
}

/**
 * A merge ask with nothing to route: its trust rule merges it on its own, or
 * it already merged. Applies in every turn — nobody is waited on for it.
 * @param f - The feature's facts.
 */
function mootMerge(f: WorkFacts): string | null {
  if (f.pullRequest.merge === 'merged') {
    return `Not filed: ${f.pullRequest.line}, so there is no merge to ask anyone about. Say it merged; whether it is live is ${f.shipped ? 'recorded' : 'not recorded yet'}.`;
  }
  if (f.mergeRule.runsItself === true) {
    return `Not filed: ${f.mergeRule.line}. Nobody decides this merge, so there is no one to route it to. ${f.verdict.line}; ${f.ci.line}. Say it merges on its own once QA approves it — never that a merge card is coming.`;
  }
  return null;
}

/**
 * Who holds an ask, as a verdict the tool routes on:
 *
 *   - `moot`  nobody: a merge that runs itself on its trust rule, or one that
 *             already merged. Filed nowhere, in any turn; `message` says why.
 *   - `here`  the person in this conversation. It is asked HERE, as a
 *             Decision docked above their composer, and their answer comes
 *             back to the asking agent as a typed event
 *             (`services/decisions/DecisionService.ts`). Never "ask them in
 *             one line": a question in prose is answered in prose, re-read by
 *             the router and the intent judge, and bound to nothing.
 *   - null    file it on Needs you, as before — a credential (its value must
 *             never travel through the chat), a turn with nobody in it, or a
 *             person who said to put it on the queue.
 * @param ctx - The turn.
 * @param ask - The ask.
 */
export async function whoHoldsTheAsk(ctx: RuntimeContext, ask: DecisionSubject): Promise<HeldVerdict | null> {
  try {
    const kind = ask.kind ?? 'approval';
    const here = personIsHere(ctx);
    if (kind === 'credential' || (!here && kind !== 'merge')) {
      return null;
    }
    const subject = await subjectOf(ctx.orgId, ask.objectRefs);
    if (kind === 'merge' && subject) {
      const moot = mootMerge(subject.facts);
      if (moot) {
        return { held: 'moot', message: moot };
      }
    }
    if (!here) {
      return null;
    }
    // THE PERSON'S WORD RUNS: asked to put it on the queue, it goes on the queue.
    const { personSaidToDecide } = await import('./owedDecision');
    const consent = await personSaidToDecide(ctx, `file a question on the Needs you queue, to be answered later: "${ask.title}"`).catch(() => ({ said: false }));
    if (consent.said) {
      return null;
    }
    return {
      held: 'here',
      name: await personName(ctx.userId!),
      href: subject?.href ?? null,
      about: subject?.title ?? null,
      merge: subject ? mergeSentence(subject.facts) : null,
      docked: await inTheApp(ctx),
    };
  } catch (err) {
    console.warn('decision holder check failed', { orgId: ctx.orgId, message: (err as Error).message });
    return null;
  }
}

/** Who holds an ask — see {@link whoHoldsTheAsk}. */
export type HeldVerdict
  = | { held: 'moot'; message: string }
    /** `docked`: the conversation lives in the app, where a Decision docks above the composer. */
    | { held: 'here'; name: string | null; href: string | null; about: string | null; merge: string | null; docked: boolean };

/**
 * Whether this turn's conversation is read in the app, where a Decision docks
 * above the composer — not a Slack or email thread, which reads only words
 * (`conversation.surface`). Unknown reads as the app.
 * @param ctx - The turn.
 */
async function inTheApp(ctx: Pick<RuntimeContext, 'orgId' | 'conversationId'>): Promise<boolean> {
  if (!ctx.conversationId) {
    return false;
  }
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { conversationSchema } = await import('@/models/Schema');
    const [row] = await db.select({ surface: conversationSchema.surface }).from(conversationSchema).where(and(eq(conversationSchema.orgId, ctx.orgId), eq(conversationSchema.id, ctx.conversationId))).limit(1);
    return (row?.surface ?? 'app') === 'app';
  } catch {
    return true;
  }
}

/**
 * The words for a decision the person here holds, in a thread that reads only
 * words (Slack, email): ask them in one line, with the recommendation.
 * @param held - Who holds it.
 */
export function askInWords(held: Extract<HeldVerdict, { held: 'here' }>): string {
  const who = held.name ? `${held.name} is` : 'The person you are talking to is';
  const about = held.about ? ` about ${held.about}` : '';
  return [
    `Not filed: ${who} in this conversation, and this decision${about} is theirs — any person in the workspace decides an ask, and they are the one asking. Do not route it to "the owner" or an engineering owner; there is no one else to route it to.`,
    `Ask them here, in one line, with your recommendation, numbering the choices.${held.href ? ` Give them the link: ${held.href}` : ''}`,
    held.merge ? `What the records say: ${held.merge}` : null,
    'What they answer runs as theirs: a proposal with decide_proposal, an open ask with decide_ask, anything else as the action itself.',
  ].filter(Boolean).join(' ');
}

/**
 * The refusal for a merge card nobody needs to press: its class merges on its
 * own once QA approves. Null to show the card.
 * @param ctx - The turn.
 * @param riskClass - The card's class.
 */
export async function mergeCardRunsItself(ctx: Pick<RuntimeContext, 'orgId'>, riskClass: string): Promise<string | null> {
  try {
    const { mergeRuleFact } = await import('@/libs/factory/workFacts');
    const { mergeRunsItself } = await import('@/services/factory/pullSignals');
    const rule = mergeRuleFact(await mergeRunsItself(ctx.orgId, riskClass), riskClass);
    return rule.runsItself === true
      ? `No card: ${rule.line}. There is nothing for a person to press. Say it merges on its own once QA approves it — and if a merge already ran and failed, its run says why.`
      : null;
  } catch {
    return null;
  }
}
