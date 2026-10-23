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
 *
 * WHICH ONE IS THE APPROVER'S CALL. The proposal's `draft` is a suggestion: the
 * card offers Send and Create draft side by side (`outbound.modeChoice`), and
 * what the approver presses rides back as a content edit (`mode`) and becomes
 * `draft` on the input that runs. A draft stays undoable; a send does not.
 *
 * HTML, ALWAYS, WITH THE SENDER'S OWN SIGNATURE. A drafted body is prose and
 * went out as text/plain, so Gmail opened the draft in "Plain text" mode with
 * no signature (Chris, 2026-10-23: "it should default to HTML not text … it
 * should have my default Gmail HTML email signature"). Every message is now
 * multipart/alternative, the HTML rendered by `emailBodyHtml` (the same
 * conversion HubSpot gets) beside a plain-text copy, and the signature Gmail
 * holds for the sending address (`settings/sendAs`, readable under
 * `gmail.readonly`) goes under it as Gmail's own `gmail_signature` block, so
 * Gmail treats it as the signature when the draft is opened. No signature, or
 * Gmail not answering, sends without one rather than not at all.
 *
 * VOICE IS CHECKED AT THE DOOR, as it is for a sequence. An agent's draft is
 * linted against the workspace's `voice.yaml` and the platform floor before
 * it can reach Review, and refused with the phrase and the reason so the
 * agent rewrites it (2026-10-23: a follow-up went to Review with colons, a
 * "Christa, Breann," greeting and a typed sign-off over the Gmail signature,
 * because only `personalization.enroll` was ever linted). A person's own
 * words are never held. The per-send length and ask limits are sequence
 * limits and stay there; a one-to-one email is as long as it needs to be.
 *
 * ATTACHMENTS are artifacts, named by id (`emailAttachments.ts`): a document
 * or deck goes as its printed PDF, a file as stored. The card lists each one, openable
 * before approval, and says so when one cannot go.
 */

import type { Action, ReviewCard } from './types';
import type { ReplyThread } from '@/services/mail/replyThread';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { nameOf, splitRecipients } from '@/libs/mail/recipients';
import { resolveGoogleAccessToken } from '@/libs/sources/googleAuth';
import { addressOf } from '@/libs/sources/mailThreadState';
import { emailBodyHtml, emailBodyText, isHtmlBody } from '@/libs/writing/emailBody';
import { describeAttachments, MAX_ATTACHMENTS, resolveAttachments } from './emailAttachments';

const gmailSendInput = z.object({
  to: z.string().min(1).describe('Recipient(s), comma-separated; "Name <address>" keeps the name on the card'),
  subject: z.string().default('').describe('For a reply, the thread\'s subject with "Re: "'),
  body: z.string().min(1).describe('The message only, as plain prose (short paragraphs, "- " lists); it goes out as HTML. The sender\'s own Gmail signature is added under it, so a sign-off goes in `signature`, never in the body'),
  cc: z.string().optional().describe('Everyone copied on the thread who should stay copied, comma-separated'),
  /** The Gmail thread this replies in. */
  threadId: z.string().optional().describe('The Gmail thread being replied to (from search or the thread state), so the draft threads under it'),
  /** The sender's sign-off, appended on approval when the body does not already end with it. */
  signature: z.string().max(2000).optional().describe('The sender\'s signature as they sign their own mail in this thread, when known'),
  /** Create a draft instead of sending. The approver can change it at approval. */
  draft: z.boolean().default(false),
  /** Artifacts to attach: a document or deck goes as its PDF, a file as stored. */
  attachments: z.array(z.object({ artifactId: z.number().int().positive() })).max(MAX_ATTACHMENTS).optional().describe('Reports, decks or files to attach, by artifact id. A document (a report, a proposal) or a deck goes as its PDF. Attach the artifact instead of mentioning its number in the body.'),
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
 * The copy as HTML and as text, the sign-off once and the sender's Gmail
 * signature under both.
 * @param body - The body after the sign-off, text or HTML.
 * @param gmailSignature - The HTML signature Gmail holds for the sender.
 */
export function emailParts(body: string, gmailSignature?: string): { html: string; text: string } {
  const sig = gmailSignature?.trim();
  const html = `<div dir="ltr">${emailBodyHtml(body)}${sig ? `<br><div dir="ltr" class="gmail_signature">${sig}</div>` : ''}</div>`;
  const sigText = sig ? emailBodyText(sig.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:div|p|tr)>/gi, '\n')).trim() : '';
  const text = `${emailBodyText(body).trim()}${sigText ? `\n\n--\n${sigText}` : ''}`;
  return { html, text };
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
 * @param attachments
 * @param gmailSignature - The sender's HTML signature from Gmail, when it has one.
 */
export function toRfc822(
  input: { to: string; subject: string; body: string; cc?: string; signature?: string },
  reply?: { inReplyTo: string; references: string },
  attachments: ReadonlyArray<{ filename: string; contentType: string; data: Buffer }> = [],
  gmailSignature?: string,
): string {
  const { html, text } = emailParts(withSignature(input.body, input.signature), gmailSignature);
  const seed = Buffer.from(input.subject + input.to).toString('hex').slice(0, 16);
  const alt = `vocion-alt-${seed}`;
  // The copy: text first, HTML last, so a client shows the richest it can.
  const copy = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text,
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
    `--${alt}--`,
  ];
  const headers = [
    `To: ${oneLine(input.to)}`,
    ...(input.cc ? [`Cc: ${oneLine(input.cc)}`] : []),
    `Subject: ${encodedWord(oneLine(input.subject))}`,
    ...(reply?.inReplyTo ? [`In-Reply-To: ${reply.inReplyTo}`, `References: ${reply.references}`] : []),
    'MIME-Version: 1.0',
  ];
  if (attachments.length === 0) {
    return Buffer.from([...headers, ...copy, ''].join('\r\n'), 'utf8').toString('base64url');
  }
  // multipart/mixed: the copy first, then each file base64 in 76-column lines.
  const boundary = `vocion-${seed}-${attachments.length}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...copy,
    ...attachments.flatMap((a) => {
      const name = encodedWord(oneLine(a.filename).replace(/"/g, '\''));
      return [
        `--${boundary}`,
        `Content-Type: ${oneLine(a.contentType)}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        'Content-Transfer-Encoding: base64',
        '',
        a.data.toString('base64').replace(/.{76}(?=.)/g, '$&\r\n'),
      ];
    }),
    `--${boundary}--`,
    '',
  ];
  return Buffer.from(parts.join('\r\n'), 'utf8').toString('base64url');
}

/**
 * The HTML signature Gmail holds for the sending address: the send-as entry
 * for the connected mailbox, else the default one. Never throws; undefined
 * when Gmail has none or does not answer, and the email goes without it.
 * @param baseUrl - The Gmail API base.
 * @param headers - Auth headers.
 * @param mailbox - The connected address, when the credential carries it.
 */
async function gmailSignatureFor(baseUrl: string, headers: Record<string, string>, mailbox: string | undefined): Promise<string | undefined> {
  try {
    const res = await fetch(`${baseUrl}/users/me/settings/sendAs`, { headers });
    if (!res.ok) {
      return undefined;
    }
    const { sendAs = [] } = (await res.json()) as { sendAs?: Array<{ sendAsEmail?: string; isDefault?: boolean; isPrimary?: boolean; signature?: string }> };
    const mine = (mailbox && sendAs.find(s => s.sendAsEmail?.toLowerCase() === mailbox.toLowerCase()))
      || sendAs.find(s => s.isDefault) || sendAs.find(s => s.isPrimary);
    return mine?.signature?.trim() || undefined;
  } catch {
    return undefined;
  }
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
  description: 'A one-to-one email as the connected Gmail user — a reply in an existing thread (pass threadId so it threads) or a follow-up to someone already in conversation; a draft by default (draft: true), sent only when asked, and the approver can switch between the two on the card. Fill to and cc as the thread has them, the subject as "Re: <thread subject>", and the sender\'s sign-off in `signature` only when their Gmail signature does not already carry one (it is added under every email). To send a report or document with it, put its artifact id in `attachments` (a document or deck goes as its PDF) — never write "artifact 123" in the body. Not for multi-touch outbound to a prospect who is not in a conversation: that is a sequence.',
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
    const attachments = await describeAttachments(ctx.orgId, input.attachments).catch(() => []);
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
        ...(attachments.length > 0 ? { attachments } : {}),
        modeChoice: true,
        doneLabel: input.draft ? 'Draft created' : 'Sent',
        openLabel: 'Open in Gmail',
      },
      content: [{ kind: 'email' as const, id: 'message', label: 'Email', subject: input.subject, body: input.body }],
      fields: [
        { label: 'To', value: input.to },
        ...(input.cc ? [{ label: 'Cc', value: input.cc }] : []),
        ...(attachments.length > 0 ? [{ label: 'Attachments', value: attachments.map(a => a.title).join(', ') }] : []),
      ],
      verbs: { approve: input.draft ? 'Create draft in Gmail' : 'Send', reject: 'Reject' },
      nextAction: input.draft ? 'Writes a draft in Gmail. Nothing is sent.' : 'Sends this email now.',
    };
  },
  async precheck(ctx, input) {
    if (!ctx.proposedBy?.startsWith('agent:')) {
      return;
    }
    const { voiceRulesFor } = await import('@/libs/writing/loadVoiceRules');
    const { lintSends } = await import('@/libs/writing/voiceRules');
    const rules = await voiceRulesFor(ctx.orgId);
    const { ok, report, count } = lintSends([{ step: 1, subject: input.subject, body: input.body }], { ...rules, maxWordsPerSend: undefined, maxAsksPerSend: undefined });
    if (ok) {
      return;
    }
    return [
      `NOTHING WAS SAVED. ${count} voice-rule violation(s) in the drafted email.`,
      'These are the workspace\'s versioned voice rules (voice.yaml plus the platform floor), not a style suggestion:',
      report,
      'Rewrite the email without those constructions and propose again. Do not paraphrase a banned phrase back in.',
    ].join('\n');
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
      // The approver's send-or-draft choice beats what the proposal suggested.
      ...(edit.mode !== undefined ? { draft: edit.mode === 'draft' } : {}),
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
    // Resolved before anything is written: an attachment that cannot go stops
    // the send with its reason, rather than an email arriving without it.
    const files = await resolveAttachments(ctx.orgId, input.attachments, ctx.reviewedBy ? { kind: 'human', id: ctx.reviewedBy } : { kind: 'system' });
    const raw = toRfc822(input, reply ?? undefined, files, await gmailSignatureFor(input.baseUrl, headers, mailbox));
    const attached = files.map(f => ({ artifactId: f.artifactId, filename: f.filename, bytes: f.data.byteLength }));
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
        ...(attached.length > 0 ? { attachments: attached } : {}),
        link: gmailLink(mailbox, messageId ? `#drafts?compose=${messageId}` : '#drafts'),
        linkLabel: 'Open in Gmail',
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
      ...(attached.length > 0 ? { attachments: attached } : {}),
      link: gmailLink(mailbox, body.threadId ? `#all/${body.threadId}` : '#sent'),
      linkLabel: 'Open in Gmail',
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
