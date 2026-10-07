import type { ChannelConversation, ConversationChannel } from './conversationChannel';
import type { ChatImage } from '@/libs/surfaces/types';
import { absoluteAppLinks } from '@/libs/links';

/**
 * SAY IT WHERE THEY ASKED (Chris, 2026-10-06: "update me if it was blocked … if it needed a human
 * to merge … my next update when it's in production and ready to review, inside that same
 * thread"). One way for anything outside a chat turn to talk to the person who asked: the line is
 * added to the conversation, so the app's chat shows it, and when that conversation lives on a
 * medium too (a Slack thread, an email thread: `channels.ts`) it is said there as well, through
 * that medium's channel, with its files.
 *
 * Before this, two jobs did half each (the app's chat, or the thread) with their own once-only
 * rules and wording. Now the record's moves (`jobs/askerFollow.ts`) and a filed recording both
 * come through here, and `key` is the once-only rule: a key already said is not said again,
 * whatever the words became.
 */

/** A Slack thread named by a conversation's scope: `slack:<channel>:<thread ts>`. */
export type SlackThreadRef = { channelId: string; threadTs: string };

/**
 * The Slack thread a conversation was created for, from its scope ref, or null when the
 * conversation did not come from Slack (`ChatSurfaceService.handleInbound` writes the scope).
 * @param scopeRef - The conversation's `scopeRef`.
 */
export function slackThreadOfScope(scopeRef: string | null | undefined): SlackThreadRef | null {
  const m = /^slack:([^:]+):([^:]+)$/.exec(scopeRef ?? '');
  return m ? { channelId: m[1]!, threadTs: m[2]! } : null;
}

/** A file the line carries: a stored recording or picture (`/api/media/…`, `/api/artifacts/…`). */
export type TellFile = { url: string; caption: string; artifactId?: number };

/**
 * The bytes behind a file a line carries: a stored recording (`/api/media/…`) or a stored picture.
 * @param orgId - The workspace.
 * @param f - The file.
 */
export async function tellFileBytes(orgId: string, f: TellFile): Promise<Uint8Array | null> {
  if (f.url.startsWith('/api/media/')) {
    const { readMediaBytes } = await import('@/libs/tools/artifacts/media');
    return (await readMediaBytes(orgId, f.url))?.bytes ?? null;
  }
  if (!f.artifactId) {
    return null;
  }
  const { artifactImageBytes } = await import('@/services/factory/releaseAnnounce');
  return artifactImageBytes(orgId, f.artifactId);
}

/**
 * Files as the images a chat post carries, named for the upload, with their bytes read on demand.
 * @param orgId - The workspace.
 * @param files - The files.
 */
export function tellImages(orgId: string, files: readonly TellFile[]): { images: ChatImage[]; fetchImage: (img: { url: string }) => Promise<Uint8Array | null> } {
  const byUrl = new Map(files.map(f => [f.url, f]));
  const images = files.map((f) => {
    const name = f.url.split(/[?#]/)[0]!.split('/').pop();
    return { url: f.url, caption: f.caption, ...(name ? { filename: name } : {}) };
  });
  return { images, fetchImage: async img => (byUrl.has(img.url) ? tellFileBytes(orgId, byUrl.get(img.url)!) : null) };
}

export type TellResult = { said: true; channel: string } | { said: false; reason: string };

export type TellDeps = {
  conversation: (orgId: string, conversationId: number) => Promise<ChannelConversation | null>;
  /** The medium the conversation reaches its person through, or null for the app alone (`channels.ts`). */
  channel: (c: ChannelConversation) => Promise<ConversationChannel | null>;
  /** Whether these exact words are already among the app conversation's answers. */
  saidInApp: (conversationId: number, text: string) => Promise<boolean>;
  append: (orgId: string, conversationId: number, text: string, agentSlug: string | null) => Promise<void>;
};

const defaultDeps: TellDeps = {
  async conversation(orgId, conversationId) {
    const { getConversation } = await import('@/services/ConversationService');
    const c = await getConversation({ orgId, id: conversationId });
    return c ? { id: c.id, surface: c.surface, scopeRef: c.scopeRef ?? null, agentSlug: c.agentSlug ?? null } : null;
  },
  channel: async c => (await import('./channels')).channelFor(c),
  saidInApp: async (conversationId, text) => (await import('./conversationChannel')).saidInConversation(conversationId, text),
  async append(orgId, conversationId, text, agentSlug) {
    const { appendMessage } = await import('@/services/ConversationService');
    await appendMessage({ orgId, conversationId, role: 'assistant', content: text, status: 'complete', ...(agentSlug ? { agentSlug } : {}) });
  },
};

/**
 * Tell a conversation one thing, once per `key`: added to the app's chat, and posted to the Slack
 * thread when the conversation is one. Never throws; what was not said comes back as the reason.
 * @param orgId - The workspace.
 * @param conversationId - The conversation the person asked in.
 * @param text - The line, in markdown; app links are made absolute for Slack.
 * @param opts - The once-only key, files to carry, and `threadOnly` for what only a thread wants.
 * @param opts.key - Said once per conversation (`request:478:seen_live:…`).
 * @param opts.files - Pictures or recordings uploaded under the words in Slack.
 * @param opts.threadOnly - Say it only when the conversation is a Slack thread.
 * @param opts.url - What the line is about, kept on the Slack post.
 * @param deps - Seams for tests.
 */
export async function tellConversation(orgId: string, conversationId: number, text: string, opts: { key: string; files?: readonly TellFile[]; threadOnly?: boolean; url?: string | null }, deps: TellDeps = defaultDeps): Promise<TellResult> {
  try {
    const conversation = await deps.conversation(orgId, conversationId);
    if (!conversation) {
      return { said: false, reason: 'the conversation is gone' };
    }
    const channel = await deps.channel(conversation);
    if (!channel && opts.threadOnly) {
      return { said: false, reason: 'the conversation lives only in the app' };
    }
    if (!channel && conversation.surface === 'mcp') {
      // An MCP client's conversation is the client's; nobody reads it in the app.
      return { said: false, reason: 'the conversation came over MCP, where nobody reads it' };
    }
    // Words that leave the app carry absolute links; the app's chat renders its own.
    const out = channel ? absoluteAppLinks(text) : text;
    if (channel ? await channel.alreadySaid(orgId, conversation, opts.key, out) : await deps.saidInApp(conversation.id, text)) {
      return { said: false, reason: 'already said here' };
    }
    await deps.append(orgId, conversationId, text, conversation.agentSlug);
    if (!channel) {
      return { said: true, channel: 'chat' };
    }
    const reached = await channel.say(orgId, conversation, out, { key: opts.key, files: opts.files ?? [], url: opts.url ?? null }).catch(() => false);
    return { said: true, channel: reached ? channel.surface : 'chat' };
  } catch (err) {
    return { said: false, reason: `not said: ${(err as Error).message}` };
  }
}
