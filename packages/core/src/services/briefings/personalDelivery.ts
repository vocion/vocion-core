/**
 * Deliver one scheduled personal brief — the morning "your day" or the
 * evening wrap (docs/guides/morning-brief.md).
 *
 * The brief itself is a briefing, composed and stored by the one composer
 * (`personal.ts`), so it lists with its history on the Personal workspace's
 * Briefings page. This file only delivers it to where the person is:
 *
 *   - one short assistant message in their Personal chat, its own
 *     conversation titled for the day, that says the brief's lead line and
 *     links to the stored brief;
 *   - its suggested actions as one Decision on that conversation,
 *     recommended first (the brief says they are waiting; it never draws
 *     them a second time);
 *   - for the morning brief, a push beyond the app where the person chose
 *     (`services/personal/push.ts`), linking to the stored brief.
 *
 * Once-only per (person, kind, local day): the conversation's scope
 * (`personal-rhythm:<kind>:<day>`) says it was delivered, and the brief's
 * edition (`<kind>:<day>`) keeps it one row even if someone asked for their
 * day before the schedule ran.
 *
 * Limits, one budget (`budgetGate.ts`): only people active this week in an
 * Org with daily briefs on (the sweep reads the same rule); nothing to say —
 * no meetings, nothing waiting, no team activity — means no model call, no
 * brief and no message; an Org over its daily brief cap gets none, and its
 * admins one quiet notice a day.
 *
 * Warm chat: the Decision is raised only after the message is written, so
 * the card never docks on an empty conversation (`emptyChat.mayDockCard`).
 */

import type { BriefWriter } from './personalWriter';
import type { RhythmKind } from '@/libs/personal/rhythm';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { conversationSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';
import { appendMessage, createConversation } from '@/services/ConversationService';
import { personalAssistantSlug } from '@/services/workspace/personalAssistant';
import { ensurePersonalProject } from '@/services/workspace/personalProject';
import { briefBudget, noticeBriefsStopped } from './budgetGate';
import { briefingHref, DELIVERY_SCOPE_PREFIX } from './links';
import { personalBriefFacts, publishPersonalBrief } from './personal';
import { hasNothingToSay } from './personalFacts';
import { modelWriter } from './personalWriter';

/**
 * The conversation scope that makes a delivery once-only.
 * @param kind - Brief or wrap.
 * @param day - The person's local day.
 */
export function deliveryScope(kind: RhythmKind, day: string): string {
  return `${DELIVERY_SCOPE_PREFIX}${kind}:${day}`;
}

export type DeliveredBrief
  = | { delivered: true; conversationId: number; orgId: string; briefingId: number; decisionId: number | null; title: string }
    | { delivered: false; reason: string; conversationId?: number };

/**
 * The chat message that carries a brief: its lead line and a link to it.
 * Pure.
 * @param input - What to say.
 * @param input.lead - The brief's lead sentence.
 * @param input.title - The brief's title.
 * @param input.href - Where the stored brief lives.
 * @param input.actions - How many suggested actions wait in the card below.
 */
export function deliveryMessage(input: { lead: string; title: string; href: string; actions: number }): string {
  const out = [input.lead, '', `[Open ${input.title} →](${input.href})`];
  if (input.actions > 0) {
    out.push('', input.actions === 1 ? 'One thing to do first is in the card below.' : `The ${input.actions} things I would do first are in the card below.`);
  }
  return out.join('\n');
}

/**
 * Compose, store and deliver one scheduled brief or wrap.
 * @param input - Whose, which, for which day.
 * @param input.userId - The person.
 * @param input.accountId - Their Org.
 * @param input.kind - Brief or wrap.
 * @param input.day - The day it is for, in their zone (`YYYY-MM-DD`): the once-only key.
 * @param input.timeZone - Their zone.
 * @param input.now - The clock.
 * @param writer - The model seam, for tests.
 */
export async function deliverPersonalBrief(input: { userId: string; accountId: string; kind: RhythmKind; day: string; timeZone: string; now?: Date }, writer: BriefWriter = modelWriter): Promise<DeliveredBrief> {
  const now = input.now ?? new Date();
  const personal = await ensurePersonalProject(input.userId, input.accountId);
  const scope = deliveryScope(input.kind, input.day);
  const [existing] = await db
    .select({ id: conversationSchema.id })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, personal.id), eq(conversationSchema.scopeRef, scope)))
    .limit(1);
  if (existing) {
    return { delivered: false, reason: 'already delivered', conversationId: existing.id };
  }

  // The cheap read first: records and one calendar call. Nothing to say means
  // no model call, no brief and no message.
  const opts = { kind: input.kind, day: input.day, timeZone: input.timeZone, now };
  const facts = await personalBriefFacts(input.userId, input.accountId, personal.id, opts);
  if (hasNothingToSay(facts)) {
    return { delivered: false, reason: 'nothing to say' };
  }
  const budget = await briefBudget({ accountId: input.accountId, personalOrgId: personal.id, now });
  if (!budget.ok) {
    await noticeBriefsStopped(input.accountId, input.day, budget.why);
    return { delivered: false, reason: `over budget: ${budget.why}` };
  }
  const published = await publishPersonalBrief(input.userId, input.accountId, { ...opts, facts, writer });
  const { brief } = published;

  const [project] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, personal.id)).limit(1);
  const agentSlug = project?.lead ?? personalAssistantSlug();
  const conversation = await createConversation({ orgId: personal.id, agentSlug, initialTitle: brief.title, titleSource: 'person', createdBy: input.userId, scopeRef: scope });
  await appendMessage({ orgId: personal.id, conversationId: conversation.id, role: 'assistant', content: deliveryMessage({ lead: brief.lead, title: brief.title, href: published.href, actions: brief.actions.length }), status: 'complete', agentSlug });

  let decisionId: number | null = null;
  if (brief.actions.length > 0) {
    const { raiseDecision } = await import('@/services/decisions/DecisionService');
    const raised = await raiseDecision({
      orgId: personal.id,
      conversationId: conversation.id,
      ownerUserId: input.userId,
      agentSlug,
      kind: 'ruling',
      question: input.kind === 'brief' ? 'What should I start on?' : 'What should I set up for tomorrow?',
      options: brief.actions.map((a, i) => ({ id: `act-${i + 1}`, label: a.label, description: a.why, ...(i === 0 ? { recommended: true } : {}) })),
      allowOther: true,
      sourceRef: `${scope}:actions`,
    });
    decisionId = raised.view.id;
  }

  if (input.kind === 'brief') {
    // Beyond the app too, where the person chose (Slack DM, text, email), with a link straight to the brief.
    const { pushToPerson } = await import('@/services/personal/push');
    const [org] = await db.select({ slug: tenantAccountSchema.slug }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, input.accountId)).limit(1);
    await pushToPerson({
      userId: input.userId,
      accountId: input.accountId,
      kind: 'brief',
      key: scope,
      title: 'Your day is ready',
      body: brief.lead,
      path: briefingHref(published.id),
      workspaceSlug: personal.slug,
      ...(org ? { accountSlug: org.slug } : {}),
    }, { now }).catch(() => null);
  }

  return { delivered: true, conversationId: conversation.id, orgId: personal.id, briefingId: published.id, decisionId, title: brief.title };
}
