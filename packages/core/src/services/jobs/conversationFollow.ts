/**
 * THE ASKER HEARS BACK WHERE THEY ASKED (red team as a product exec, 2026-10-05: five features
 * asked for in the app's chat shipped and were seen live, and the conversation they were asked in
 * never heard another word; the loop-closing mission drafted release notes and left "publish the
 * announcement" cards for a person, 32 releases deep). A request asked for in an in-app
 * conversation is answered there, by the record's own moves: when a decision waits on the person
 * and when the work is done — shipped, seen live, answered — with the feature's page, and the
 * public share link when one is on. Nothing an agent writes; the step's own sentence. Quiet in
 * between: the Work page carries the rest.
 *
 * Driven by `record.status_marked` through a plugin automation that names the type; nothing here
 * names one. A conversation on another surface (a Slack thread) is that surface's job
 * (`slackThreadFollow`). Each line is said once. When the work is done, `told` is written on the
 * record — at, channel, what, status — which is what closes the request.
 */
import type { RecordStatusMarkedPayload } from '@/services/EventService';
import { appBaseUrl } from '@/libs/links';
import { slackThreadOfScope } from './slackThreadFollow';

export const CONVERSATION_FOLLOW_JOB = 'conversation-follow';

/**
 * The moves a person hears about in their chat: a decision that waits on them, and the end.
 * @param payload
 */
export function worthSaying(payload: Pick<RecordStatusMarkedPayload, 'groupRole' | 'needsYou'>): boolean {
  return payload.groupRole === 'done' || payload.needsYou === true;
}

/**
 * What the conversation reads: the step's sentence, the record's page, and — when the work is
 * done and a public link is on — the link to share.
 * @param payload - The move.
 * @param href - The record's page, absolute, or null.
 * @param shareUrl - The public share link, absolute, or null.
 */
export function followLine(payload: Pick<RecordStatusMarkedPayload, 'line' | 'value' | 'groupRole'>, href: string | null, shareUrl: string | null): string {
  const line = payload.line.trim() || `Now ${payload.value.replace(/_/g, ' ')}.`;
  const sentence = /[.!?…]$/.test(line) ? line : `${line}.`;
  const parts = [sentence];
  if (href) {
    parts.push(`Feature page: ${href}`);
  }
  if (payload.groupRole === 'done' && shareUrl) {
    parts.push(`Share it: ${shareUrl}`);
  }
  return parts.join('\n');
}

export type ConversationFollowResult
  = | { posted: true; conversationId: number; text: string; told: boolean }
    | { posted: false; reason: string };

export type ConversationFollowDeps = {
  /** The record's origin conversation id, or null. */
  originConversation: (orgId: string, recordId: number) => Promise<number | null>;
  /** The conversation's surface and scope, or null when it is gone. */
  conversation: (orgId: string, conversationId: number) => Promise<{ surface: string; scopeRef: string | null; agentSlug: string | null } | null>;
  /** The record's page, absolute, or null. */
  pageHref: (orgId: string, typeSlug: string | null, recordId: number) => Promise<string | null>;
  /** The public share link, absolute, or null when none is on. */
  shareUrl: (orgId: string, recordId: number) => Promise<string | null>;
  /** Whether this exact text is already in the conversation. */
  alreadySaid: (orgId: string, conversationId: number, text: string) => Promise<boolean>;
  /** Append the line as the conversation's own agent. */
  say: (orgId: string, conversationId: number, text: string, agentSlug: string | null) => Promise<void>;
  /** Write `told` on the record when the work is done. */
  markTold: (orgId: string, recordId: number, told: { at: string; channel: string; what: string; status: string }) => Promise<void>;
};

const defaultDeps: ConversationFollowDeps = {
  async originConversation(orgId, recordId) {
    const { db } = await import('@/libs/DB');
    const { and, eq } = await import('drizzle-orm');
    const { businessObjectSchema } = await import('@/models/Schema');
    const [row] = await db.select({ meta: businessObjectSchema.metadata, reviewActionRunId: businessObjectSchema.reviewActionRunId }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId))).limit(1);
    if (!row) {
      return null;
    }
    const { recordOrigin } = await import('@/services/objects/related');
    const origin = await recordOrigin(orgId, { id: recordId, meta: (row.meta ?? {}) as Record<string, unknown>, reviewActionRunId: row.reviewActionRunId });
    return origin?.conversationId ?? null;
  },
  async conversation(orgId, conversationId) {
    const { getConversation } = await import('@/services/ConversationService');
    const c = await getConversation({ orgId, id: conversationId });
    return c ? { surface: c.surface, scopeRef: c.scopeRef ?? null, agentSlug: c.agentSlug ?? null } : null;
  },
  async pageHref(orgId, typeSlug, recordId) {
    const base = appBaseUrl();
    if (!base) {
      return null;
    }
    try {
      const { recordHref } = await import('@/services/objects/recordHref');
      return `${base}${await recordHref(orgId, { objectType: typeSlug, id: recordId })}`;
    } catch {
      return `${base}/dashboard/objects/${recordId}`;
    }
  },
  async shareUrl(orgId, recordId) {
    const base = appBaseUrl();
    if (!base) {
      return null;
    }
    const { featureShareOf } = await import('@/services/factory/featureShareData');
    const state = await featureShareOf(orgId, recordId).catch(() => null);
    return state?.shared && state.path ? `${base}${state.path}` : null;
  },
  async alreadySaid(_orgId, conversationId, text) {
    const { db } = await import('@/libs/DB');
    const { and, desc, eq } = await import('drizzle-orm');
    const { conversationMessageSchema } = await import('@/models/Schema');
    const rows = await db.select({ content: conversationMessageSchema.content }).from(conversationMessageSchema).where(and(eq(conversationMessageSchema.conversationId, conversationId), eq(conversationMessageSchema.role, 'assistant'))).orderBy(desc(conversationMessageSchema.id)).limit(40);
    return rows.some(r => r.content === text);
  },
  async say(orgId, conversationId, text, agentSlug) {
    const { appendMessage } = await import('@/services/ConversationService');
    await appendMessage({ orgId, conversationId, role: 'assistant', content: text, status: 'complete', ...(agentSlug ? { agentSlug } : {}) });
  },
  async markTold(orgId, recordId, told) {
    const { db } = await import('@/libs/DB');
    const { and, eq, sql } = await import('drizzle-orm');
    const { businessObjectSchema } = await import('@/models/Schema');
    await db.update(businessObjectSchema).set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify({ told })}::jsonb`, updatedAt: new Date() }).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId)));
  },
};

/**
 * Say one move of a record in the in-app conversation it was asked in. Never throws: a record
 * with no conversation, a conversation on another surface, a move not worth saying, or a line
 * already said each come back as the reason.
 * @param orgId - The workspace.
 * @param input - The `record.status_marked` payload.
 * @param deps - Seams for tests.
 */
export async function conversationFollow(orgId: string, input: Record<string, unknown>, deps: ConversationFollowDeps = defaultDeps): Promise<ConversationFollowResult> {
  const recordId = Number(input.recordId);
  const value = typeof input.value === 'string' ? input.value : '';
  const groupRole = typeof input.groupRole === 'string' ? input.groupRole : '';
  if (!Number.isInteger(recordId) || recordId <= 0 || !value) {
    return { posted: false, reason: 'the event names no record or no status' };
  }
  if (!worthSaying({ groupRole, needsYou: input.needsYou === true })) {
    return { posted: false, reason: 'a move the Work page carries, not the chat' };
  }
  const conversationId = await deps.originConversation(orgId, recordId);
  if (conversationId === null) {
    return { posted: false, reason: 'the record was not asked for in a conversation' };
  }
  const conversation = await deps.conversation(orgId, conversationId);
  if (!conversation) {
    return { posted: false, reason: 'the conversation is gone' };
  }
  if (slackThreadOfScope(conversation.scopeRef) || conversation.surface === 'slack') {
    return { posted: false, reason: 'the conversation is a Slack thread, which is told by its own job' };
  }
  const typeSlug = typeof input.typeSlug === 'string' && input.typeSlug ? input.typeSlug : null;
  const [href, shareUrl] = await Promise.all([deps.pageHref(orgId, typeSlug, recordId), groupRole === 'done' ? deps.shareUrl(orgId, recordId) : Promise.resolve(null)]);
  const text = followLine({ line: typeof input.line === 'string' ? input.line : '', value, groupRole }, href, shareUrl);
  if (await deps.alreadySaid(orgId, conversationId, text)) {
    return { posted: false, reason: 'already said in the conversation' };
  }
  await deps.say(orgId, conversationId, text, conversation.agentSlug);
  const told = groupRole === 'done';
  if (told) {
    const at = typeof input.at === 'string' && input.at ? input.at : new Date().toISOString();
    await deps.markTold(orgId, recordId, { at, channel: 'chat', what: text, status: 'sent' }).catch(() => undefined);
  }
  return { posted: true, conversationId, text, told };
}

/**
 * The automation job: `do: { job: conversation-follow }` on `record.status_marked`.
 * @param orgId - The workspace.
 * @param input - The event's payload.
 */
export async function runConversationFollowJob(orgId: string, input: Record<string, unknown>): Promise<ConversationFollowResult> {
  try {
    return await conversationFollow(orgId, input);
  } catch (err) {
    return { posted: false, reason: `the line was not said: ${(err as Error).message}` };
  }
}
