/**
 * msteams.post_message — post a message to a Microsoft Teams channel, or reply
 * in one of its threads, as the person whose Microsoft login the workspace
 * holds (`ChannelMessage.Send`, delegated).
 *
 * The words are on the card, editable before approving. `external: true` and
 * the `send_message` grant put it beside `chat.post_message` on the ladder
 * (`medium` by default, `DEFAULT_RISK_TIER`); a workspace's trust.yaml holds
 * or promotes it per rule.
 *
 * NOT REVERSIBLE here, and the card says so: Graph deletes a channel message
 * only with `ChannelMessage.ReadWrite`, a broader permission this connector
 * does not ask for. The person who posted can delete it in Teams.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

const teamsPostMessageInput = z.object({
  /** The team's id (from `msteams_list_channels`). */
  teamId: z.string().min(1),
  /** The channel's id, `19:…@thread.tacv2` (from `msteams_list_channels`). */
  channelId: z.string().min(1),
  /** The message, plain text; line breaks are kept. */
  text: z.string().min(1).max(20_000),
  /** A subject line for a new thread. Ignored on a reply. */
  subject: z.string().max(200).optional(),
  /** Reply in this thread (its root message id) instead of starting a new one. */
  replyToId: z.string().min(1).optional(),
  /** Names the channel or thread on the card, e.g. "Sales › General". */
  channelName: z.string().max(200).optional(),
  /**
   * A stable reference to what the post is about (`project:…`). Two PENDING
   * posts about the same thing in the same channel are one card.
   */
  about: z.string().min(1).max(200).optional(),
});

type Input = z.infer<typeof teamsPostMessageInput>;

/**
 * Plain text as the HTML body Teams renders, line breaks kept.
 * @param text - The message.
 */
export function teamsHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

/**
 * The Graph path a post goes to: a new thread in the channel, or a reply.
 * @param input - The action input.
 */
export function teamsPostPath(input: Pick<Input, 'teamId' | 'channelId' | 'replyToId'>): string {
  const channel = `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/messages`;
  return input.replyToId ? `${channel}/${encodeURIComponent(input.replyToId)}/replies` : channel;
}

export const TEAMS_POST_MESSAGE_ACTION_ID = 'msteams.post_message';

export const teamsPostMessageAction: Action<typeof teamsPostMessageInput> = {
  id: TEAMS_POST_MESSAGE_ACTION_ID,
  name: 'Post to a Teams channel',
  description: 'Post a message to a Microsoft Teams channel, or reply in one of its threads (`replyToId`), as the workspace\'s connected Microsoft account. Take `teamId` and `channelId` from msteams_list_channels. Not reversible from Vocion: the post can be deleted in Teams.',
  inputSchema: teamsPostMessageInput,
  grant: 'send_message',
  external: true,
  sourceSlug: 'microsoft-teams',
  dedupKeyFor: input => (input.about ? `${TEAMS_POST_MESSAGE_ACTION_ID}:${input.channelId}:${input.about}`.toLowerCase() : undefined),
  async precheck(ctx) {
    const { graphTokenForConnector } = await import('@/services/agents/tools/microsoft365');
    const got = await graphTokenForConnector(ctx.orgId, ['microsoft-teams']);
    return got.ok ? undefined : got.error;
  },
  async reviewCard(_ctx, input): Promise<ReviewCard> {
    const where = input.channelName ? `Teams channel ${input.channelName}` : 'a Teams channel';
    const headline = input.replyToId
      ? `Approving replies in a thread in ${where} now, as the connected Microsoft account. It cannot be undone from here.`
      : `Approving posts this message to ${where} now, as the connected Microsoft account. It cannot be undone from here.`;
    return {
      title: input.subject ? `Post to Teams — ${input.subject}` : 'Post to Teams',
      system: 'Microsoft Teams',
      headline,
      badges: [{ label: 'Microsoft Teams' }, { label: 'Irreversible', tone: 'warn' }],
      contentHeading: { label: 'Message' },
      content: [{ kind: 'message' as const, id: 'message', label: 'Message', body: input.text }],
      fields: [
        { label: 'Channel', value: input.channelName ?? input.channelId },
        ...(input.replyToId ? [{ label: 'In reply to', value: input.replyToId }] : []),
        ...(input.subject && !input.replyToId ? [{ label: 'Subject', value: input.subject }] : []),
        ...(input.about ? [{ label: 'About', value: input.about }] : []),
      ],
      nextAction: headline,
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
    const [{ graphTokenForConnector }, { graphJson }] = await Promise.all([
      import('@/services/agents/tools/microsoft365'),
      import('@/libs/microsoft/graph'),
    ]);
    const got = await graphTokenForConnector(ctx.orgId, ['microsoft-teams']);
    if (!got.ok) {
      throw new Error(got.error);
    }
    const posted = await graphJson<{ id?: string; webUrl?: string }>(got.token, {
      path: teamsPostPath(input),
      method: 'POST',
      what: 'a post to the Teams channel',
      body: {
        ...(input.subject && !input.replyToId ? { subject: input.subject } : {}),
        body: { contentType: 'html', content: teamsHtml(input.text) },
      },
    });
    const where = input.channelName ? `Teams channel ${input.channelName}` : 'the Teams channel';
    return {
      posted: true,
      messageId: posted.id ?? null,
      webUrl: posted.webUrl ?? null,
      teamId: input.teamId,
      channelId: input.channelId,
      replyToId: input.replyToId ?? null,
      line: `${input.replyToId ? 'Replied in a thread in' : 'Posted to'} ${where}.`,
    };
  },
};
