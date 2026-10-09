/**
 * Deliver one morning brief or evening wrap: an assistant message in the
 * person's Personal workspace, and its suggested actions as one Decision
 * (docs/guides/morning-brief.md).
 *
 * The delivery is its own conversation, titled for its day, so the opening
 * hint can point straight at it ("Your morning brief is ready →") and a
 * person scrolling their threads sees one per day. Its once-only key is the
 * conversation's scope (`personal-rhythm:<kind>:<day>`): a second delivery
 * for the same day finds the first and does nothing.
 *
 * Limits (`guard.ts`): nothing to say — no meetings, nothing waiting, no
 * team activity — means no model call and no message; an Org over its brief
 * budget gets none, and its admins one quiet notice a day.
 *
 * Warm chat: the Decision is raised only after the message is written, so
 * the card never docks on an empty conversation (`emptyChat.mayDockCard`).
 * Its options are what the assistant does when chosen: choosing one answers
 * the Decision, which starts the assistant's turn on it.
 */

import type { RhythmWriter } from './compose';
import type { RhythmKind } from '@/libs/personal/rhythm';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { conversationSchema, personalRhythmSchema, projectSchema } from '@/models/Schema';
import { appendMessage, createConversation } from '@/services/ConversationService';
import { personalAssistantSlug } from '@/services/workspace/personalAssistant';
import { ensurePersonalProject } from '@/services/workspace/personalProject';
import { modelWriter, renderRhythm } from './compose';
import { gatherRhythmFacts, hasNothingToSay, withMeetingEvidence } from './facts';
import { briefBudget, noticeBriefsStopped } from './guard';

/**
 * The conversation scope that makes a delivery once-only.
 * @param kind
 * @param day
 */
export function rhythmScope(kind: RhythmKind, day: string): string {
  return `personal-rhythm:${kind}:${day}`;
}

export type DeliveredRhythm
  = | { delivered: true; conversationId: number; orgId: string; decisionId: number | null; title: string }
    | { delivered: false; reason: string; conversationId?: number };

/**
 * Compose and deliver one brief or wrap.
 * @param input - Whose, which, for which day.
 * @param input.userId - The person.
 * @param input.accountId - Their Org.
 * @param input.kind - Brief or wrap.
 * @param input.day - The day it is for, in their zone (`YYYY-MM-DD`): the once-only key.
 * @param input.timeZone - Their zone.
 * @param input.now - The clock.
 * @param writer - The model seam, for tests.
 */
export async function deliverRhythm(input: { userId: string; accountId: string; kind: RhythmKind; day: string; timeZone: string; now?: Date }, writer: RhythmWriter = modelWriter): Promise<DeliveredRhythm> {
  const now = input.now ?? new Date();
  const personal = await ensurePersonalProject(input.userId, input.accountId);
  const scope = rhythmScope(input.kind, input.day);
  const [existing] = await db
    .select({ id: conversationSchema.id })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, personal.id), eq(conversationSchema.scopeRef, scope)))
    .limit(1);
  if (existing) {
    return { delivered: false, reason: 'already delivered', conversationId: existing.id };
  }
  const [rhythm] = await db
    .select({ lastBriefAt: personalRhythmSchema.lastBriefAt, lastWrapAt: personalRhythmSchema.lastWrapAt })
    .from(personalRhythmSchema)
    .where(and(eq(personalRhythmSchema.userId, input.userId), eq(personalRhythmSchema.accountId, input.accountId)))
    .limit(1);
  const last = [rhythm?.lastBriefAt, rhythm?.lastWrapAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
  const since = last ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // The cheap read first: records and one calendar call. Nothing to say means
  // no model call and no message.
  const bare = await gatherRhythmFacts({ kind: input.kind, userId: input.userId, accountId: input.accountId, personalOrgId: personal.id, timeZone: input.timeZone, since, now });
  if (hasNothingToSay(bare)) {
    return { delivered: false, reason: 'nothing to say' };
  }
  const budget = await briefBudget({ accountId: input.accountId, personalOrgId: personal.id, now });
  if (!budget.ok) {
    await noticeBriefsStopped(input.accountId, input.day, budget.why);
    return { delivered: false, reason: `over budget: ${budget.why}` };
  }
  const facts = input.kind === 'brief' ? await withMeetingEvidence(bare) : bare;
  const { factsForWriter } = await import('./compose');
  const message = renderRhythm(facts, await writer(personal.id, factsForWriter(facts)));

  const [project] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, personal.id)).limit(1);
  const agentSlug = project?.lead ?? personalAssistantSlug();
  const conversation = await createConversation({ orgId: personal.id, agentSlug, initialTitle: message.title, titleSource: 'person', createdBy: input.userId, scopeRef: scope });
  await appendMessage({ orgId: personal.id, conversationId: conversation.id, role: 'assistant', content: message.markdown, status: 'complete', agentSlug });

  let decisionId: number | null = null;
  if (message.actions.length > 0) {
    const { raiseDecision } = await import('@/services/decisions/DecisionService');
    const raised = await raiseDecision({
      orgId: personal.id,
      conversationId: conversation.id,
      ownerUserId: input.userId,
      agentSlug,
      kind: 'ruling',
      question: input.kind === 'brief' ? 'What should I start on?' : 'What should I set up for tomorrow?',
      options: message.actions.map((a, i) => ({ id: `act-${i + 1}`, label: a.label, description: a.why, ...(i === 0 ? { recommended: true } : {}) })),
      allowOther: true,
      sourceRef: `${scope}:actions`,
    });
    decisionId = raised.view.id;
  }

  if (input.kind === 'brief') {
    // Beyond the app too, where the person chose (Slack DM, text, email), with a link straight to it.
    const { pushToPerson } = await import('@/services/personal/push');
    const { tenantAccountSchema } = await import('@/models/Schema');
    const [org] = await db.select({ slug: tenantAccountSchema.slug }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, input.accountId)).limit(1);
    const firstLine = message.markdown.split('\n')[0]!.replace(/\*\*/g, '');
    await pushToPerson({
      userId: input.userId,
      accountId: input.accountId,
      kind: 'brief',
      key: scope,
      title: 'Your morning brief is ready',
      body: firstLine,
      path: `/dashboard/chat?conversation=${conversation.id}`,
      workspaceSlug: personal.slug,
      ...(org ? { accountSlug: org.slug } : {}),
    }, { now }).catch(() => null);
  }

  const stamp = input.kind === 'brief' ? { lastBriefAt: now } : { lastWrapAt: now };
  await db.update(personalRhythmSchema).set(stamp).where(and(eq(personalRhythmSchema.userId, input.userId), eq(personalRhythmSchema.accountId, input.accountId)));
  return { delivered: true, conversationId: conversation.id, orgId: personal.id, decisionId, title: message.title };
}
