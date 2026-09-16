/**
 * What Vocion said in Slack, remembered.
 *
 * The `app_mention` payload carries the mention and nothing else — not the
 * message it replies to. Reading that parent back out of Slack costs
 * `channels:history` / `groups:history`, scopes a workspace may never grant.
 * But when the parent is one of OUR posts — a release announcement someone
 * replied "any screenshots to go with this?" to — we already knew what it
 * said when we sent it. Vocion should not need a permission to remember its
 * own words, so every outbound post is recorded here on the way out.
 *
 * `announcedLabel` / `announcedUrl` are what makes "this" resolvable: the post
 * remembers not only its text but the thing it was announcing.
 */

import type { ChatImage, ChatPostRef } from '@/libs/surfaces/types';
import type { SlackPostImage } from '@/models/Schema';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { slackPostSchema } from '@/models/Schema';

export type SlackPost = typeof slackPostSchema.$inferSelect;

export type RecordSlackPostInput = {
  orgId: string;
  projectId?: string | null;
  teamId?: string | null;
  channelId: string;
  /** Slack's id for the message. Empty means Slack did not tell us (a file upload posts the message itself). */
  ts: string;
  threadTs?: string | null;
  kind: 'announcement' | 'reply' | 'introduction';
  agentSlug?: string | null;
  text: string;
  announcedLabel?: string | null;
  announcedUrl?: string | null;
  images?: ChatImage[];
  /** True when this post named a missing Slack scope out loud. */
  degradedNotice?: boolean;
  createdBy?: string | null;
};

/**
 * Record one outbound post. Never throws: losing the memory of a post is a
 * degraded next turn, while failing the post itself is a silent agent.
 * A post Slack gave no `ts` for is skipped rather than stored under a blank
 * key — the unique index is (channel, ts), and two blanks are the same row.
 * @param input - The post as it was sent.
 * @returns The stored row, or null when there was nothing to key it by.
 */
export async function recordSlackPost(input: RecordSlackPostInput): Promise<SlackPost | null> {
  if (!input.ts) {
    return null;
  }
  const images: SlackPostImage[] = (input.images ?? []).map(i => ({ url: i.url, caption: i.caption }));
  try {
    const [row] = await db.insert(slackPostSchema).values({
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      teamId: input.teamId ?? null,
      channelId: input.channelId,
      ts: input.ts,
      threadTs: input.threadTs ?? null,
      kind: input.kind,
      agentSlug: input.agentSlug ?? null,
      text: input.text,
      announcedLabel: input.announcedLabel ?? null,
      announcedUrl: input.announcedUrl ?? null,
      images,
      degradedNotice: input.degradedNotice ?? false,
      createdBy: input.createdBy ?? null,
    }).onConflictDoNothing().returning();
    return row ?? null;
  } catch (error) {
    console.error('[slackPosts] could not record an outbound post', error);
    return null;
  }
}

/**
 * Our post with this exact Slack id, if we made it. This is how a mention's
 * parent is resolved without a history scope.
 * @param channelId - Slack channel id.
 * @param ts - The message's Slack id.
 */
export async function findOurPost(channelId: string, ts: string): Promise<SlackPost | null> {
  if (!ts) {
    return null;
  }
  const [row] = await db.select().from(slackPostSchema).where(and(eq(slackPostSchema.channelId, channelId), eq(slackPostSchema.ts, ts))).limit(1);
  return row ?? null;
}

/**
 * Everything we have said in one thread, oldest first — the parent post and
 * every reply of ours under it.
 * @param channelId - Slack channel id.
 * @param threadTs - The thread's parent ts.
 */
export async function ourPostsInThread(channelId: string, threadTs: string): Promise<SlackPost[]> {
  if (!threadTs) {
    return [];
  }
  return db.select().from(slackPostSchema).where(and(
    eq(slackPostSchema.channelId, channelId),
    or(eq(slackPostSchema.threadTs, threadTs), eq(slackPostSchema.ts, threadTs)),
  )).orderBy(slackPostSchema.ts);
}

/**
 * Has this thread already been told which scope is missing? The sentence is
 * worth saying once; on every reply it is nagging.
 * @param channelId - Slack channel id.
 * @param threadTs - The thread's parent ts.
 */
export async function threadAlreadyNoticed(channelId: string, threadTs: string): Promise<boolean> {
  if (!threadTs) {
    return false;
  }
  const [row] = await db.select({ id: slackPostSchema.id }).from(slackPostSchema).where(and(
    eq(slackPostSchema.channelId, channelId),
    eq(slackPostSchema.degradedNotice, true),
    or(eq(slackPostSchema.threadTs, threadTs), eq(slackPostSchema.ts, threadTs)),
  )).limit(1);
  return Boolean(row);
}

/**
 * The most recent announcement in a channel, for a mention that names no
 * thread ("@Vocion any screenshots for that release?") — a top-level post is
 * almost always about the last thing said.
 * @param orgId - Tenant.
 * @param channelId - Slack channel id.
 */
export async function latestAnnouncement(orgId: string, channelId: string): Promise<SlackPost | null> {
  const [row] = await db.select().from(slackPostSchema).where(and(
    eq(slackPostSchema.orgId, orgId),
    eq(slackPostSchema.channelId, channelId),
    eq(slackPostSchema.kind, 'announcement'),
    isNull(slackPostSchema.threadTs),
  )).orderBy(desc(slackPostSchema.createdAt)).limit(1);
  return row ?? null;
}

/**
 * The `ts` a post landed on, from an adapter's post result. Empty when the platform did not say.
 * @param ref
 */
export function tsOf(ref: ChatPostRef | null): string {
  return ref?.ts ?? '';
}
