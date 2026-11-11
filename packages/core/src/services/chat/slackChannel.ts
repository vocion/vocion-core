import type { ConversationChannel } from './conversationChannel';
import process from 'node:process';
import { memberByEmail } from './conversationChannel';
import { slackThreadOfScope, tellImages } from './tellConversation';

/**
 * A card as the thread saw it: the page it links and the words on it. Kept on the post that drew
 * it (`slack_post.images`), so the next card for the same page is compared with what was shown.
 * @param preview - The page.
 */
export function cardAsDrawn(preview: import('@/libs/surfaces/types').ChatPreview): { url: string; caption: string } {
  return { url: preview.url, caption: [preview.title, preview.description].filter(Boolean).join('\n') };
}

/** A Slack thread: posted as the agent's persona, files uploaded under the words, every post recorded. */
export const slackChannel: ConversationChannel = {
  surface: 'slack',
  drawsPreview: true,
  owns: c => slackThreadOfScope(c.scopeRef) !== null,
  async say(orgId, c, text, opts) {
    const thread = slackThreadOfScope(c.scopeRef)!;
    const [{ getSurface }, { agentPersona }, { ourPostsInThread, recordSlackPost }] = await Promise.all([
      import('@/libs/surfaces/registry'),
      import('@/services/ChatSurfaceService'),
      import('@/services/chat/slackPosts'),
    ]);
    const adapter = getSurface('slack');
    if (!adapter) {
      return false;
    }
    const persona = c.agentSlug ? await agentPersona(orgId, c.agentSlug).catch(() => null) : null;
    const { images, fetchImage } = tellImages(orgId, opts.files);
    // A CARD IS DRAWN WHEN ITS PAGE HAS SOMETHING NEW TO SHOW (2026-11-11: the same status card
    // under two updates in a row). The card last drawn for this page in the thread is on its
    // post; one that would read the same is left out, and the words still go.
    const drawn = opts.preview ? cardAsDrawn(opts.preview) : null;
    const last = drawn ? (await ourPostsInThread(thread.channelId, thread.threadTs).catch(() => [])).flatMap(p => p.images ?? []).filter(i => i.url === drawn.url).at(-1) : null;
    const card = drawn && last?.caption === drawn.caption ? undefined : opts.preview;
    const posted = await adapter.reply(
      { channelId: thread.channelId, threadRef: thread.threadTs, ...(persona?.displayName ? { displayName: persona.displayName } : {}), ...(persona?.iconUrl ? { iconUrl: persona.iconUrl } : {}) },
      { text, ...(images.length > 0 ? { images } : {}), ...(card ? { preview: card } : {}) },
      images.length > 0 ? { fetchImage } : undefined,
    );
    await recordSlackPost({ orgId, channelId: thread.channelId, ts: posted?.ts ?? '', threadTs: thread.threadTs, kind: 'reply', agentSlug: c.agentSlug, text, announcedLabel: opts.key, announcedUrl: opts.url, ...(card && drawn ? { images: [drawn] } : {}), createdBy: 'system:tell-conversation' });
    return true;
  },
  async alreadySaid(_orgId, c, key, text) {
    const thread = slackThreadOfScope(c.scopeRef)!;
    const { ourPostsInThread } = await import('@/services/chat/slackPosts');
    return (await ourPostsInThread(thread.channelId, thread.threadTs)).some(p => p.announcedLabel === key || p.text === text);
  },
  async memberOf(orgId, externalUserId) {
    const { slackUserEmail } = await import('@/libs/surfaces/slackRead');
    const email = await slackUserEmail(externalUserId, process.env.SLACK_BOT_TOKEN).catch(() => null);
    return memberByEmail(orgId, email);
  },
  signInHint: email => (email ? `the email on your Slack profile (${email})` : 'the email on your Slack profile, which Vocion cannot read'),
};
