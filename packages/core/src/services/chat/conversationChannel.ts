import type { TellFile } from './tellConversation';

/**
 * A CONVERSATION'S WAY OUT (Chris, 2026-10-06: "Is this extended to any chat asks/cards and
 * answers via message? Extendable to SMS and email?" … "Build as foundation").
 *
 * A conversation lives in the app; some also live somewhere a person is: a Slack thread, an email
 * thread, one day a text thread. A channel is what Vocion needs to reach the person there and to
 * know who answered: say a line in that thread (with its pictures, or links where the medium has
 * no pictures), whether a line was already said there, and which Vocion member a sender is. The
 * record's moves (`tellConversation`) and a reply that decides a card (`approvalFromThread`)
 * both go through this, so a new medium is one channel, registered here, and nothing else.
 */

/** A conversation as a channel reads it. */
export type ChannelConversation = { id: number; surface: string; scopeRef: string | null; agentSlug: string | null };

/** The Vocion member behind a sender, or who the sender said they were when there is none. */
export type ChannelMember = { userId: string; name: string; email: string } | { userId: null; email: string | null };

export type ConversationChannel = {
  /** The surface name a conversation and an inbound message carry (`slack`, `email`, `sms`). */
  surface: string;
  /** Whether this conversation is one of this channel's threads. */
  owns: (c: ChannelConversation) => boolean;
  /** Say one line in the conversation's thread, with its files. True when the medium took it. */
  say: (orgId: string, c: ChannelConversation, text: string, opts: { key: string; files: readonly TellFile[]; url: string | null }) => Promise<boolean>;
  /** Whether this key, or these words, were already said in the thread. */
  alreadySaid: (orgId: string, c: ChannelConversation, key: string, text: string) => Promise<boolean>;
  /** The Vocion member behind a sender's id on this medium. */
  memberOf: (orgId: string, externalUserId: string) => Promise<ChannelMember>;
  /** How a sender becomes someone Vocion knows here, for the line that says it cannot decide yet. */
  signInHint: (email: string | null) => string;
};

const channels = new Map<string, ConversationChannel>();

/**
 * Add a medium.
 * @param channel - The channel.
 */
export function registerChannel(channel: ConversationChannel): void {
  channels.set(channel.surface, channel);
}

/**
 * The channel a conversation reaches its person through, or null for one that lives only in the app.
 * @param c - The conversation.
 */
export function channelFor(c: ChannelConversation): ConversationChannel | null {
  for (const ch of channels.values()) {
    if (ch.owns(c)) {
      return ch;
    }
  }
  return null;
}

/**
 * The channel for a surface name, for an inbound message.
 * @param surface - `slack`, `email`, …
 */
export function channelBySurface(surface: string): ConversationChannel | null {
  return channels.get(surface) ?? null;
}

/**
 * The workspace member with this email, the one identity every medium can resolve to.
 * @param orgId - The workspace.
 * @param email - The address, any case.
 */
export async function memberByEmail(orgId: string, email: string | null): Promise<ChannelMember> {
  const address = email?.trim().toLowerCase() || null;
  if (!address) {
    return { userId: null, email: null };
  }
  const [{ db }, { eq }, { projectSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
  const [project] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (!project) {
    return { userId: null, email: address };
  }
  const { listMembers } = await import('@/services/MembersService');
  const hit = (await listMembers(project.accountId)).find(m => m.email.trim().toLowerCase() === address);
  return hit ? { userId: hit.userId, name: hit.name?.trim() || hit.email, email: address } : { userId: null, email: address };
}

/**
 * Whether these exact words are already among the conversation's last answers: the once-only
 * rule for a medium that keeps no record of its own posts.
 * @param conversationId - The conversation.
 * @param text - The words.
 */
export async function saidInConversation(conversationId: number, text: string): Promise<boolean> {
  const [{ db }, { and, desc, eq }, { conversationMessageSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
  const rows = await db.select({ content: conversationMessageSchema.content }).from(conversationMessageSchema).where(and(eq(conversationMessageSchema.conversationId, conversationId), eq(conversationMessageSchema.role, 'assistant'))).orderBy(desc(conversationMessageSchema.id)).limit(40);
  return rows.some(r => r.content === text);
}
