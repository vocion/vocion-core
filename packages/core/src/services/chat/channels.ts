import { registerChannel } from './conversationChannel';
import { emailChannel } from './emailChannel';
import { slackChannel } from './slackChannel';
import { smsChannel, vonageChannel, whatsappChannel } from './smsChannel';

/**
 * The mediums a conversation reaches its person through (`conversationChannel.ts`): Slack,
 * email, text messages (Twilio, Vonage), WhatsApp. A new one is one file beside these and one line here.
 */
registerChannel(slackChannel);
registerChannel(emailChannel);
registerChannel(smsChannel);
registerChannel(whatsappChannel);
registerChannel(vonageChannel);

export { channelBySurface, channelFor } from './conversationChannel';
