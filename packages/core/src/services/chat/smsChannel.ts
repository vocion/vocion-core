import type { ConversationChannel } from './conversationChannel';
import { memberByPhone, saidInConversation } from './conversationChannel';

/**
 * A phone thread: `<surface>:<workspace number>:<their number>`. A line goes out as a message from
 * the workspace's number on the surface the thread lives on (a text, a WhatsApp message, a text
 * through Vonage), pictures as links. A sender is the member whose profile holds the number they
 * wrote from (`me.set_phone` keeps it, from chat). One shape for every medium whose thread is a
 * person's number, so a new one is one line.
 * @param surface - The surface id, also the scopeRef prefix.
 */
export function phoneThreadChannel(surface: string): ConversationChannel {
  return {
    surface,
    owns: c => (c.scopeRef ?? '').startsWith(`${surface}:`),
    async say(_orgId, c, text, opts) {
      const prefix = `${surface}:`;
      const rest = (c.scopeRef ?? '').startsWith(prefix) ? (c.scopeRef ?? '').slice(prefix.length) : '';
      const [, workspaceNumber, theirs] = /^([^:]+):(.+)$/.exec(rest) ?? [];
      if (!workspaceNumber || !theirs) {
        return false;
      }
      const { getSurface } = await import('@/libs/surfaces/registry');
      const adapter = getSurface(surface);
      if (!adapter) {
        return false;
      }
      const images = opts.files.map(f => ({ url: f.url, caption: f.caption }));
      const sent = await adapter.reply({ channelId: workspaceNumber, threadRef: theirs }, { text, ...(images.length > 0 ? { images } : {}) });
      return sent !== null;
    },
    alreadySaid: async (_orgId, c, _key, text) => saidInConversation(c.id, text),
    memberOf: async (orgId, externalUserId) => memberByPhone(orgId, externalUserId),
    signInHint: () => 'a mobile number on your Vocion profile (in Vocion chat, say "my mobile number is …")',
  };
}

/** A text thread through Twilio (`libs/surfaces/sms.ts`). */
export const smsChannel: ConversationChannel = phoneThreadChannel('sms');

/** A WhatsApp thread through a Twilio WhatsApp sender (`libs/surfaces/whatsapp.ts`). */
export const whatsappChannel: ConversationChannel = phoneThreadChannel('whatsapp');

/** A text thread through Vonage (`libs/surfaces/vonage.ts`). */
export const vonageChannel: ConversationChannel = phoneThreadChannel('vonage');

/**
 * The number Vocion texts a person from about a workspace: the account's shared number when it
 * has one (a reply to it reaches the person's own assistant, `chat/ownAssistant.ts`), else the
 * workspace's own number, else none. Another workspace's own number is never used: a reply to it
 * would land in that workspace.
 * @param orgId - The workspace.
 */
export async function textingNumberFor(orgId: string): Promise<string | null> {
  const [{ db }, { and, asc, eq, sql }, { chatChannelBindingSchema, projectSchema }, { routesBySender }] = await Promise.all([
    import('@/libs/DB'),
    import('drizzle-orm'),
    import('@/models/Schema'),
    import('./ownAssistant'),
  ]);
  const rows = await db
    .select({ channelId: chatChannelBindingSchema.channelId, orgId: chatChannelBindingSchema.orgId, agentSlug: chatChannelBindingSchema.agentSlug })
    .from(chatChannelBindingSchema)
    .innerJoin(projectSchema, eq(projectSchema.id, chatChannelBindingSchema.orgId))
    .where(and(
      eq(chatChannelBindingSchema.surface, smsChannel.surface),
      eq(projectSchema.accountId, sql`(select p."account_id" from "project" p where p."id" = ${orgId})`),
    ))
    .orderBy(asc(chatChannelBindingSchema.id));
  return (rows.find(r => routesBySender(r)) ?? rows.find(r => r.orgId === orgId))?.channelId ?? null;
}
