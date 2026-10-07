import type { ConversationChannel } from './conversationChannel';
import { absoluteAppLinks } from '@/libs/links';
import { memberByEmail, saidInConversation } from './conversationChannel';

/**
 * An email thread: the line is a reply to the last mail the person sent, threaded under it
 * (`In-Reply-To` / `References`), from the workspace's mailbox, and recorded in `email_thread`
 * like every mail in or out (`EmailSurfaceService`). Mail carries no inline pictures here, so a
 * file goes as a link a member opens in Vocion.
 */
export const emailChannel: ConversationChannel = {
  surface: 'email',
  owns: c => c.surface === 'email' || (c.scopeRef ?? '').startsWith('email:'),
  async say(orgId, c, text, opts) {
    const [{ db }, { and, asc, eq }, { emailThreadSchema, projectSchema }, mail, { replySubject }, { mailboxFrom, mailDomain }, { outboundMessageId }] = await Promise.all([
      import('@/libs/DB'),
      import('drizzle-orm'),
      import('@/models/Schema'),
      import('@/libs/mail'),
      import('@/libs/surfaces/email'),
      import('@/libs/mail/mailbox'),
      import('@/services/EmailSurfaceService'),
    ]);
    if (!mail.mailEnabled()) {
      return false;
    }
    const thread = await db.select().from(emailThreadSchema).where(and(eq(emailThreadSchema.orgId, orgId), eq(emailThreadSchema.conversationId, c.id))).orderBy(asc(emailThreadSchema.id));
    const lastIn = [...thread].reverse().find(t => t.direction === 'in' && t.fromAddress);
    const [box] = await db.select({ projectName: projectSchema.name, address: projectSchema.mailboxAddress }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    if (!lastIn?.fromAddress || !box?.address) {
      return false;
    }
    // A stored picture or recording opens in Vocion; mail here carries no inline files.
    const files = opts.files.map(f => `${f.caption}: ${absoluteAppLinks(f.artifactId ? `/dashboard/artifacts/${f.artifactId}` : f.url)}`);
    const body = [text, ...(files.length > 0 ? ['', ...files] : [])].join('\n');
    const domain = mailDomain() ?? box.address.slice(box.address.lastIndexOf('@') + 1);
    const outId = outboundMessageId(domain);
    const subject = replySubject(lastIn.subject ?? '');
    await mail.sendMail({
      from: mailboxFrom({ projectName: box.projectName, address: box.address }),
      to: lastIn.fromAddress,
      subject,
      text: body,
      html: `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0b1020;white-space:pre-wrap">${body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
      headers: { 'Message-ID': `<${outId}>`, 'In-Reply-To': `<${lastIn.messageId}>`, 'References': thread.map(t => `<${t.messageId}>`).join(' ') },
      tags: { surface: 'email', kind: 'follow' },
    });
    await db.insert(emailThreadSchema).values({ orgId, conversationId: c.id, messageId: outId, direction: 'out', fromAddress: box.address, subject });
    return true;
  },
  alreadySaid: async (_orgId, c, _key, text) => saidInConversation(c.id, text),
  // On email the sender's address is who they are; it still decides only as a member of the workspace.
  memberOf: async (orgId, externalUserId) => memberByEmail(orgId, externalUserId.replace(/^email:/, '')),
  signInHint: email => (email ? `the address you wrote from (${email})` : 'the address you wrote from'),
};
