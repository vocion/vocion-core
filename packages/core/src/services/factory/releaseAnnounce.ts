import type { ChatImage } from '@/libs/surfaces/types';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { slackToken } from '@/libs/notifications/slack';
import { isExternalHttpUrl } from '@/libs/tools/artifacts/url';
import { announcementText } from '@/libs/workspace/releaseFeed';
import { artifactSchema, businessObjectSchema } from '@/models/Schema';
import { boundSlackChannel } from '@/services/chat/boundChannel';

/**
 * PUBLISHING A RELEASE'S ANNOUNCEMENT, WITH ITS PICTURE (backlog 043).
 *
 * The release carries its words (`announcement`) and the live screenshot it
 * leads with (`announcementImageArtifactId`, written by the post-deploy
 * check). Until this, nothing published the two together: the page's Publish
 * opened a chat that proposed a hand-off card, and a person then pasted the
 * words somewhere by hand, without the picture.
 *
 * One press now does it. Where the workspace has a Slack connection — the
 * deployment's Slack app and a channel bound in this workspace, the same
 * channel notifications post to — `release.announce` posts the words with the
 * picture uploaded as a file (Slack cannot open an image behind our sign-in),
 * records where it landed on the release, and Undo deletes the post. Where it
 * has none, the page copies the announcement as rich text with the picture
 * inside it, and offers the picture as a download (`ReleaseAnnouncePublish`).
 *
 * A failed post is written on the release (`announceFailure`), so the page
 * says why where the person pressed, and a later success clears it.
 */

/** Where the announcement goes when it is published from the page. */
export type AnnounceMode = 'slack' | 'copy';

/** Where a published post landed, kept on the release so Undo can take it back. */
export type AnnouncedPost = { surface: 'slack'; channelId: string; ts: string | null; fileIds: string[]; media: string; runId: number | null };

type Binding = { channelId: string; teamId: string | null };

/**
 * The Slack channel this workspace's announcements go to: the deployment
 * holds a Slack app (`SLACK_BOT_TOKEN`) and the workspace has bound a
 * channel. The first bound channel, the one notifications post to — one
 * lookup shared with `chat.post_message` (`services/chat/boundChannel.ts`).
 * @param orgId - The workspace.
 */
export async function slackAnnounceChannel(orgId: string): Promise<Binding | null> {
  const channel = await boundSlackChannel(orgId);
  return channel ? { channelId: channel.channelId, teamId: channel.teamId } : null;
}

/**
 * How the release page publishes: to Slack when there is a connection, else by copy.
 * @param orgId - The workspace.
 */
export async function announceMode(orgId: string): Promise<AnnounceMode> {
  return (await slackAnnounceChannel(orgId).catch(() => null)) ? 'slack' : 'copy';
}

/**
 * The bytes of one stored artifact image, read the way its own route serves
 * it, scoped to this org. Null for a file this org cannot open, a card
 * artifact with no file, or one kept to its owner (`me`).
 * @param orgId - The workspace.
 * @param artifactId - The artifact row.
 */
export async function artifactImageBytes(orgId: string, artifactId: number): Promise<Uint8Array | null> {
  const { resolveArtifactFile } = await import('@/libs/tools/artifacts/serve');
  const { toPayload } = await import('@/services/ArtifactService');
  const out = await resolveArtifactFile({
    callerOrgId: orgId,
    id: String(artifactId),
    viewer: { userId: null, hasToken: false },
    lookupRow: async (rowId) => {
      const [row] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, rowId));
      return row ? { orgId: row.orgId, kind: row.kind, url: row.url, spec: row.spec, title: row.title, payload: toPayload(row), shareAudience: row.shareAudience, shareOwnerId: row.shareOwnerId } : null;
    },
  });
  return out.status === 200 && 'body' in out && out.headers['Content-Type']?.startsWith('image/') ? new Uint8Array(out.body) : null;
}

/** What is published: the words, and the picture when the release has one. */
export type AnnouncementContent = { releaseId: number; title: string; text: string; image: (ChatImage & { artifactId: number }) | null };

/**
 * The announcement as it would be published, or why it cannot be.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 */
export async function announcementContent(orgId: string, releaseId: number): Promise<{ ok: true; content: AnnouncementContent } | { ok: false; error: string }> {
  const { loadReleaseRow } = await import('@/services/factory/releaseData');
  const row = await loadReleaseRow(orgId, releaseId);
  if (!row) {
    return { ok: false, error: `No release #${releaseId} in this workspace.` };
  }
  const text = announcementText(row.meta.announcement);
  if (!text) {
    return { ok: false, error: 'The release has no announcement written yet; draft it first.' };
  }
  const imageId = Number(row.meta.announcementImageArtifactId);
  let image: AnnouncementContent['image'] = null;
  if (Number.isSafeInteger(imageId) && imageId > 0) {
    const [art] = await db
      .select({ id: artifactSchema.id, url: artifactSchema.url, kind: artifactSchema.kind, spec: artifactSchema.spec })
      .from(artifactSchema)
      .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.id, imageId)))
      .limit(1);
    // The same URL the release page draws it from (`loadReleaseArtifacts`).
    const spec = (art?.spec ?? {}) as Record<string, unknown>;
    const url = art ? art.url ?? (typeof spec.url === 'string' ? spec.url : typeof spec.href === 'string' ? spec.href : null) : null;
    if (art && url && art.kind !== 'markdown') {
      image = { artifactId: art.id, url, caption: row.title };
    }
  }
  return { ok: true, content: { releaseId, title: row.title, text, image } };
}

/**
 * Slack's mrkdwn escapes, so the words land as written.
 * @param text - Plain text.
 */
function mrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * How the picture travelled, in the words the run and the page say it.
 * @param media - What the adapter reported.
 * @param hadImage - Whether there was a picture to carry.
 */
export function mediaLine(media: string, hadImage: boolean): string {
  if (!hadImage) {
    return 'with no picture (the release has none)';
  }
  if (media === 'uploaded' || media === 'blocks') {
    return 'with its picture';
  }
  return 'without its picture: the Slack app could not upload it (it needs the files:write scope), so the post links to it instead';
}

/**
 * Merge fields onto the release's metadata, or remove them.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 * @param set - Fields to write.
 * @param remove - Fields to delete.
 */
async function writeRelease(orgId: string, releaseId: number, set: Record<string, unknown>, remove: string[] = []): Promise<void> {
  let next = sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`;
  for (const key of remove) {
    next = sql`(${next}) - ${key}::text`;
  }
  await db
    .update(businessObjectSchema)
    .set({ metadata: next, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, releaseId)));
}

/**
 * Post the announcement to the workspace's Slack channel with its picture,
 * and record it on the release. Throws with a sentence a person can act on
 * when it cannot post — after writing that sentence on the release, so the
 * page says it too.
 * @param opts - What to publish.
 * @param opts.orgId - The workspace.
 * @param opts.releaseId - The release.
 * @param opts.runId - The `release.announce` run doing it, for Undo.
 * @param opts.by - Who published it.
 * @param opts.now - Clock, for tests.
 */
export async function publishAnnouncementToSlack(opts: { orgId: string; releaseId: number; runId?: number | null; by?: string | null; now?: Date }): Promise<{ post: AnnouncedPost; line: string }> {
  const at = (opts.now ?? new Date()).toISOString();
  const fail = async (error: string): Promise<never> => {
    await writeRelease(opts.orgId, opts.releaseId, { announceFailure: { at, error, surface: 'slack' } }).catch(() => undefined);
    throw new Error(error);
  };
  const found = await announcementContent(opts.orgId, opts.releaseId);
  if (!found.ok) {
    throw new Error(found.error);
  }
  const { content } = found;
  const channel = await slackAnnounceChannel(opts.orgId);
  if (!channel) {
    return fail('This workspace has no Slack connection (a Slack app and a bound channel), so there is nowhere to post it. Copy it from the release page instead.');
  }
  const [{ getSurface }, { postAnnouncementToChannel }] = await Promise.all([import('@/libs/surfaces/registry'), import('@/services/ChatSurfaceService')]);
  const adapter = getSurface('slack');
  if (!adapter) {
    return fail('The Slack surface is not registered on this deployment.');
  }
  const image = content.image;
  const result = await postAnnouncementToChannel(adapter, {
    orgId: opts.orgId,
    channelId: channel.channelId,
    teamId: channel.teamId,
    text: mrkdwn(content.text),
    images: image ? [{ url: image.url, caption: image.caption }] : [],
    // An external picture Slack fetches itself; a stored one is read here and uploaded.
    fetchImage: image && !isExternalHttpUrl(image.url) ? async img => (img.url === image.url ? artifactImageBytes(opts.orgId, image.artifactId) : null) : undefined,
    announcedLabel: content.title,
    createdBy: opts.by ?? null,
  }).catch((err: unknown) => ({ outcome: 'failed' as const, error: (err as Error).message }));
  if (result.outcome === 'unbound') {
    return fail('The Slack channel this workspace bound is not bound any more; bind it again and publish.');
  }
  if (result.outcome === 'failed') {
    return fail(`Slack refused the post: ${result.error}.`);
  }
  const post: AnnouncedPost = { surface: 'slack', channelId: result.channelId, ts: result.ts || null, fileIds: result.fileIds, media: result.media, runId: opts.runId ?? null };
  const [row] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, opts.orgId), eq(businessObjectSchema.id, opts.releaseId))).limit(1);
  const before = ((row?.meta ?? {}) as Record<string, unknown>).announcedTo;
  const to = before && typeof before === 'object' && !Array.isArray(before) ? before as Record<string, unknown> : {};
  const channels = [...new Set([...(Array.isArray(to.channels) ? to.channels.map(String) : []), 'Slack'])];
  await writeRelease(opts.orgId, opts.releaseId, { announcedAt: at, announcementState: 'published', announcedTo: { ...to, channels, post } }, ['announceFailure']);
  return { post, line: `Posted to Slack ${mediaLine(result.media, Boolean(image))}.` };
}

/**
 * Undo a published post: delete it in Slack and put the release back to
 * approved, words kept.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 * @param post - Where it landed, from the run's result.
 */
export async function unpublishAnnouncement(orgId: string, releaseId: number, post: Pick<AnnouncedPost, 'channelId' | 'ts' | 'fileIds'>): Promise<{ line: string }> {
  const { deleteSlackPost } = await import('@/libs/surfaces/slack');
  const out = await deleteSlackPost(post, slackToken() ?? undefined);
  if (!out.ok) {
    throw new Error(`Slack would not delete the post: ${out.error}.`);
  }
  const [row] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, releaseId))).limit(1);
  const meta = (row?.meta ?? {}) as Record<string, unknown>;
  const to = meta.announcedTo && typeof meta.announcedTo === 'object' ? { ...(meta.announcedTo as Record<string, unknown>) } : {};
  delete to.post;
  to.channels = (Array.isArray(to.channels) ? to.channels.map(String) : []).filter(c => c !== 'Slack');
  await writeRelease(orgId, releaseId, { announcedTo: to, announcementState: meta.notesSource === 'human' ? 'approved' : 'draft' }, ['announcedAt']);
  return { line: 'The Slack post is deleted; the announcement is back to unpublished, its words kept.' };
}
