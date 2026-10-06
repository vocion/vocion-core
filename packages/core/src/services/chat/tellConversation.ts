import type { ChatImage } from '@/libs/surfaces/types';
import { absoluteAppLinks } from '@/libs/links';

/**
 * SAY IT WHERE THEY ASKED (Chris, 2026-10-06: "update me if it was blocked … if it needed a human
 * to merge … my next update when it's in production and ready to review, inside that same
 * thread"). One way for anything outside a chat turn to talk to the person who asked: the line is
 * added to the conversation, so the app's chat shows it, and when that conversation is a Slack
 * thread it is posted there too, wearing the agent's face, with its files uploaded under it.
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

export type TellResult = { said: true; channel: 'chat' | 'slack' } | { said: false; reason: string };

export type TellDeps = {
  conversation: (orgId: string, conversationId: number) => Promise<{ surface: string; scopeRef: string | null; agentSlug: string | null } | null>;
  /** Whether this key (or, in the app's chat, these exact words) was already said here. */
  alreadySaid: (orgId: string, conversationId: number, thread: SlackThreadRef | null, key: string, text: string) => Promise<boolean>;
  append: (orgId: string, conversationId: number, text: string, agentSlug: string | null) => Promise<void>;
  /** Post into the thread as the agent, files uploaded under the words; the post's ts, or null. */
  post: (orgId: string, thread: SlackThreadRef, text: string, agentSlug: string | null, files: readonly TellFile[]) => Promise<string | null>;
  remember: (input: { orgId: string; thread: SlackThreadRef; ts: string; text: string; key: string; agentSlug: string | null; url: string | null }) => Promise<void>;
};

const defaultDeps: TellDeps = {
  async conversation(orgId, conversationId) {
    const { getConversation } = await import('@/services/ConversationService');
    const c = await getConversation({ orgId, id: conversationId });
    return c ? { surface: c.surface, scopeRef: c.scopeRef ?? null, agentSlug: c.agentSlug ?? null } : null;
  },
  async alreadySaid(_orgId, conversationId, thread, key, text) {
    if (thread) {
      const { ourPostsInThread } = await import('@/services/chat/slackPosts');
      return (await ourPostsInThread(thread.channelId, thread.threadTs)).some(p => p.announcedLabel === key || p.text === text);
    }
    const { db } = await import('@/libs/DB');
    const { and, desc, eq } = await import('drizzle-orm');
    const { conversationMessageSchema } = await import('@/models/Schema');
    const rows = await db.select({ content: conversationMessageSchema.content }).from(conversationMessageSchema).where(and(eq(conversationMessageSchema.conversationId, conversationId), eq(conversationMessageSchema.role, 'assistant'))).orderBy(desc(conversationMessageSchema.id)).limit(40);
    return rows.some(r => r.content === text);
  },
  async append(orgId, conversationId, text, agentSlug) {
    const { appendMessage } = await import('@/services/ConversationService');
    await appendMessage({ orgId, conversationId, role: 'assistant', content: text, status: 'complete', ...(agentSlug ? { agentSlug } : {}) });
  },
  async post(orgId, thread, text, agentSlug, files) {
    const [{ getSurface }, { agentPersona }, { readMediaBytes }, { artifactImageBytes }] = await Promise.all([
      import('@/libs/surfaces/registry'),
      import('@/services/ChatSurfaceService'),
      import('@/libs/tools/artifacts/media'),
      import('@/services/factory/releaseAnnounce'),
    ]);
    const adapter = getSurface('slack');
    if (!adapter) {
      return null;
    }
    const persona = agentSlug ? await agentPersona(orgId, agentSlug).catch(() => null) : null;
    const images: ChatImage[] = files.map(f => ({ url: f.url, caption: f.caption, ...(f.url.split(/[?#]/)[0]!.split('/').pop() ? { filename: f.url.split(/[?#]/)[0]!.split('/').pop()! } : {}) }));
    const byUrl = new Map(files.map(f => [f.url, f]));
    const posted = await adapter.reply(
      { channelId: thread.channelId, threadRef: thread.threadTs, ...(persona?.displayName ? { displayName: persona.displayName } : {}), ...(persona?.iconUrl ? { iconUrl: persona.iconUrl } : {}) },
      { text, ...(images.length > 0 ? { images } : {}) },
      images.length > 0
        ? {
            fetchImage: async (img) => {
              const f = byUrl.get(img.url);
              if (!f) {
                return null;
              }
              return f.url.startsWith('/api/media/') ? (await readMediaBytes(orgId, f.url))?.bytes ?? null : f.artifactId ? artifactImageBytes(orgId, f.artifactId) : null;
            },
          }
        : undefined,
    );
    return posted?.ts ?? null;
  },
  async remember(input) {
    const { recordSlackPost } = await import('@/services/chat/slackPosts');
    await recordSlackPost({ orgId: input.orgId, channelId: input.thread.channelId, ts: input.ts, threadTs: input.thread.threadTs, kind: 'reply', agentSlug: input.agentSlug, text: input.text, announcedLabel: input.key, announcedUrl: input.url, createdBy: 'system:tell-conversation' });
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
    const thread = slackThreadOfScope(conversation.scopeRef);
    if (!thread && opts.threadOnly) {
      return { said: false, reason: 'the conversation is not a Slack thread' };
    }
    if (!thread && conversation.surface === 'mcp') {
      // An MCP client's conversation is the client's; nobody reads it in the app.
      return { said: false, reason: 'the conversation came over MCP, where nobody reads it' };
    }
    const out = thread ? absoluteAppLinks(text) : text;
    if (await deps.alreadySaid(orgId, conversationId, thread, opts.key, out)) {
      return { said: false, reason: 'already said here' };
    }
    await deps.append(orgId, conversationId, text, conversation.agentSlug);
    if (!thread) {
      return { said: true, channel: 'chat' };
    }
    const ts = await deps.post(orgId, thread, out, conversation.agentSlug, opts.files ?? []);
    await deps.remember({ orgId, thread, ts: ts ?? '', text: out, key: opts.key, agentSlug: conversation.agentSlug, url: opts.url ?? null });
    return { said: true, channel: 'slack' };
  } catch (err) {
    return { said: false, reason: `not said: ${(err as Error).message}` };
  }
}
