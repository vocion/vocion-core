/**
 * `chat.add_reaction` — the cheapest "we saw it".
 *
 * An eyes reaction on the message that became a request tells the asker it
 * was read without a reply nobody needs; a check mark when it ships closes
 * the loop in the thread itself. A reaction reaches a person, so it rides the
 * ladder like every write, but it changes no words and Undo removes it, so
 * the plugin runs it done for you. One already there counts as added, and one
 * already gone counts as removed: the outcome is the state of the message,
 * not the call.
 */

import type { Action } from './types';
import type { ChatKind } from '@/services/chat/provider';
import { z } from 'zod';
import { parseAnyChatPermalink } from '@/services/chat/permalinks';

export const ADD_REACTION_ACTION_ID = 'chat.add_reaction';

const reactionInput = z.object({
  permalink: z.string().url().optional().describe('A link to the message to react to.'),
  channelId: z.string().min(1).optional().describe('The channel, when giving ids instead of a link.'),
  ts: z.string().min(1).optional().describe('The message\'s id in that channel.'),
  name: z.string().regex(/^[a-z0-9_+-]+$/, 'an emoji short name without colons').max(60).describe('The reaction, as the chat names it without colons: eyes, white_check_mark, rocket.'),
  reason: z.string().max(300).optional().describe('What the reaction says, for the record: "read and filed as request #12".'),
}).refine(v => Boolean(v.permalink) || Boolean(v.channelId && v.ts), { message: 'give a permalink, or channelId and ts' });

type Input = z.infer<typeof reactionInput>;

/**
 * The message an input names, without a token.
 * @param input - The proposal's input.
 */
function messageOf(input: Pick<Input, 'permalink' | 'channelId' | 'ts'>): { channelId: string; ts: string; kind?: ChatKind } | null {
  if (input.channelId && input.ts) {
    return { channelId: input.channelId, ts: input.ts };
  }
  if (!input.permalink) {
    return null;
  }
  const ref = parseAnyChatPermalink(input.permalink);
  return ref ? { channelId: ref.channelId, ts: ref.ts, ...(ref.kind ? { kind: ref.kind } : {}) } : null;
}

export const chatAddReactionAction: Action<typeof reactionInput> = {
  id: ADD_REACTION_ACTION_ID,
  name: 'React to a chat message',
  description: 'Add a reaction to a message in the connected chat — eyes on an ask that became a request, white_check_mark when it shipped — with the token that is in that chat. Changes no words; Undo removes the reaction.',
  inputSchema: reactionInput,
  grant: 'send_message',
  external: true,
  dedupKeyFor: (input) => {
    const message = messageOf(input);
    return `${ADD_REACTION_ACTION_ID}:${message ? `${message.channelId}:${message.ts}` : input.permalink}:${input.name}`.toLowerCase();
  },
  ownsDedupKey: true,
  async precheck(ctx, input) {
    if (!messageOf(input)) {
      return `${input.permalink} is not a link to a chat message; give the message's permalink, or its channelId and ts.`;
    }
    const { chatTokenFor } = await import('@/services/chat/provider');
    if (!(await chatTokenFor(ctx.orgId, messageOf(input)?.kind))) {
      return 'This workspace has no chat connected, so there is no message to react to. Connect Slack or Discord at /dashboard/connectors and propose again.';
    }
    return undefined;
  },
  async reviewCard(_ctx, input) {
    const message = messageOf(input);
    return {
      title: `React :${input.name}: to a message${message ? ` in ${message.channelId}` : ''}`,
      system: 'Chat',
      headline: `Approving adds :${input.name}: to the message now. Undo removes it.`,
      badges: [{ label: 'Chat' }, { label: 'Reversible' }],
      fields: [
        ...(input.permalink ? [{ label: 'Message', value: input.permalink, href: input.permalink }] : message ? [{ label: 'Message', value: `${message.channelId} · ${message.ts}` }] : []),
        { label: 'Reaction', value: `:${input.name}:` },
        ...(input.reason ? [{ label: 'Says', value: input.reason }] : []),
      ],
      nextAction: `Approving adds :${input.name}: to the message now. Undo removes it.`,
      verbs: { approve: 'React', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const message = messageOf(input);
    if (!message) {
      throw new Error('The reaction names no message.');
    }
    const { chatProviderFor } = await import('@/services/chat/provider');
    const provider = await chatProviderFor(ctx.orgId, message.kind);
    const out = await provider.addReaction({ channelId: message.channelId, ts: message.ts, name: input.name });
    if (!out.ok) {
      throw new Error(`The chat would not add the reaction: ${out.error}`);
    }
    return { reacted: true, already: out.already, message, name: input.name, line: `${out.already ? 'Already had' : 'Added'} :${input.name}: on the message in channel ${message.channelId}.` };
  },
  async undo(ctx, input, result) {
    const message = (result?.message ?? messageOf(input)) as { channelId: string; ts: string; kind?: ChatKind } | null;
    if (!message) {
      throw new Error('This run recorded no message, so there is nothing to take back.');
    }
    const { chatProviderFor } = await import('@/services/chat/provider');
    const provider = await chatProviderFor(ctx.orgId, message.kind);
    const out = await provider.removeReaction({ channelId: message.channelId, ts: message.ts, name: input.name });
    if (!out.ok) {
      throw new Error(`The chat would not remove the reaction: ${out.error}`);
    }
    return { removed: true, absent: out.absent, message, name: input.name, line: `Removed :${input.name}: from the message in channel ${message.channelId}.` };
  },
};
