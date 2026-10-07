import { registerChannel } from './conversationChannel';
import { emailChannel } from './emailChannel';
import { slackChannel } from './slackChannel';

/**
 * The mediums a conversation reaches its person through (`conversationChannel.ts`). A new one
 * (SMS) is one file beside these and one line here.
 */
registerChannel(slackChannel);
registerChannel(emailChannel);

export { channelBySurface, channelFor } from './conversationChannel';
