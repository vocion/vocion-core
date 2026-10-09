/**
 * Your briefs as a private podcast (docs/guides/listen-to-your-brief.md): one
 * secret feed URL per person and Org that Apple Podcasts, Overcast or any
 * podcast app subscribes to, so the morning brief is in the car before the
 * app is opened.
 *
 * The URL carries a random token; only its SHA-256 is kept (`podcast_feed`),
 * so the URL is shown once, when it is made. Making a new one revokes the
 * old, and revoking stops it at once. The feed lists the person's own briefs
 * (their Personal workspace) that have been spoken; delivery speaks each
 * morning brief for a person with a live feed, so it is there by the time
 * the podcast app looks.
 *
 * Database only — the listen route (`app/api/listen/[...path]`) that reads
 * it is sign-in-free and must stay light (`scripts/check-route-graph.ts`).
 */

import type { BriefAudio } from './types';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { briefingSchema, podcastFeedSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';

/** How many episodes a feed lists: about a month of mornings and evenings. */
export const FEED_EPISODES = 40;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The feed's path for a token.
 * @param token - The secret.
 */
export function feedPath(token: string): string {
  return `/api/listen/feed/${token}`;
}

/**
 * Make the person's feed, revoking any they had. Returns the token, once.
 * @param userId - The person.
 * @param accountId - Their Org.
 */
export async function createPodcastFeed(userId: string, accountId: string): Promise<{ token: string; createdAt: Date }> {
  await revokePodcastFeed(userId, accountId);
  const token = randomBytes(24).toString('base64url');
  const [row] = await db.insert(podcastFeedSchema).values({ userId, accountId, tokenHash: hash(token) }).returning({ createdAt: podcastFeedSchema.createdAt });
  return { token, createdAt: row!.createdAt };
}

/**
 * Stop the person's feed.
 * @param userId - The person.
 * @param accountId - Their Org.
 */
export async function revokePodcastFeed(userId: string, accountId: string): Promise<void> {
  await db.update(podcastFeedSchema).set({ revokedAt: new Date() }).where(and(eq(podcastFeedSchema.userId, userId), eq(podcastFeedSchema.accountId, accountId), isNull(podcastFeedSchema.revokedAt)));
}

/**
 * The person's live feed, if any (never its token).
 * @param userId - The person.
 * @param accountId - Their Org.
 */
export async function podcastFeedOf(userId: string, accountId: string): Promise<{ createdAt: Date; lastFetchedAt: Date | null } | null> {
  const [row] = await db
    .select({ createdAt: podcastFeedSchema.createdAt, lastFetchedAt: podcastFeedSchema.lastFetchedAt })
    .from(podcastFeedSchema)
    .where(and(eq(podcastFeedSchema.userId, userId), eq(podcastFeedSchema.accountId, accountId), isNull(podcastFeedSchema.revokedAt)))
    .limit(1);
  return row ?? null;
}

/** One episode: a spoken brief. */
export type Episode = { id: number; title: string; at: Date; audio: Extract<BriefAudio, { status: 'ready' }> };

/** A live feed's owner, read from its token, with its episodes. */
export type FeedRead = { userId: string; accountId: string; orgName: string; personalOrgId: string; episodes: Episode[] };

/**
 * The feed a token opens, or null when it is not a live one. Stamps when it was last fetched.
 * @param token - From the URL.
 */
export async function readPodcastFeed(token: string): Promise<FeedRead | null> {
  if (!/^[\w-]{20,80}$/.test(token)) {
    return null;
  }
  const [feed] = await db
    .select({ id: podcastFeedSchema.id, userId: podcastFeedSchema.userId, accountId: podcastFeedSchema.accountId, orgName: tenantAccountSchema.name })
    .from(podcastFeedSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, podcastFeedSchema.accountId))
    .where(and(eq(podcastFeedSchema.tokenHash, hash(token)), isNull(podcastFeedSchema.revokedAt)))
    .limit(1);
  if (!feed) {
    return null;
  }
  const [home] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(and(eq(projectSchema.accountId, feed.accountId), eq(projectSchema.ownerUserId, feed.userId), eq(projectSchema.kind, 'personal')))
    .limit(1);
  await db.update(podcastFeedSchema).set({ lastFetchedAt: new Date() }).where(eq(podcastFeedSchema.id, feed.id));
  if (!home) {
    return { userId: feed.userId, accountId: feed.accountId, orgName: feed.orgName, personalOrgId: '', episodes: [] };
  }
  const rows = await db
    .select({ id: briefingSchema.id, title: briefingSchema.title, at: briefingSchema.createdAt, audio: briefingSchema.audio })
    .from(briefingSchema)
    .where(and(eq(briefingSchema.orgId, home.id), sql`${briefingSchema.audio}->>'status' = 'ready'`))
    .orderBy(desc(briefingSchema.createdAt))
    .limit(FEED_EPISODES);
  const episodes = rows.filter((r): r is typeof r & { audio: Extract<BriefAudio, { status: 'ready' }> } => r.audio?.status === 'ready').map(r => ({ id: r.id, title: r.title, at: r.at, audio: r.audio }));
  return { userId: feed.userId, accountId: feed.accountId, orgName: feed.orgName, personalOrgId: home.id, episodes };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The feed as RSS 2.0 with the iTunes tags podcast apps read. Pure. Marked
 * `itunes:block` so no directory lists it: it is one person's.
 * @param feed - The feed.
 * @param base - The app's absolute URL.
 * @param token - The feed's token, for its episode URLs.
 */
export function podcastXml(feed: Pick<FeedRead, 'orgName' | 'episodes'>, base: string, token: string): string {
  const self = `${base}${feedPath(token)}`;
  const items = feed.episodes.map((e) => {
    const seconds = Math.round(e.audio.durationMs / 1000);
    const note = e.audio.script.length > 600 ? `${e.audio.script.slice(0, 597)}…` : e.audio.script;
    return [
      '<item>',
      `<title>${esc(e.title)}</title>`,
      `<guid isPermaLink="false">vocion-brief-${e.id}-${esc(e.audio.sourceHash.slice(0, 12))}</guid>`,
      `<pubDate>${new Date(e.audio.at > e.at.toISOString() ? e.audio.at : e.at).toUTCString()}</pubDate>`,
      `<enclosure url="${esc(`${self}/${e.id}.mp3`)}" length="${e.audio.bytes}" type="audio/mpeg"/>`,
      `<itunes:duration>${seconds}</itunes:duration>`,
      `<description>${esc(note)}</description>`,
      '<itunes:explicit>false</itunes:explicit>',
      '</item>',
    ].join('');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${esc(`Your briefs · ${feed.orgName}`)}</title>`,
    `<link>${esc(base)}</link>`,
    `<atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>`,
    '<description>Your morning brief and evening wrap, read aloud. Private to you: do not share this feed.</description>',
    '<language>en</language>',
    '<itunes:author>Vocion</itunes:author>',
    '<itunes:block>Yes</itunes:block>',
    '<itunes:explicit>false</itunes:explicit>',
    '<itunes:category text="Business"/>',
    ...items,
    '</channel>',
    '</rss>',
  ].join('\n');
}
