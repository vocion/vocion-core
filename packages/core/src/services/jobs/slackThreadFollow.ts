/**
 * THE THREAD FOLLOWS THE REQUEST (backlog 057; Chris, 2026-10-04: "I want to
 * at-mention Vocion … build the fix with evidence and share it in the Slack
 * channel"). A request asked for in a Slack thread is answered there, once,
 * and then goes quiet while the factory works. This job posts each move the
 * record makes back into that thread — filed, building, in QA, merged,
 * shipped, seen live — in the sentence the step was written with, so the
 * people who asked never have to open Vocion to know where it stands.
 *
 * Driven by `record.status_marked` (one event per status write) through a
 * plugin automation that names the type it follows; nothing here names one.
 * The thread is found from the record's origin conversation, whose scope is
 * the Slack thread it was created for (`ChatSurfaceService.handleInbound`).
 * A record that did not come from Slack posts nothing. Each line is posted
 * once: the outbound record (`slack_post`) remembers it.
 */
import type { RecordStatusMarkedPayload } from '@/services/EventService';
import process from 'node:process';
import { appBaseUrl } from '@/libs/links';

export const SLACK_THREAD_FOLLOW_JOB = 'slack-thread-follow';

/** A Slack thread named by a conversation's scope: `slack:<channel>:<thread ts>`. */
export type SlackThreadRef = { channelId: string; threadTs: string };

/**
 * The Slack thread a conversation was created for, from its scope ref, or
 * null when the conversation did not come from Slack.
 * @param scopeRef - The conversation's `scopeRef`.
 */
export function slackThreadOfScope(scopeRef: string | null | undefined): SlackThreadRef | null {
  const m = /^slack:([^:]+):([^:]+)$/.exec(scopeRef ?? '');
  return m ? { channelId: m[1]!, threadTs: m[2]! } : null;
}

/**
 * What the thread reads for one move: the step's own sentence, then the
 * record's page. No agent voice, no restating what the person asked.
 * @param payload - The move.
 * @param href - The record's page, absolute, or null when the app has no public address.
 */
export function followText(payload: Pick<RecordStatusMarkedPayload, 'line' | 'value'>, href: string | null): string {
  const line = payload.line.trim() || `Now ${payload.value.replace(/_/g, ' ')}.`;
  const sentence = /[.!?…]$/.test(line) ? line : `${line}.`;
  return href ? `${sentence}\n${href}` : sentence;
}

/**
 * The record's page, absolute, when the app knows its own address.
 * @param recordId
 */
export function recordHref(recordId: number): string | null {
  const base = appBaseUrl();
  return base ? `${base}/dashboard/objects/${recordId}` : null;
}

export type SlackThreadFollowResult
  = | { posted: true; channelId: string; threadTs: string; text: string }
    | { posted: false; reason: string };

export type SlackThreadFollowDeps = {
  /** The record's origin conversation id, or null. */
  originConversation: (orgId: string, recordId: number) => Promise<number | null>;
  /** The conversation's scope ref. */
  scopeOf: (orgId: string, conversationId: number) => Promise<string | null>;
  /** Our earlier posts in the thread, for the once-only rule. */
  alreadyPosted: (channelId: string, threadTs: string, text: string) => Promise<boolean>;
  /** Post into the thread; returns the message ts, or null when Slack gave none. */
  post: (ref: SlackThreadRef, text: string) => Promise<string | null>;
  /** Remember the post. */
  remember: (input: { orgId: string; channelId: string; ts: string; threadTs: string; text: string; announcedLabel: string; announcedUrl: string | null }) => Promise<void>;
};

const defaultDeps: SlackThreadFollowDeps = {
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
  async scopeOf(orgId, conversationId) {
    const { getConversation } = await import('@/services/ConversationService');
    const c = await getConversation({ orgId, id: conversationId });
    return c?.scopeRef ?? null;
  },
  async alreadyPosted(channelId, threadTs, text) {
    const { ourPostsInThread } = await import('@/services/chat/slackPosts');
    return (await ourPostsInThread(channelId, threadTs)).some(p => p.text === text);
  },
  async post(ref, text) {
    const { postSlackReply } = await import('@/libs/surfaces/slack');
    const { tsOf } = await import('@/services/chat/slackPosts');
    const posted = await postSlackReply({ channelId: ref.channelId, threadRef: ref.threadTs }, text, process.env.SLACK_BOT_TOKEN);
    return posted ? tsOf(posted) || null : null;
  },
  async remember(input) {
    const { recordSlackPost } = await import('@/services/chat/slackPosts');
    await recordSlackPost({ orgId: input.orgId, channelId: input.channelId, ts: input.ts, threadTs: input.threadTs, kind: 'reply', text: input.text, announcedLabel: input.announcedLabel, announcedUrl: input.announcedUrl, createdBy: 'system:slack-thread-follow' });
  },
};

/**
 * Post one move of a record into the Slack thread it was asked in. Never
 * throws: a record with no Slack thread, a line already posted, or a missing
 * token each come back as the reason.
 * @param orgId - The workspace.
 * @param input - The `record.status_marked` payload.
 * @param deps - Seams for tests.
 */
export async function slackThreadFollow(orgId: string, input: Record<string, unknown>, deps: SlackThreadFollowDeps = defaultDeps): Promise<SlackThreadFollowResult> {
  const recordId = Number(input.recordId);
  const value = typeof input.value === 'string' ? input.value : '';
  if (!Number.isInteger(recordId) || recordId <= 0 || !value) {
    return { posted: false, reason: 'the event names no record or no status' };
  }
  const conversationId = await deps.originConversation(orgId, recordId);
  if (conversationId === null) {
    return { posted: false, reason: 'the record was not asked for in a conversation' };
  }
  const ref = slackThreadOfScope(await deps.scopeOf(orgId, conversationId));
  if (!ref) {
    return { posted: false, reason: 'the conversation is not a Slack thread' };
  }
  const href = recordHref(recordId);
  const text = followText({ line: typeof input.line === 'string' ? input.line : '', value }, href);
  if (await deps.alreadyPosted(ref.channelId, ref.threadTs, text)) {
    return { posted: false, reason: 'already said in the thread' };
  }
  const ts = await deps.post(ref, text);
  await deps.remember({ orgId, channelId: ref.channelId, ts: ts ?? '', threadTs: ref.threadTs, text, announcedLabel: value, announcedUrl: href });
  return { posted: true, channelId: ref.channelId, threadTs: ref.threadTs, text };
}

/**
 * The automation job: `do: { job: slack-thread-follow }` on `record.status_marked`.
 * @param orgId - The workspace.
 * @param input - The event's payload.
 */
export async function runSlackThreadFollowJob(orgId: string, input: Record<string, unknown>): Promise<SlackThreadFollowResult> {
  try {
    return await slackThreadFollow(orgId, input);
  } catch (err) {
    return { posted: false, reason: `the post failed: ${(err as Error).message}` };
  }
}
