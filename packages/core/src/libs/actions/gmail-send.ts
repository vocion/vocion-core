/**
 * gmail.send — a ONE-TO-ONE email as the connected Gmail user: a reply in a
 * thread, or a follow-up to someone already in conversation. Creates a draft
 * (`draft: true`, the safe default for "draft my emails, I'll send") or sends.
 *
 * A reply threads: with `threadId` (or, for a draft proposed before drafts
 * carried one, a thread matched by recipient and `Re:` subject from the synced
 * thread state, `services/mail/replyThread.ts`), the draft is filed in that
 * thread with `In-Reply-To` and `References` set from its last message, so
 * Gmail and the recipient's client both show it as an answer, not a new
 * conversation.
 *
 * Not for multi-touch outbound: several timed emails to a prospect who is not
 * in a conversation is a sequence (`personalization.enroll`), and that kind
 * refuses anyone who is.
 *
 * `external: true` + grant `send_email` → an agent proposing this is gated into
 * the review queue by the autonomy model; a human/token with the grant can run
 * it directly, and it is on the never-auto list. Credentials come from the
 * `gmail` source's vault entry. A draft can be undone (it is deleted); a sent
 * email cannot.
 */

import type { Action, ReviewCard } from './types';
import type { ReplyThread } from '@/services/mail/replyThread';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { nameOf, splitRecipients } from '@/libs/mail/recipients';
import { resolveGoogleAccessToken } from '@/libs/sources/googleAuth';
import { addressOf } from '@/libs/sources/mailThreadState';
import { isHtmlBody } from '@/libs/writing/emailBody';

const gmailSendInput = z.object({
  to: z.string().min(1).describe('Recipient(s), comma-separated; "Name <address>" keeps the name on the card'),
  subject: z.string().default('').describe('For a reply, the thread\'s subject with "Re: "'),
  body: z.string().min(1).describe('The message only — the signature goes in `signature`'),
  cc: z.string().optional().describe('Everyone copied on the thread who should stay copied, comma-separated'),
  /** The Gmail thread this replies in. */
  threadId: z.string().optional().describe('The Gmail thread being replied to (from search or the thread state), so the draft threads under it'),
  /** The sender's sign-off, appended on approval when the body does not already end with it. */
  signature: z.string().max(2000).optional().describe('The sender\'s signature as they sign their own mail in this thread, when known'),
  /** Create a draft instead of sending. */
  draft: z.boolean().default(false),
  baseUrl: z.string().url().default('https://gmail.googleapis.com/gmail/v1'),
});

type GmailSendInput = z.infer<typeof gmailSendInput>;

/**
 * One RFC 2822 header value with no line breaks, so a subject or an address
 * cannot inject another header.
 * @param value - The raw value.
 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * RFC 2047 encoding for a header value that is not plain ASCII.
 * @param value - The value.
 */
function encodedWord(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The body with the signature under it — once: a body that already ends with
 * it is left alone.
 * @param body - Plain text or the editor's HTML.
 * @param signature - The sender's signature, when known.
 */
export function withSignature(body: string, signature: string | undefined): string {
  const sig = signature?.trim();
  if (!sig) {
    return body;
  }
  const plain = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (plain.includes(sig.replace(/\s+/g, ' '))) {
    return body;
  }
  return isHtmlBody(body)
    ? `${body}<p>${escapeHtml(sig).replace(/\n/g, '<br>')}</p>`
    : `${body.trimEnd()}\n\n${sig}`;
}

/**
 * The raw RFC 822 message, base64url as Gmail wants it.
 * @param input - The email.
 * @param input.to
 * @param input.subject
 * @param input.body
 * @param input.cc
 * @param input.signature
 * @param reply - The headers that thread it, when it answers a message.
 * @param reply.inReplyTo
 * @param reply.references
 */
export function toRfc822(input: { to: string; subject: string; body: string; cc?: string; signature?: string }, reply?: { inReplyTo: string; references: string }): string {
  const body = withSignature(input.body, input.signature);
  const lines = [
    `To: ${oneLine(input.to)}`,
    ...(input.cc ? [`Cc: ${oneLine(input.cc)}`] : []),
    `Subject: ${encodedWord(oneLine(input.subject))}`,
    ...(reply?.inReplyTo ? [`In-Reply-To: ${reply.inReplyTo}`, `References: ${reply.references}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: ${isHtmlBody(body) ? 'text/html' : 'text/plain'}; charset="UTF-8"`,
    '',
    body,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

/**
 * Where the result opens in Gmail, for the receipt's "Open in Gmail".
 * @param mailbox - The connected account, when the credential carries it.
 * @param where - `#drafts?compose=<message>` or `#all/<thread>`.
 */
function gmailLink(mailbox: string | undefined, where: string): string {
  return `https://mail.google.com/mail/${mailbox ? `u/${encodeURIComponent(mailbox)}/` : ''}${where}`;
}

/**
 * The thread this email answers, from synced thread state. Never throws: an
 * unreadable index means no thread, and the card says nothing about one.
 * @param orgId - The workspace.
 * @param input - The email.
 */
async function replyThreadFor(orgId: string, input: GmailSendInput): Promise<ReplyThread | null> {
  try {
    const { findReplyThread } = await import('@/services/mail/replyThread');
    return await findReplyThread(orgId, { threadId: input.threadId, to: input.to, subject: input.subject });
  } catch {
    return null;
  }
}

type Header = { name: string; value: string };

/**
 * The headers that thread a reply under the thread's last message. Read-only
 * (`gmail.readonly` covers it). Null when Gmail does not answer, and the
 * draft is then filed on its own rather than not at all.
 * @param baseUrl - The Gmail API base.
 * @param headers - Auth headers.
 * @param threadId - The thread.
 */
async function replyHeaders(baseUrl: string, headers: Record<string, string>, threadId: string): Promise<{ inReplyTo: string; references: string } | null> {
  try {
    const res = await fetch(`${baseUrl}/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`, { headers });
    if (!res.ok) {
      return null;
    }
    const thread = (await res.json()) as { messages?: Array<{ payload?: { headers?: Header[] } }> };
    const last = thread.messages?.at(-1);
    const header = (name: string) => oneLine(last?.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '');
    const messageId = header('Message-ID');
    if (!messageId) {
      return null;
    }
    return { inReplyTo: messageId, references: [header('References'), messageId].filter(Boolean).join(' ') };
  } catch {
    return null;
  }
}

export const gmailSendAction: Action<typeof gmailSendInput> = {
  id: 'gmail.send',
  name: 'Send email',
  description: 'A one-to-one email as the connected Gmail user — a reply in an existing thread (pass threadId so it threads) or a follow-up to someone already in conversation; a draft by default (draft: true), sent only when asked. Fill to and cc as the thread has them, the subject as "Re: <thread subject>", and the sender\'s signature when you know it. Not for multi-touch outbound to a prospect who is not in a conversation: that is a sequence.',
  inputSchema: gmailSendInput,
  grant: 'send_email',
  external: true,
  sourceSlug: 'gmail',
  // One PENDING email per recipient: a re-firing automation refreshes its
  // draft in place instead of stacking the queue. The recipient is the
  // identity because the model rewrites the subject on every pass (observed
  // in prod: 16 stacked drafts to one address, every subject different).
  // Pending-only dedup, so a fresh email to the same person proposes cleanly
  // once the last one is decided.
  dedupKeyFor: input => `gmail.send:${addressOf(splitRecipients(input.to)[0] ?? input.to)}`,
  // The outbound artifact: who it goes to, what it answers, the copy and
  // the signature — one email, never a "Send 1" of a sequence.
  async reviewCard(ctx, input): Promise<ReviewCard> {
    const thread = await replyThreadFor(ctx.orgId, input);
    const to = splitRecipients(input.to);
    const cc = splitRecipients(input.cc);
    const first = to[0] ?? input.to;
    const sameAsThread = thread && addressOf(thread.counterpart) === addressOf(first);
    const name = nameOf(first) ?? (sameAsThread ? nameOf(thread.counterpart) : null) ?? addressOf(first);
    const reply = Boolean(input.threadId || thread || /^\s*re\s*:/i.test(input.subject));
    const title = `${input.draft ? 'Draft' : 'Send'} ${reply ? 'a reply' : 'an email'} to ${name}${to.length > 1 ? ` and ${to.length - 1} more` : ''}`;
    return {
      title,
      object: { title, subtitle: `${addressOf(first)} · Gmail` },
      system: 'Gmail',
      subject: { name },
      outbound: {
        channel: 'email',
        mode: input.draft ? 'draft' : 'send',
        system: 'Gmail',
        to,
        ...(cc.length > 0 ? { cc } : {}),
        ...(thread?.mailbox ? { from: thread.mailbox } : {}),
        recipientsEditable: true,
        contentId: 'message',
        ...(input.signature ? { signature: input.signature } : {}),
        ...(thread && thread.messages.length > 0
          ? { thread: { subject: thread.subject, ...(thread.href ? { href: thread.href } : {}), messages: thread.messages } }
          : {}),
        doneLabel: input.draft ? 'Draft created' : 'Sent',
        openLabel: 'Open in Gmail',
      },
      content: [{ kind: 'email' as const, id: 'message', label: 'Email', subject: input.subject, body: input.body }],
      fields: [
        { label: 'To', value: input.to },
        ...(input.cc ? [{ label: 'Cc', value: input.cc }] : []),
      ],
      verbs: { approve: input.draft ? 'Create draft in Gmail' : 'Send', reject: 'Reject' },
      nextAction: input.draft ? 'Writes a draft in Gmail. Nothing is sent.' : 'Sends this email now.',
    };
  },
  applyContentEdits(input, edits) {
    const edit = edits.find(e => e.id === 'message');
    if (!edit) {
      return input;
    }
    return {
      ...input,
      ...(edit.subject !== undefined ? { subject: edit.subject } : {}),
      ...(edit.body !== undefined ? { body: edit.body } : {}),
      ...(edit.to !== undefined && splitRecipients(edit.to).length > 0 ? { to: splitRecipients(edit.to).join(', ') } : {}),
      ...(edit.cc !== undefined ? { cc: splitRecipients(edit.cc).join(', ') || undefined } : {}),
    };
  },
  async execute(ctx, input) {
    // Durable path: refresh-token exchange (see googleAuth); falls back to a
    // raw short-lived credentials.token.
    const token = await resolveGoogleAccessToken(ctx.credentials, ctx.orgId);
    const headers = { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' };
    const mailbox = typeof ctx.credentials?.email === 'string' ? ctx.credentials.email : undefined;
    // Threaded when it answers one: the id the proposal named, else the
    // thread its recipient and Re: subject match.
    const threadId = input.threadId ?? (await replyThreadFor(ctx.orgId, input))?.threadId ?? undefined;
    const reply = threadId ? await replyHeaders(input.baseUrl, headers, threadId) : null;
    const raw = toRfc822(input, reply ?? undefined);
    const message = { raw, ...(threadId && reply ? { threadId } : {}) };

    if (input.draft) {
      const res = await fetch(`${input.baseUrl}/users/me/drafts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        throw new Error(`Gmail draft failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const body = (await res.json()) as { id?: string; message?: { id?: string; threadId?: string } };
      const messageId = body.message?.id ?? null;
      return {
        mode: 'draft',
        draftId: body.id ?? null,
        messageId,
        threadId: body.message?.threadId ?? (reply ? threadId : null) ?? null,
        threaded: Boolean(reply),
        to: input.to,
        link: gmailLink(mailbox, messageId ? `#drafts?compose=${messageId}` : '#drafts'),
      };
    }

    const res = await fetch(`${input.baseUrl}/users/me/messages/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      throw new Error(`Gmail send failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const body = (await res.json()) as { id?: string; threadId?: string };
    return {
      mode: 'sent',
      messageId: body.id ?? null,
      threadId: body.threadId ?? null,
      threaded: Boolean(reply),
      to: input.to,
      link: gmailLink(mailbox, body.threadId ? `#all/${body.threadId}` : '#sent'),
    };
  },
  // A draft is deleted; nothing else here can be taken back.
  canUndo: result => result.mode === 'draft' && typeof result.draftId === 'string',
  undoableFor: input => input.draft === true,
  async undo(ctx, input, result) {
    if (result.mode !== 'draft' || typeof result.draftId !== 'string') {
      throw new Error('A sent email cannot be unsent.');
    }
    const token = await resolveGoogleAccessToken(ctx.credentials, ctx.orgId);
    const res = await fetch(`${input.baseUrl}/users/me/drafts/${encodeURIComponent(result.draftId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    // Already gone (sent or deleted in Gmail) is the state undo wants.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Gmail draft delete failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    return { deletedDraftId: result.draftId };
  },
};
