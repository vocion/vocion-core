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
