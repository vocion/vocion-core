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
 *     this one is here. The tool files nothing and says so — ask them here,
 *     with the link, and what they answer runs as theirs. Unless they said to
 *     put it on the queue (a model's reading of their words, `saidToDecide`),
 *     or it is a credential, whose value must never travel through the chat.
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
 * The refusal for an ask whose decision the person in the turn holds, or
 * null to file it.
 * @param ctx - The turn.
 * @param ask - The ask.
 */
export async function askHeldByThePersonHere(ctx: RuntimeContext, ask: DecisionSubject): Promise<string | null> {
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
        return moot;
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
    const name = await personName(ctx.userId!);
    const who = name ? `${name} is` : 'The person you are talking to is';
    const about = subject ? ` about ${subject.title}` : '';
    const link = subject ? ` Give them the link: ${subject.href}` : '';
    const merge = subject ? mergeSentence(subject.facts) : null;
    return [
      `Not filed: ${who} in this conversation, and this decision${about} is theirs — any person in the workspace decides an ask, and they are the one asking. Do not route it to "the owner" or an engineering owner; there is no one else to route it to.`,
      `Ask them here, in one line, with your recommendation.${link}`,
      merge ? `What the records say: ${merge}` : null,
      'What they answer runs as theirs: a proposal with decide_proposal, an open ask with decide_ask, anything else as the action itself.',
    ].filter(Boolean).join(' ');
  } catch (err) {
    console.warn('decision holder check failed', { orgId: ctx.orgId, message: (err as Error).message });
    return null;
  }
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
