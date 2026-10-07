import type { ConversationChannel } from './conversationChannel';
import process from 'node:process';
import { memberByEmail } from './conversationChannel';
import { slackThreadOfScope, tellImages } from './tellConversation';

/** A Slack thread: posted as the agent's persona, files uploaded under the words, every post recorded. */
export const slackChannel: ConversationChannel = {
  surface: 'slack',
  owns: c => slackThreadOfScope(c.scopeRef) !== null,
  async say(orgId, c, text, opts) {
    const thread = slackThreadOfScope(c.scopeRef)!;
    const [{ getSurface }, { agentPersona }, { recordSlackPost }] = await Promise.all([
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
    const posted = await adapter.reply(
      { channelId: thread.channelId, threadRef: thread.threadTs, ...(persona?.displayName ? { displayName: persona.displayName } : {}), ...(persona?.iconUrl ? { iconUrl: persona.iconUrl } : {}) },
      { text, ...(images.length > 0 ? { images } : {}) },
      images.length > 0 ? { fetchImage } : undefined,
    );
    await recordSlackPost({ orgId, channelId: thread.channelId, ts: posted?.ts ?? '', threadTs: thread.threadTs, kind: 'reply', agentSlug: c.agentSlug, text, announcedLabel: opts.key, announcedUrl: opts.url, createdBy: 'system:tell-conversation' });
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
