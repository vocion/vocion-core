/**
 * `chat.reply_in_thread` — answer where they asked.
 *
 * A request that came in as a chat thread is answered in that thread: the
 * plan, the honest "not this quarter", the "shipped in v1.8". The words are
 * the agent's; the card shows them as a message a reviewer can edit before
 * approving; approving posts them in the thread with the token that is in
 * that chat (`services/chat/provider.ts`: the slack source's bot, or the
 * deployment's); Undo deletes the reply.
 *
 * Telling an asker is two different things, and the ladder tells them apart
 * the way `notify.requester` does: a routine, evidenced completion may earn
 * its way out under a policy the product owner turns on; a decline, an
 * incident update or anything touching a promise is read by a person every
 * time. The proposer names the kind, and the key becomes
 * `chat.reply_in_thread.<kind>`; a kind with no rule reads the parent's
 * (`parentRuleGoverns`).
 */

import type { Action, ReviewCard } from './types';
import type { ChatKind } from '@/services/chat/provider';
import { z } from 'zod';
import { parseAnyChatPermalink } from '@/services/chat/permalinks';

export const REPLY_IN_THREAD_ACTION_ID = 'chat.reply_in_thread';

export const REPLY_KINDS = ['completion', 'sensitive', 'update'] as const;

const replyInput = z.object({
  permalink: z.string().url().optional().describe('A link to a message in the thread to answer in.'),
  channelId: z.string().min(1).optional().describe('The channel, when giving ids instead of a link.'),
  threadTs: z.string().min(1).optional().describe('The thread\'s parent message id in that channel.'),
  text: z.string().min(1).max(4000).describe('The reply, as the chat renders it.'),
  kind: z.enum(REPLY_KINDS).optional().describe('completion: a shipped change with its evidence; sensitive: a decline, an incident, a promise; update: progress. Decides which trust rule reads it.'),
  about: z.string().min(1).max(200).optional().describe('The record the reply is about (request:12), so two pending replies about it in one thread are one card.'),
}).refine(v => Boolean(v.permalink) || Boolean(v.channelId && v.threadTs), { message: 'give a permalink, or channelId and threadTs' });

type Input = z.infer<typeof replyInput>;

/**
 * The thread an input names, without a token: for the dedup key and the card.
 * @param input - The proposal's input.
 */
function threadOf(input: Pick<Input, 'permalink' | 'channelId' | 'threadTs'>): { channelId: string; threadTs: string; kind?: ChatKind } | null {
  if (input.channelId && input.threadTs) {
    return { channelId: input.channelId, threadTs: input.threadTs };
  }
  if (!input.permalink) {
    return null;
  }
  // Pure: the permalink parsers need no token.
  const ref = parseAnyChatPermalink(input.permalink);
  return ref ? { channelId: ref.channelId, threadTs: ref.threadTs ?? ref.ts, ...(ref.kind ? { kind: ref.kind } : {}) } : null;
}

type Posted = { channelId: string; threadTs: string; ts: string; kind?: ChatKind };

export const chatReplyInThreadAction: Action<typeof replyInput> = {
  id: REPLY_IN_THREAD_ACTION_ID,
  name: 'Reply in a chat thread',
  description: 'Reply in the thread an ask came from, in the connected chat, with the token that is in that chat. Name the kind: completion (shipped, with evidence), sensitive (a decline, an incident, a promise) or update. Undo deletes the reply.',
  inputSchema: replyInput,
  grant: 'send_message',
  external: true,
  policyKeyFor: input => (input.kind ? `${REPLY_IN_THREAD_ACTION_ID}.${input.kind}` : REPLY_IN_THREAD_ACTION_ID),
  parentRuleGoverns: true,
  dedupKeyFor: (input) => {
    if (!input.about) {
      return undefined;
    }
    const thread = threadOf(input);
    return `${REPLY_IN_THREAD_ACTION_ID}:${thread ? `${thread.channelId}:${thread.threadTs}` : input.permalink}:${input.about}`.toLowerCase();
  },
  async precheck(ctx, input) {
    if (!threadOf(input)) {
      return `${input.permalink} is not a link to a chat message; give the message's permalink, or its channelId and threadTs.`;
    }
    const { chatTokenFor } = await import('@/services/chat/provider');
    if (!(await chatTokenFor(ctx.orgId, threadOf(input)?.kind))) {
      return 'This workspace has no chat connected, so there is no thread to reply in. Connect Slack or Discord at /dashboard/connectors and propose again.';
    }
    return undefined;
  },
  async reviewCard(_ctx, input): Promise<ReviewCard> {
    const thread = threadOf(input);
    const where = thread ? `the thread in channel ${thread.channelId}` : 'the thread';
    return {
      title: input.about ? `Reply in the thread — ${input.about}` : 'Reply in the thread',
      system: 'Chat',
      headline: `Approving posts this reply in ${where} now. Undo deletes it.`,
      badges: [{ label: 'Chat' }, { label: 'Reversible' }, ...(input.kind ? [{ label: input.kind, ...(input.kind === 'sensitive' ? { tone: 'warn' as const } : {}) }] : [])],
      contentHeading: { label: 'Reply' },
      content: [{ kind: 'message' as const, id: 'message', label: 'Reply', body: input.text }],
      fields: [
        ...(input.permalink ? [{ label: 'Thread', value: input.permalink, href: input.permalink }] : thread ? [{ label: 'Thread', value: `${thread.channelId} · ${thread.threadTs}` }] : []),
        ...(input.kind ? [{ label: 'Kind', value: input.kind }] : []),
        ...(input.about ? [{ label: 'About', value: input.about }] : []),
      ],
      nextAction: `Approving posts this reply in ${where} now. Undo deletes it.`,
      verbs: { approve: 'Approve & reply', reject: 'Decline' },
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'message');
    return edit?.body === undefined ? input : { ...input, text: edit.body };
  },
  async execute(ctx, input) {
    const thread = threadOf(input);
    if (!thread) {
      throw new Error('The reply names no thread.');
    }
    const [{ chatProviderFor }, { recordSlackPost }] = await Promise.all([import('@/services/chat/provider'), import('@/services/chat/slackPosts')]);
    const provider = await chatProviderFor(ctx.orgId, thread.kind);
    const { ts } = await provider.postInThread({ channelId: thread.channelId, threadTs: thread.threadTs, text: input.text });
    if (ts && provider.kind !== 'discord') {
      await recordSlackPost({ orgId: ctx.orgId, projectId: ctx.orgId, channelId: thread.channelId, ts, threadTs: thread.threadTs, kind: 'reply', agentSlug: ctx.invokedBy?.startsWith('agent:') ? ctx.invokedBy.slice('agent:'.length) : null, text: input.text, createdBy: ctx.reviewedBy ?? ctx.invokedBy ?? null }).catch(() => null);
    }
    const post: Posted = { channelId: thread.channelId, threadTs: thread.threadTs, ts, kind: provider.kind };
    return { replied: true, post, line: `Replied in the thread in channel ${thread.channelId}.` };
  },
  async undo(ctx, _input, result) {
    const post = (result?.post ?? null) as Posted | null;
    if (!post?.channelId || !post.ts) {
      throw new Error('This run recorded no reply, so there is nothing to take back.');
    }
    const { chatProviderFor } = await import('@/services/chat/provider');
    const provider = await chatProviderFor(ctx.orgId, post.kind);
    const out = await provider.deleteMessage({ channelId: post.channelId, ts: post.ts });
    if (!out.ok) {
      throw new Error(`The chat would not delete the reply: ${out.error}`);
    }
    return { deleted: true, post, line: `Deleted the reply from channel ${post.channelId}.` };
  },
};
