/**
 * chat.post_message (formerly slack.post_message) — post a message to a chat
 * channel this workspace bound. Slack is the first provider of the chat family;
 * the binding's surface says which one a channel is on.
 *
 * The generic "tell the channel" write. An agent proposes the words; the card
 * shows them as a message a reviewer can edit before approving; approving
 * posts them under the deployment's Slack app (or the channel's persona) and
 * records the post; Undo deletes it. A proposal that names no channel goes
 * to the workspace's first bound channel — the same one `release.announce`
 * and notifications use (`services/chat/boundChannel.ts`). A channel the
 * workspace did not bind is not a target, however it was named.
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
  /** A channel this workspace bound. Omitted: the workspace's first bound channel. */
  channelId: z.string().min(1).optional(),
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
  description: 'Post a message to a Slack channel this workspace has bound, under the deployment\'s Slack app or the channel\'s persona. The workspace\'s first bound channel when none is named. Undo deletes the post.',
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
    const { boundSlackChannel } = await import('@/services/chat/boundChannel');
    const channel = await boundSlackChannel(ctx.orgId, input.channelId);
    if (channel) {
      return;
    }
    return input.channelId
      ? `Slack channel ${input.channelId} is not bound to this workspace, so nothing can post there. Bind it (POST /api/v1/chat-bindings) and propose again.`
      : 'This workspace has no Slack channel bound, so there is nowhere to post. Bind a channel (POST /api/v1/chat-bindings) and propose again.';
  },
  async reviewCard(ctx, input): Promise<ReviewCard> {
    const { boundSlackChannel } = await import('@/services/chat/boundChannel');
    const channel = await boundSlackChannel(ctx.orgId, input.channelId).catch(() => null);
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
    const [{ boundSlackChannel }, { getSurface }, { postAnnouncementToChannel }] = await Promise.all([
      import('@/services/chat/boundChannel'),
      import('@/libs/surfaces/registry'),
      import('@/services/ChatSurfaceService'),
    ]);
    const channel = await boundSlackChannel(ctx.orgId, input.channelId);
    if (!channel) {
      throw new Error(input.channelId
        ? `Slack channel ${input.channelId} is not bound to this workspace any more; bind it again and approve.`
        : 'This workspace has no Slack channel bound any more; bind one and approve.');
    }
    const adapter = getSurface('slack');
    if (!adapter) {
      throw new Error('This deployment has no Slack surface, so nothing can post.');
    }
    const result = await postAnnouncementToChannel(adapter, {
      orgId: ctx.orgId,
      channelId: channel.channelId,
      teamId: channel.teamId,
      text: input.text,
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
    return { posted: true, post, line: `Posted to Slack channel ${result.channelId}.` };
  },
  async undo(_ctx, _input, result) {
    const post = (result?.post ?? null) as PostedTo | null;
    if (!post?.channelId || !post.ts) {
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
