/**
 * chat.post_message (formerly slack.post_message) — post a message to a chat
 * channel this workspace bound. Slack is the first provider of the chat family;
 * the binding's surface says which one a channel is on.
 *
 * The generic "tell the channel" write. An agent proposes the words; the card
 * shows them as a message a reviewer can edit before approving; approving
 * posts them under the deployment's Slack app (or the channel's persona) and
 * records the post; Undo deletes it. A channel is named by id or the way a
 * person says it (`#vocion-slack-test`) and must be one this workspace bound.
 * A proposal that names none goes to the workspace's first bound channel —
 * unless that is a direct message, when it is refused and asked to name one
 * (walk 26: an announcement asked for a channel went to a DM). See
 * `services/chat/postTarget.ts`.
 *
 * `media` carries pictures and videos the workspace already holds (artifact
 * ids), uploaded into Slack as files under the message.
 *
 * A workspace that bound nothing is refused at the door (`precheck`), never
 * queued to fail on approval: an agent told "queued for approval" would say
 * so to a person, and nothing would ever post.
 *
 * `external: true` → an agent proposing this is gated by the ladder
 * (`medium` by default, `DEFAULT_RISK_TIER`, beside `gmail.send`); a
 * workspace's trust.yaml holds or promotes it per rule.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

const slackPostMessageInput = z.object({
  /** The message, as Slack renders it (mrkdwn). */
  text: z.string().min(1).max(4000),
  /**
   * A channel this workspace bound: its id (`C0…`) or its name as a person says it (`#vocion-slack-test`).
   * Omit only when the person named no channel; the default is the first bound channel, never a DM.
   */
  channelId: z.string().min(1).optional(),
  /** Pictures and videos to attach: ids of artifacts this workspace holds (a feature demo, a live screenshot). */
  media: z.array(z.number().int().positive()).max(4).optional(),
  /** What the post is about, for the card's title and the recorded post — "Margin flag — Northwind Portal". */
  title: z.string().min(1).max(140).optional(),
  /**
   * A stable reference to the record the post is about (`project:…`,
   * `release:…`). Two PENDING posts about the same thing in the same channel
   * are one card; a post with no `about` stands on its own.
   */
  about: z.string().min(1).max(200).optional(),
});

type Input = z.infer<typeof slackPostMessageInput>;

/**
 * `agent:<slug>` → the slug the post is attributed to; anything else → null.
 * @param invokedBy - `ActionContext.invokedBy`.
 */
function agentSlugOf(invokedBy: string | undefined): string | null {
  return invokedBy?.startsWith('agent:') ? invokedBy.slice('agent:'.length) : null;
}

/** Where the post landed, kept on the run so Undo can take it back. */
type PostedTo = { channelId: string; ts: string | null; fileIds: string[] };

export const POST_MESSAGE_ACTION_ID = 'chat.post_message';

export const slackPostMessageAction: Action<typeof slackPostMessageInput> = {
  id: POST_MESSAGE_ACTION_ID,
  aliases: ['slack.post_message'],
  name: 'Post a chat message',
  description: 'Post a message to a Slack channel this workspace has bound, under the deployment\'s Slack app or the channel\'s persona. When the person names a channel, pass it as `channelId` (its id or `#name`); with none named it goes to the first bound channel, never a DM. `media` attaches up to four pictures or videos the workspace holds, by artifact id. Undo deletes the post.',
  inputSchema: slackPostMessageInput,
  grant: 'send_message',
  external: true,
  dedupKeyFor: (input) => {
    if (!input.about) {
      return undefined;
    }
    return `${POST_MESSAGE_ACTION_ID}:${input.channelId ?? 'default'}:${input.about}`.toLowerCase();
  },
  async precheck(ctx, input) {
    const { resolvePostChannel, postAttachments } = await import('@/services/chat/postTarget');
    const where = await resolvePostChannel(ctx.orgId, input.channelId);
    if (!where.ok) {
      return where.reason;
    }
    if (input.media?.length) {
      const files = await postAttachments(ctx.orgId, input.media);
      if (!files.ok) {
        return files.reason;
      }
    }
    return undefined;
  },
  async reviewCard(ctx, input): Promise<ReviewCard> {
    const { resolvePostChannel } = await import('@/services/chat/postTarget');
    const resolved = await resolvePostChannel(ctx.orgId, input.channelId).catch(() => null);
    const channel = resolved?.ok ? resolved.channel : null;
    const where = channel
      ? `Slack channel ${channel.channelId}`
      : input.channelId
        ? `Slack channel ${input.channelId}`
        : 'the workspace\'s bound Slack channel';
    return {
      title: input.title ? `Post to Slack — ${input.title}` : 'Post to Slack',
      system: 'Slack',
      headline: `Approving posts this message to ${where} now. Undo deletes the post.`,
      badges: [{ label: 'Slack' }, { label: 'Reversible' }],
      contentHeading: { label: 'Message' },
      content: [{ kind: 'message' as const, id: 'message', label: 'Message', body: input.text }],
      fields: [
        { label: 'Channel', value: where },
        ...(channel ? [{ label: 'Bound to', value: channel.agentSlug }] : []),
        ...(input.about ? [{ label: 'About', value: input.about }] : []),
        ...(input.media?.length ? [{ label: 'Attached', value: input.media.map(id => `artifact ${id}`).join(', ') }] : []),
      ],
      nextAction: `Approving posts this message to ${where} now. Undo deletes the post.`,
      verbs: { approve: 'Approve & post', reject: 'Decline' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'message');
    if (!edit || edit.body === undefined) {
      return input;
    }
    return { ...input, text: edit.body };
  },
  async execute(ctx, input: Input) {
    const [{ resolvePostChannel, postAttachments }, { getSurface }, { postAnnouncementToChannel }] = await Promise.all([
      import('@/services/chat/postTarget'),
      import('@/libs/surfaces/registry'),
      import('@/services/ChatSurfaceService'),
    ]);
    const where = await resolvePostChannel(ctx.orgId, input.channelId);
    if (!where.ok) {
      throw new Error(where.reason);
    }
    const { channel } = where;
    const attached = input.media?.length ? await postAttachments(ctx.orgId, input.media) : { ok: true as const, files: [] };
    if (!attached.ok) {
      throw new Error(attached.reason);
    }
    const bytesByUrl = new Map(attached.files.map(f => [f.url, f.bytes]));
    const adapter = getSurface('slack');
    if (!adapter) {
      throw new Error('This deployment has no Slack surface, so nothing can post.');
    }
    const result = await postAnnouncementToChannel(adapter, {
      orgId: ctx.orgId,
      channelId: channel.channelId,
      teamId: channel.teamId,
      text: input.text,
      ...(attached.files.length
        ? {
            images: attached.files.map(f => ({ url: f.url, caption: f.caption, filename: f.filename })),
            fetchImage: async (img: { url: string }) => bytesByUrl.get(img.url) ?? null,
          }
        : {}),
      agentSlug: agentSlugOf(ctx.invokedBy),
      announcedLabel: input.title ?? null,
      createdBy: ctx.reviewedBy ?? ctx.invokedBy ?? null,
    });
    if (result.outcome === 'unbound') {
      throw new Error(`Slack channel ${channel.channelId} is not bound to this workspace any more; bind it again and approve.`);
    }
    if (result.outcome === 'failed') {
      throw new Error(`Slack did not take the message: ${result.error}`);
    }
    const post: PostedTo = { channelId: result.channelId, ts: result.ts || null, fileIds: result.fileIds };
    const carried = attached.files.length === 0 ? '' : result.media === 'uploaded' ? ` with ${attached.files.length} attached` : ' without its attachments (Slack would not take the upload; they are linked in the text)';
    return { posted: true, post, line: `Posted to Slack channel ${result.channelId}${carried}.` };
  },
  async undo(_ctx, _input, result) {
    const post = (result?.post ?? null) as PostedTo | null;
    // A post that carried files has no `ts` (the upload posted it); its files are what Undo deletes.
    if (!post?.channelId || (!post.ts && !post.fileIds?.length)) {
      throw new Error('This run recorded no post, so there is nothing to take back.');
    }
    const [{ deleteSlackPost }, { slackToken }] = await Promise.all([
      import('@/libs/surfaces/slack'),
      import('@/libs/notifications/slack'),
    ]);
    const out = await deleteSlackPost(post, slackToken() ?? undefined);
    if (!out.ok) {
      throw new Error(`Slack would not delete the post: ${out.error}`);
    }
    return { deleted: true, post, line: `Deleted the post from Slack channel ${post.channelId}.` };
  },
};
