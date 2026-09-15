/**
 * The thread a Slack mention arrived in, assembled into something an agent can
 * answer from.
 *
 * The incident this exists for: Vocion posted a release announcement, someone
 * replied in the thread "any screenshots to go with this?", and the agent
 * answered "no page context here — I can't tell what 'this' refers to". Three
 * separate things were wrong with that. It did not know the channel. It did
 * not know the message it was replying to, even though Vocion had WRITTEN that
 * message. And when it could not tell, it said nothing useful about why.
 *
 * So the context is built from three sources, in the order they cost nothing:
 *
 *   1. `slack_post` — our own outbound record. Needs no scope at all, and
 *      answers the commonest case, where the thread starts with our post.
 *   2. `users.info` — poster names. The app already holds `users:read`, so
 *      names never degrade.
 *   3. `conversations.info` / `conversations.replies` — the channel's name and
 *      the messages we did not write. These need scopes an install may not
 *      have granted, and when they are missing the gap is RECORDED, with the
 *      scope's name, rather than swallowed.
 *
 * Nothing here throws on a missing scope: a thread half-read is still a thread.
 */

import type { ContextGap, PageContext, ThreadContext, ThreadPost } from './pageContext';
import type { SlackPost } from './slackPosts';
import type { ChatInbound } from '@/libs/surfaces/types';
import { fetchBotScopes } from '@/libs/surfaces/slack';
import { conversationInfo, conversationReplies, resolveUserNames } from '@/libs/surfaces/slackRead';
import { findOurPost, latestAnnouncement, ourPostsInThread } from './slackPosts';

/** A Slack-shaped thread context. The surface tag is the discriminant on `ThreadContext`. */
export type SlackThreadContext = ThreadContext & { surface: 'slack' };

/** Replies kept on the context. Past this the note is longer than the answer. */
const MAX_REPLIES = 20;
/** Characters of any one post kept. A release announcement can be long. */
const MAX_POST_CHARS = 1500;

function trim(text: string): string {
  return text.length > MAX_POST_CHARS ? `${text.slice(0, MAX_POST_CHARS)}…` : text;
}

function ourPostAsThreadPost(post: SlackPost): ThreadPost {
  return { author: 'Vocion', text: trim(post.text), ts: post.ts, ours: true };
}

/** Collaborators the builder needs, all injectable so the tests need no network. */
export type SlackThreadDeps = {
  token: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Scopes the install holds. Omitted means "ask Slack". */
  scopes?: ReadonlySet<string>;
};

/**
 * Build the thread context for one inbound mention.
 * @param inbound - The normalised mention.
 * @param workspace - The Vocion workspace answering, so the reply is scoped to it.
 * @param workspace.orgId
 * @param workspace.name
 * @param workspace.slug
 * @param deps - Token and the injectable Slack seams.
 */
export async function buildSlackThreadContext(
  inbound: ChatInbound,
  workspace: { orgId: string; name?: string | null; slug?: string | null },
  deps: SlackThreadDeps,
): Promise<SlackThreadContext> {
  const { token, baseUrl, fetchImpl } = deps;
  const scopes = deps.scopes ?? await fetchBotScopes(token, baseUrl, fetchImpl);
  const gaps: ContextGap[] = [];

  const ctx: SlackThreadContext = {
    surface: 'slack',
    channelId: inbound.channelId,
    parentIsOurs: false,
    ...(workspace.name ? { workspaceName: workspace.name } : {}),
    ...(workspace.slug ? { workspaceSlug: workspace.slug } : {}),
  };

  // 1. The channel's name.
  const info = await conversationInfo(inbound.channelId, token, baseUrl, fetchImpl);
  if (info.ok) {
    ctx.channelName = info.value.name;
  } else if ('missingScope' in info) {
    gaps.push({ scope: info.missingScope, wouldHave: 'name this channel rather than quoting its id' });
  }

  // 2. The parent — ours for free, someone else's only with a history scope.
  // `threadRef` is the thread's parent ts for a threaded mention, and the
  // mention's OWN ts for a top-level one, so a self-referential parent is not
  // a parent at all.
  const threadTs = inbound.threadRef !== inbound.messageRef ? inbound.threadRef : null;
  const ours = threadTs ? await ourPostsInThread(inbound.channelId, threadTs) : [];
  const ourParent = threadTs ? (await findOurPost(inbound.channelId, threadTs)) : null;

  if (ourParent) {
    ctx.parentIsOurs = true;
    ctx.parent = ourPostAsThreadPost(ourParent);
    if (ourParent.announcedLabel) {
      ctx.announced = { label: ourParent.announcedLabel, ...(ourParent.announcedUrl ? { url: ourParent.announcedUrl } : {}) };
    }
  }

  const replies: ThreadPost[] = [];
  const posterIds = new Set<string>([inbound.externalUserId]);

  if (threadTs) {
    const fetched = await conversationReplies({ channelId: inbound.channelId, threadTs }, token, baseUrl, fetchImpl);
    if (fetched.ok) {
      const ourTs = new Set(ours.map(p => p.ts));
      for (const m of fetched.value) {
        if (m.ts === threadTs) {
          if (!ctx.parent) {
            ctx.parent = { author: m.user ?? 'someone', ...(m.user ? { authorId: m.user } : {}), text: trim(m.text), ts: m.ts };
          }
          if (m.user) {
            posterIds.add(m.user);
          }
          continue;
        }
        if (m.ts === inbound.messageRef) {
          continue; // the message being answered; the agent already has it
        }
        if (m.user) {
          posterIds.add(m.user);
        }
        replies.push({
          author: m.user ?? 'Vocion',
          ...(m.user ? { authorId: m.user } : {}),
          text: trim(m.text),
          ts: m.ts,
          ...(ourTs.has(m.ts) || m.botId ? { ours: true as const } : {}),
        });
      }
    } else if ('missingScope' in fetched) {
      gaps.push({
        scope: fetched.missingScope,
        wouldHave: ctx.parent
          ? 'read the other replies in this thread'
          : 'read the message this thread started with',
      });
      // Everything of ours in the thread still counts — we wrote it.
      for (const p of ours) {
        if (p.ts !== threadTs) {
          replies.push(ourPostAsThreadPost(p));
        }
      }
    }
  } else {
    // A top-level mention: the last announcement in this channel is almost
    // always what "that"/"this" points at, and it is ours, so it is free.
    const recent = await latestAnnouncement(workspace.orgId, inbound.channelId).catch(() => null);
    if (recent) {
      ctx.parentIsOurs = true;
      ctx.parent = ourPostAsThreadPost(recent);
      if (recent.announcedLabel) {
        ctx.announced = { label: recent.announcedLabel, ...(recent.announcedUrl ? { url: recent.announcedUrl } : {}) };
      }
    }
  }

  if (replies.length > 0) {
    ctx.replies = replies.slice(-MAX_REPLIES);
  }

  // 3. Names. `users:read` is granted, so this is the part that holds.
  const names = await resolveUserNames([...posterIds], token, baseUrl, fetchImpl);
  const posters = [...posterIds].map(id => ({ id, name: names.get(id) ?? id }));
  if (posters.length > 0) {
    ctx.posters = posters;
  }
  for (const post of ctx.replies ?? []) {
    if (post.authorId && names.has(post.authorId)) {
      post.author = names.get(post.authorId)!;
    }
  }
  if (ctx.parent?.authorId && names.has(ctx.parent.authorId)) {
    ctx.parent.author = names.get(ctx.parent.authorId)!;
  }

  ctx.mediaMode = scopes.has('files:write') ? 'upload' : 'blocks';
  if (gaps.length > 0) {
    ctx.gaps = gaps;
  }
  // Only a real `missing_scope` becomes a gap. A call that failed because the
  // token is wrong, or because Slack was down, is not a permission the admin
  // needs to grant — and telling a channel to add a scope it already has is
  // exactly the kind of confident wrong answer this whole change exists to
  // stop.
  return ctx;
}

/**
 * The thread context as a `PageContext`, which is the shape the agent runtime
 * already carries and the `page_context` tool already returns. A chat thread
 * is where the person is, exactly as a dashboard page is — same slot, so the
 * model needs no second habit and "this" resolves the same way on both.
 * @param thread - The thread context.
 */
export function threadPageContext(thread: SlackThreadContext): PageContext {
  const where = thread.channelName ? `#${thread.channelName}` : 'a Slack thread';
  return { path: '', title: where, thread };
}

/**
 * The sentence the channel hears when context was missing, naming the scope
 * and what it would have bought.
 *
 * In code rather than in the prompt, and that is the point: the reply that
 * started this said "no page context here", which is true, useless, and gives
 * nobody anything to fix. A person who reads "that needs `groups:history` on
 * the Slack app" can go and grant it.
 * @param thread - The thread context, with its gaps.
 * @returns The sentence, or '' when nothing was missing.
 */
export function scopeGapSentence(thread: ThreadContext): string {
  const gaps = thread.gaps ?? [];
  if (gaps.length === 0) {
    return '';
  }
  const clauses = gaps.map(g => `\`${g.scope}\` would let me ${g.wouldHave}`);
  return `_Heads up: this Slack app is missing ${gaps.length === 1 ? 'a scope' : 'some scopes'} — ${clauses.join('; ')}. A workspace admin can add ${gaps.length === 1 ? 'it' : 'them'} and reinstall the app._`;
}
