import type { ConversationChannel } from './conversationChannel';
import { memberByPhone, saidInConversation } from './conversationChannel';

/**
 * A text thread: `sms:<workspace number>:<their number>`. A line goes out as a text from the
 * workspace's number, pictures as links (`libs/surfaces/sms.ts`). A sender is the member whose
 * profile holds the number they texted from (`me.set_phone` keeps it, from chat).
 */
export const smsChannel: ConversationChannel = {
  surface: 'sms',
  owns: c => (c.scopeRef ?? '').startsWith('sms:'),
  async say(_orgId, c, text, opts) {
    const [, workspaceNumber, theirs] = /^sms:([^:]+):(.+)$/.exec(c.scopeRef ?? '') ?? [];
    if (!workspaceNumber || !theirs) {
      return false;
    }
    const { smsSurface } = await import('@/libs/surfaces/sms');
    const images = opts.files.map(f => ({ url: f.url, caption: f.caption }));
    const sent = await smsSurface.reply({ channelId: workspaceNumber, threadRef: theirs }, { text, ...(images.length > 0 ? { images } : {}) });
    return sent !== null;
  },
  alreadySaid: async (_orgId, c, _key, text) => saidInConversation(c.id, text),
  memberOf: async (orgId, externalUserId) => memberByPhone(orgId, externalUserId),
  signInHint: () => 'a mobile number on your Vocion profile (in Vocion chat, say "my mobile number is …")',
};
