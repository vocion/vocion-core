import type { BoundSlackChannel } from './boundChannel';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { slackToken } from '@/libs/notifications/slack';
import { canOpenArtifact } from '@/libs/share/audience';
import { conversationInfo } from '@/libs/surfaces/slackRead';
import { artifactSchema } from '@/models/Schema';
import { boundSlackChannel, listBoundSlackChannels } from './boundChannel';

/**
 * WHERE A PROPOSED POST GOES, AND WHAT IT CARRIES (walk 26, 2026-10-06).
 *
 * Asked to post in "#vocion-slack-test", an agent proposed `chat.post_message`
 * with no channel; the action fell back to the workspace's first binding,
 * which was a person's DM, and the announcement went there. Two rules now:
 *
 * - A channel can be named the way a person names it (`#vocion-slack-test`)
 *   and is looked up among the channels this workspace bound; a name that
 *   matches none is refused, with the bound ones listed.
 * - Naming no channel only falls back to a real channel. When the first
 *   binding is a direct message the proposal is refused and asked to name one.
 *
 * And a post can carry pictures and videos the workspace already holds
 * (artifact ids), uploaded into Slack as files — the feature demo and the
 * live screenshot, rather than words about them.
 */

/** A Slack id: C… public, G… private, D… direct message. */
const SLACK_ID = /^[CDG][A-Z0-9]{6,}$/;

/**
 * True for a direct-message channel id.
 * @param channelId - Slack channel id.
 */
export function isDirectMessage(channelId: string): boolean {
  return /^D[A-Z0-9]+$/.test(channelId);
}

export type PostChannel = { ok: true; channel: BoundSlackChannel } | { ok: false; reason: string };

/**
 * The bound channel a post goes to.
 * @param orgId - The workspace.
 * @param named - A channel id, `#name` or name; omitted for the default.
 * @param deps - Seams for tests.
 * @param deps.channelName - Slack's name for a channel id, or null when it cannot say.
 */
export async function resolvePostChannel(
  orgId: string,
  named?: string | null,
  deps: { channelName?: (channelId: string) => Promise<string | null> } = {},
): Promise<PostChannel> {
  const all = await listBoundSlackChannels(orgId);
  if (all.length === 0) {
    return { ok: false, reason: named
      ? `Slack channel ${named} is not bound to this workspace, so nothing can post there. Bind it (POST /api/v1/chat-bindings) and propose again.`
      : 'This workspace has no Slack channel bound, so there is nowhere to post. Bind a channel (POST /api/v1/chat-bindings) and propose again.' };
  }
  const nameOf = deps.channelName ?? (async (id: string) => {
    const info = await conversationInfo(id, slackToken() ?? undefined).catch(() => null);
    return info?.ok ? info.value.name : null;
  });
  const list = async () => (await Promise.all(all.map(async b => (isDirectMessage(b.channelId) ? `${b.channelId} (a direct message)` : `#${await nameOf(b.channelId) ?? '?'} (${b.channelId})`)))).join(', ');
  const want = named?.trim();
  if (!want) {
    const first = all[0]!;
    if (isDirectMessage(first.channelId)) {
      return { ok: false, reason: `This workspace's first bound Slack channel is a direct message, so a post that names no channel is not sent there. Name the channel to post to: ${await list()}.` };
    }
    return { ok: true, channel: first };
  }
  if (SLACK_ID.test(want)) {
    const channel = await boundSlackChannel(orgId, want);
    return channel ? { ok: true, channel } : { ok: false, reason: `Slack channel ${want} is not bound to this workspace, so nothing can post there. Bound: ${await list()}. Bind it (POST /api/v1/chat-bindings) and propose again.` };
  }
  const name = want.replace(/^#/, '').toLowerCase();
  for (const b of all) {
    if (!isDirectMessage(b.channelId) && (await nameOf(b.channelId))?.toLowerCase() === name) {
      return { ok: true, channel: b };
    }
  }
  return { ok: false, reason: `No Slack channel named #${name} is bound to this workspace. Bound: ${await list()}. Pass one of those, or bind #${name} (POST /api/v1/chat-bindings) and propose again.` };
}

/** One file a post carries, with the bytes Slack is handed. */
export type PostAttachment = { artifactId: number; url: string; caption: string; filename: string; bytes: Uint8Array };

/** What Slack can show as a file on a message. */
const ATTACHABLE = /\.(?:png|jpe?g|gif|webp|mp4|webm|mov)$/i;

/**
 * The pictures and videos a post carries: artifacts this workspace holds,
 * open to its members (never one kept to its owner), read as bytes.
 * @param orgId - The workspace.
 * @param ids - Artifact ids.
 * @param deps - Seams for tests.
 * @param deps.read - Bytes behind an artifact, or null.
 */
export async function postAttachments(
  orgId: string,
  ids: readonly number[],
  deps: { read?: (orgId: string, artifactId: number, url: string) => Promise<Uint8Array | null> } = {},
): Promise<{ ok: true; files: PostAttachment[] } | { ok: false; reason: string }> {
  const read = deps.read ?? readAttachmentBytes;
  const files: PostAttachment[] = [];
  for (const id of ids) {
    const [row] = await db
      .select({ title: artifactSchema.title, url: artifactSchema.url, spec: artifactSchema.spec, shareAudience: artifactSchema.shareAudience, shareOwnerId: artifactSchema.shareOwnerId })
      .from(artifactSchema)
      .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.id, id)))
      .limit(1);
    if (!row || !canOpenArtifact({ audience: row.shareAudience, ownerId: row.shareOwnerId }, { userId: null, hasToken: false, isMember: true })) {
      return { ok: false, reason: `Artifact ${id} is not one this workspace's members can open, so it cannot go on a post.` };
    }
    const spec = (row.spec ?? {}) as Record<string, unknown>;
    const url = row.url || (typeof spec.url === 'string' ? spec.url : '');
    const filename = url.split(/[?#]/)[0]!.split('/').pop() ?? '';
    if (!ATTACHABLE.test(filename)) {
      return { ok: false, reason: `Artifact ${id} ("${row.title}") is not a picture or a video, so it cannot go on a post.` };
    }
    const bytes = await read(orgId, id, url);
    if (!bytes) {
      return { ok: false, reason: `Artifact ${id} ("${row.title}") could not be read, so the post would go without it.` };
    }
    const caption = typeof spec.caption === 'string' && spec.caption.trim() ? spec.caption.trim() : row.title;
    files.push({ artifactId: id, url, caption, filename, bytes });
  }
  return { ok: true, files };
}

/**
 * The bytes behind a stored picture (`/api/artifacts/…`) or recording (`/api/media/…`).
 * @param orgId - The workspace.
 * @param artifactId - The artifact row.
 * @param url - Its stored URL.
 */
async function readAttachmentBytes(orgId: string, artifactId: number, url: string): Promise<Uint8Array | null> {
  if (url.startsWith('/api/media/')) {
    const { readMediaBytes } = await import('@/libs/tools/artifacts/media');
    return (await readMediaBytes(orgId, url))?.bytes ?? null;
  }
  const { artifactImageBytes } = await import('@/services/factory/releaseAnnounce');
  return artifactImageBytes(orgId, artifactId);
}
