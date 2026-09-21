import type { EmailInboundMeta, ReceivedEmail } from '@/libs/surfaces/email';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { mailEnabled, sendMail } from '@/libs/mail';
import { mailboxFrom, mailDomain } from '@/libs/mail/mailbox';
import { fetchReceivedEmail, htmlToText, normaliseSubject, referencedMessageIds, replySubject, stripAngles, stripQuotedHistory } from '@/libs/surfaces/email';
import { accountMembershipSchema, conversationSchema, emailThreadSchema, projectSchema, userSchema } from '@/models/Schema';
import { runAgentDeep } from '@/services/AgentService';
import { upsertAsk } from '@/services/AskService';
import { preflightCheck } from '@/services/BudgetService';
import { appendMessage, createConversation, listMessages, toHistoryTurns } from '@/services/ConversationService';

/**
 * EmailSurfaceService — a workspace's mailbox as a chat surface.
 *
 * `revenue@agents.example.com` is the Revenue workspace; whoever answers a
 * chat there answers a mail there: the workspace lead. Resolution is by the
 * address the mail was sent TO (`project.mailbox_address`), never by who sent
 * it — a sender's address is an external identity that authorises nothing.
 * It does decide ONE thing: whether an agent turn runs at all. A member of
 * the workspace's account (by verified user email) or its accountable human
 * gets an answer; anyone else gets a short acknowledgement and the mail is
 * filed as an `ask` so a person decides what to do with it. Anything the
 * agent proposes still lands in the review queue, exactly like Slack.
 *
 * Threading: every mail in or out is recorded in `email_thread` by Message-ID.
 * A reply that names one of ours (`In-Reply-To` / `References`) continues that
 * conversation; failing that, the same sender writing on the same subject
 * within a week does; otherwise a new conversation opens with the subject as
 * its title and `surface = 'email'`.
 */

export { addressOnDomain, defaultMailboxAddress, mailboxFrom, mailDomain } from '@/libs/mail/mailbox';

/** Feature flag — the webhook 501s without it. Ships dark. */
export function emailSurfaceEnabled(): boolean {
  return process.env.VOCION_EMAIL_SURFACE === '1';
}

export type Mailbox = { orgId: string; projectSlug: string; projectName: string; address: string; leadAgentSlug: string | null; accountId: string; accountableUserId: string | null };

/**
 * The workspace behind an address, if one has claimed it and enabled its
 * mailbox.
 * @param address - Bare lower-case recipient address.
 */
export async function resolveMailbox(address: string): Promise<Mailbox | null> {
  const [row] = await db
    .select({
      orgId: projectSchema.id,
      projectSlug: projectSchema.slug,
      projectName: projectSchema.name,
      address: projectSchema.mailboxAddress,
      leadAgentSlug: projectSchema.leadAgentSlug,
      accountId: projectSchema.accountId,
      accountableUserId: projectSchema.accountableUserId,
    })
    .from(projectSchema)
    .where(and(eq(projectSchema.mailboxEnabled, true), sql`lower(${projectSchema.mailboxAddress}) = ${address.toLowerCase()}`))
    .limit(1);
  if (!row || !row.address) {
    return null;
  }
  return { ...row, address: row.address };
}

/**
 * The first recipient that is one of ours — a mail can be addressed to several
 * people and still be for a workspace.
 * @param recipients - Bare lower-case addresses.
 */
export async function resolveMailboxFor(recipients: string[]): Promise<Mailbox | null> {
  for (const r of recipients) {
    const box = await resolveMailbox(r);
    if (box) {
      return box;
    }
  }
  return null;
}

/**
 * Is this sender someone the workspace already knows — a member of its
 * account, or its accountable human? Decides whether an agent turn runs, not
 * what the agent may do.
 * @param box - The mailbox the mail arrived at.
 * @param senderEmail - Bare lower-case sender address.
 */
export async function isKnownSender(box: Mailbox, senderEmail: string): Promise<boolean> {
  const [member] = await db
    .select({ id: userSchema.id })
    .from(userSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .where(and(eq(accountMembershipSchema.accountId, box.accountId), sql`lower(${userSchema.email}) = ${senderEmail}`))
    .limit(1);
  if (member) {
    return true;
  }
  if (box.accountableUserId) {
    const [acc] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, box.accountableUserId)).limit(1);
    if (acc && acc.email.toLowerCase() === senderEmail) {
      return true;
    }
  }
  return false;
}

/**
 * The conversation a mail belongs to: by referenced Message-ID first, then by
 * sender + subject within seven days. Null means "start a new one".
 * @param orgId - Tenant.
 * @param referenced - Message-IDs the mail names (In-Reply-To, References), brackets stripped.
 * @param sender - Bare sender address.
 * @param subject - As written.
 * @param now - Clock, injectable for tests.
 */
export async function findThread(orgId: string, referenced: string[], sender: string, subject: string, now: Date = new Date()): Promise<number | null> {
  if (referenced.length > 0) {
    const [hit] = await db
      .select({ conversationId: emailThreadSchema.conversationId })
      .from(emailThreadSchema)
      .where(and(eq(emailThreadSchema.orgId, orgId), inArray(emailThreadSchema.messageId, referenced)))
      .orderBy(desc(emailThreadSchema.id))
      .limit(1);
    if (hit) {
      return hit.conversationId;
    }
  }
  const subj = normaliseSubject(subject);
  if (!subj) {
    return null;
  }
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ conversationId: emailThreadSchema.conversationId, subject: emailThreadSchema.subject })
    .from(emailThreadSchema)
    .where(and(eq(emailThreadSchema.orgId, orgId), eq(emailThreadSchema.direction, 'in'), eq(emailThreadSchema.fromAddress, sender), gt(emailThreadSchema.createdAt, since)))
    .orderBy(desc(emailThreadSchema.id))
    .limit(20);
  const match = rows.find(r => normaliseSubject(r.subject ?? '') === subj);
  return match?.conversationId ?? null;
}

/**
 * Has this received email already been handled? Resend redelivers a webhook
 * it did not get a 2xx for; the agent must not answer twice.
 * @param receivedEmailId - Resend's id.
 */
export async function alreadyHandled(receivedEmailId: string): Promise<boolean> {
  const [row] = await db.select({ id: emailThreadSchema.id }).from(emailThreadSchema).where(eq(emailThreadSchema.receivedEmailId, receivedEmailId)).limit(1);
  return Boolean(row);
}

/** Dependency seam so the handler is testable without a model, a mailbox or Resend. */
export type EmailHandlerDeps = {
  runAgent: typeof runAgentDeep;
  preflight: typeof preflightCheck;
  fetchEmail: (id: string) => Promise<ReceivedEmail>;
  send: typeof sendMail;
};

function defaultDeps(): EmailHandlerDeps {
  return {
    runAgent: runAgentDeep,
    preflight: preflightCheck,
    fetchEmail: id => fetchReceivedEmail(id, process.env.RESEND_API_KEY?.trim() ?? ''),
    send: sendMail,
  };
}

/**
 * The body a person wrote, from whichever part the mail carried.
 * @param email
 */
export function bodyOf(email: Pick<ReceivedEmail, 'text' | 'html'>): string {
  const raw = email.text?.trim() || (email.html ? htmlToText(email.html) : '');
  return stripQuotedHistory(raw);
}

/**
 * A Message-ID for a mail we send, so a reply to it can be threaded back even
 * when the provider does not echo the id it assigned.
 * @param domain - The mail domain.
 */
export function outboundMessageId(domain: string): string {
  return `vocion-${randomUUID()}@${domain}`;
}

const NOTE_LIMIT = 2000;

export type EmailOutcome
  = | { outcome: 'unbound'; recipients: string[] }
    | { outcome: 'duplicate'; receivedEmailId: string }
    | { outcome: 'no_lead'; orgId: string }
    | { outcome: 'unknown_sender'; orgId: string; askId: number; acknowledged: boolean }
    | { outcome: 'over_budget'; orgId: string; agentSlug: string }
    | { outcome: 'replied'; orgId: string; agentSlug: string; conversationId: number; created: boolean; text: string; mailId: string | null }
    | { outcome: 'failed'; orgId: string; agentSlug: string; conversationId: number | null; error: string };

/**
 * The whole slice, end to end: address → workspace → sender check → thread →
 * lead agent → reply mail. Never throws on the agent path; a failure becomes
 * a short reply and a return value, like `ChatSurfaceService.handleInbound`.
 * @param meta - The normalised webhook.
 * @param deps - Injectable collaborators.
 */
export async function handleInboundEmail(meta: EmailInboundMeta, deps: EmailHandlerDeps = defaultDeps()): Promise<EmailOutcome> {
  if (await alreadyHandled(meta.receivedEmailId)) {
    return { outcome: 'duplicate', receivedEmailId: meta.receivedEmailId };
  }
  const box = await resolveMailboxFor(meta.recipients);
  if (!box) {
    return { outcome: 'unbound', recipients: meta.recipients };
  }
  const { orgId } = box;
  if (!box.leadAgentSlug) {
    return { outcome: 'no_lead', orgId };
  }
  const agentSlug = box.leadAgentSlug;

  // Body and headers come from the API — the webhook is metadata only.
  const email = await deps.fetchEmail(meta.receivedEmailId);
  const body = bodyOf(email);
  const inboundMessageId = stripAngles(email.message_id) ?? meta.messageId ?? `received-${meta.receivedEmailId}`;
  const referenced = referencedMessageIds(email.headers);
  const domain = mailDomain() ?? box.address.slice(box.address.lastIndexOf('@') + 1);
  const from = mailboxFrom(box);

  const known = await isKnownSender(box, meta.from);
  if (!known) {
    // A stranger wrote to the workspace. No agent turn: file it for a person,
    // acknowledge the sender, remember the mail so a redelivery is dropped.
    const conv = await createConversation({ orgId, agentSlug, createdBy: `email:${meta.from}`, scopeRef: `email:${inboundMessageId}`, initialTitle: meta.subject || `Mail from ${meta.from}` });
    await db.update(conversationSchema).set({ surface: 'email' }).where(eq(conversationSchema.id, conv.id));
    await appendMessage({ orgId, conversationId: conv.id, role: 'user', content: body || '(empty message)', userId: `email:${meta.from}` });
    await db.insert(emailThreadSchema).values({ orgId, conversationId: conv.id, messageId: inboundMessageId, receivedEmailId: meta.receivedEmailId, direction: 'in', fromAddress: meta.from, subject: meta.subject });
    const { ask } = await upsertAsk({
      orgId,
      createdBy: `email:${meta.from}`,
      ask: {
        kind: 'input',
        title: `Unknown sender wrote to ${box.address}`,
        body: `**${meta.fromRaw}** wrote "${meta.subject || '(no subject)'}". They are not a member of this workspace, so no agent answered. Decide whether to reply, add them, or ignore.`,
        sourceRef: `email:${meta.receivedEmailId}`,
        agentSlug,
        risk: 'low',
        options: [
          { id: 'reply-myself', label: 'I will reply myself', description: 'Nothing else happens; the mail stays in the conversation.' },
          { id: 'let-agent-answer', label: 'Let the workspace lead answer', description: 'Runs one agent turn on this mail and replies from the mailbox.', recommended: true },
          { id: 'ignore', label: 'Ignore', description: 'Close without a reply.' },
        ],
        decision: `Decide how to answer ${meta.from}, who is not a member of this workspace.`,
        recommendation: 'Let the workspace lead answer, then add them if the exchange continues.',
        why: ['Nobody has answered: no agent runs for an unknown sender.', 'The mail is already in the conversation, so nothing is lost either way.'],
        impactOfDelay: 'They hear nothing beyond the acknowledgement until someone decides.',
        contextUrl: `/dashboard/chat?conversation=${conv.id}`,
        contextMd: body.slice(0, NOTE_LIMIT),
        projectId: orgId,
      },
    });
    let acknowledged = false;
    if (mailEnabled()) {
      try {
        const ackId = outboundMessageId(domain);
        await deps.send({
          from,
          to: meta.from,
          subject: replySubject(meta.subject),
          text: `Thanks — your message to ${box.address} reached ${box.projectName}. A person will look at it and get back to you.`,
          html: `<p>Thanks — your message to ${box.address} reached ${box.projectName}. A person will look at it and get back to you.</p>`,
          headers: { 'Message-ID': `<${ackId}>`, 'In-Reply-To': `<${inboundMessageId}>`, 'References': [...referenced, inboundMessageId].map(id => `<${id}>`).join(' ') },
          tags: { surface: 'email', kind: 'ack' },
        });
        await db.insert(emailThreadSchema).values({ orgId, conversationId: conv.id, messageId: ackId, direction: 'out', fromAddress: box.address, subject: replySubject(meta.subject) });
        acknowledged = true;
      } catch {
        acknowledged = false;
      }
    }
    return { outcome: 'unknown_sender', orgId, askId: ask.id, acknowledged };
  }

  const budget = await deps.preflight({ orgId, agentSlug });
  if (!budget.ok) {
    if (mailEnabled()) {
      await deps.send({ from, to: meta.from, subject: replySubject(meta.subject), text: `This workspace's agent is over its ${budget.reason.replace('hard_', '').replace('_exceeded', '')} budget for the period. A workspace admin can raise the cap in Vocion.`, html: '<p>This workspace\'s agent is over its budget for the period. A workspace admin can raise the cap in Vocion.</p>', headers: { 'In-Reply-To': `<${inboundMessageId}>` } }).catch(() => {});
    }
    return { outcome: 'over_budget', orgId, agentSlug };
  }

  // Thread: a reply to one of ours, the same sender on the same subject this
  // week, or a fresh conversation titled with the subject.
  const existingId = await findThread(orgId, referenced, meta.from, meta.subject);
  let conversationId: number;
  let created = false;
  if (existingId !== null) {
    conversationId = existingId;
  } else {
    const conv = await createConversation({ orgId, agentSlug, createdBy: `email:${meta.from}`, scopeRef: `email:${inboundMessageId}`, initialTitle: meta.subject || `Mail from ${meta.from}` });
    await db.update(conversationSchema).set({ surface: 'email' }).where(eq(conversationSchema.id, conv.id));
    conversationId = conv.id;
    created = true;
  }
  await db.insert(emailThreadSchema).values({ orgId, conversationId, messageId: inboundMessageId, receivedEmailId: meta.receivedEmailId, direction: 'in', fromAddress: meta.from, subject: meta.subject });

  const attachmentNote = meta.attachments.length > 0
    ? `\n\n[Attachments (not read): ${meta.attachments.map(a => `${a.filename} (${a.contentType})`).join(', ')}]`
    : '';
  const messageText = `${body || '(empty message)'}${attachmentNote}`;
  const history = toHistoryTurns(await listMessages({ orgId, conversationId }));
  await appendMessage({ orgId, conversationId, role: 'user', content: messageText, userId: `email:${meta.from}` });

  try {
    const result = await deps.runAgent({
      orgId,
      agentSlug,
      message: `${messageText}\n\n--- how I am reaching you ---\nThis arrived by email at ${box.address} from ${meta.fromRaw}${meta.subject ? ` with the subject "${meta.subject}"` : ''}. Answer as an email reply: plain prose, no markdown tables, links written out in full.`,
      userId: `email:${meta.from}`,
      conversationId,
      conversationHistory: history,
    });
    const text = result.response.trim() || '(no reply)';
    await appendMessage({ orgId, conversationId, role: 'assistant', content: text });
    let mailId: string | null = null;
    if (mailEnabled()) {
      const outId = outboundMessageId(domain);
      const sent = await deps.send({
        from,
        to: meta.from,
        subject: replySubject(meta.subject),
        text,
        html: `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0b1020;white-space:pre-wrap">${escapeHtml(text)}</div>`,
        headers: { 'Message-ID': `<${outId}>`, 'In-Reply-To': `<${inboundMessageId}>`, 'References': [...referenced, inboundMessageId].map(id => `<${id}>`).join(' ') },
        tags: { surface: 'email', org: orgId.slice(0, 40) },
      });
      mailId = sent.skipped ? null : sent.id;
      await db.insert(emailThreadSchema).values({ orgId, conversationId, messageId: outId, direction: 'out', fromAddress: box.address, subject: replySubject(meta.subject) });
    }
    return { outcome: 'replied', orgId, agentSlug, conversationId, created, text, mailId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mailEnabled()) {
      await deps.send({ from, to: meta.from, subject: replySubject(meta.subject), text: 'Something went wrong on my side; a person can see the details in Vocion.', html: '<p>Something went wrong on my side; a person can see the details in Vocion.</p>', headers: { 'In-Reply-To': `<${inboundMessageId}>` } }).catch(() => {});
    }
    return { outcome: 'failed', orgId, agentSlug, conversationId, error: message };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
