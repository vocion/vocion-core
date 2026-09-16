import type { ChatVerification } from './types';
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Email as a chat surface — the second adapter after Slack, and the first one
 * where the "channel" is an address a workspace owns.
 *
 * Inbound: Resend receives mail for the deployment's domain (MX at the apex)
 * and POSTs an `email.received` webhook. The webhook carries METADATA ONLY —
 * "Webhooks do not include the email body, headers, or attachments, only
 * their metadata" — so the body is fetched from `GET /emails/receiving/{id}`
 * before an agent sees it (`services/EmailSurfaceService.ts`). Outbound: the
 * reply goes through `libs/mail` with `In-Reply-To` / `References` set so the
 * person's client threads it.
 *
 * Verification is Svix's scheme (Resend signs with it): HMAC-SHA256 over
 * `${svix-id}.${svix-timestamp}.${raw body}` keyed with the base64 secret
 * after the `whsec_` prefix, base64 output, compared in constant time; the
 * `svix-signature` header is a space-separated list of `v1,<sig>`.
 *
 * Nothing here talks to the database: this file is verification and payload
 * shape, the same split as `slack.ts`.
 */

/** Svix's default replay window. */
const MAX_SKEW_SECONDS = 300;

export type ReceivedEmailEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    received_for?: string[];
    message_id?: string;
    subject?: string;
    attachments?: { id?: string; filename?: string; content_type?: string; content_disposition?: string | null; content_id?: string | null }[];
  };
};

/** The webhook, normalised — still body-less; the service fetches the rest. */
export type EmailInboundMeta = {
  surface: 'email';
  /** Resend's id for the received email — idempotency key and the fetch handle. */
  receivedEmailId: string;
  /** Bare sender address, lower-case. */
  from: string;
  /** Sender as written, e.g. `Chris Fitkin <chris@example.com>`. */
  fromRaw: string;
  /** Every recipient address, bare and lower-case (to + cc + received_for). */
  recipients: string[];
  subject: string;
  /** RFC 5322 Message-ID with the angle brackets stripped, or null. */
  messageId: string | null;
  attachments: { id: string; filename: string; contentType: string }[];
};

export type EmailParse
  = | { kind: 'message'; inbound: EmailInboundMeta }
    | { kind: 'ignore'; reason: string };

/**
 * Verify a Svix-signed webhook against the raw body.
 * @param rawBody - The exact request body, unparsed.
 * @param headers - Request headers (`svix-id`, `svix-timestamp`, `svix-signature`).
 * @param secret - The endpoint's signing secret (`whsec_…`).
 * @param now - Clock, injectable for tests (seconds).
 */
export function verifySvixSignature(rawBody: string, headers: Headers, secret: string | undefined, now: number = Math.floor(Date.now() / 1000)): ChatVerification {
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !ts || !sigHeader) {
    return { ok: false, reason: 'missing_headers' };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale' };
  }
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
  const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64'));
  const candidates = sigHeader.split(/\s+/).filter(Boolean).map((entry) => {
    const comma = entry.indexOf(',');
    return comma === -1 ? entry : entry.slice(comma + 1);
  });
  const matched = candidates.some((sig) => {
    const b = Buffer.from(sig);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
  return matched ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/**
 * The bare address inside `Name <addr>` (or the string itself), lower-cased.
 * @param raw - An address as written in a header.
 */
export function bareAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1]! : raw).trim().toLowerCase();
}

/**
 * `<abc@host>` → `abc@host`. Message-IDs are compared without brackets.
 * @param raw - A Message-ID as written.
 */
export function stripAngles(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const s = raw.trim().replace(/^<|>$/g, '');
  return s || null;
}

/**
 * Classify a Resend webhook payload. Only `email.received` becomes a message;
 * every other event (deliveries, bounces, opens) is ignored by name.
 * @param payload - Parsed JSON body.
 */
export function parseResendPayload(payload: unknown): EmailParse {
  const ev = (payload ?? {}) as ReceivedEmailEvent;
  if (ev.type !== 'email.received') {
    return { kind: 'ignore', reason: `event type ${ev.type ?? 'unknown'}` };
  }
  const d = ev.data ?? {};
  if (!d.email_id || !d.from) {
    return { kind: 'ignore', reason: 'incomplete event' };
  }
  const recipients = [...(d.to ?? []), ...(d.cc ?? []), ...(d.received_for ?? [])].map(bareAddress).filter(Boolean);
  if (recipients.length === 0) {
    return { kind: 'ignore', reason: 'no recipient' };
  }
  const inbound: EmailInboundMeta = {
    surface: 'email',
    receivedEmailId: d.email_id,
    from: bareAddress(d.from),
    fromRaw: d.from,
    recipients: [...new Set(recipients)],
    subject: (d.subject ?? '').trim(),
    messageId: stripAngles(d.message_id),
    attachments: (d.attachments ?? [])
      .filter(a => a.id && a.filename)
      .map(a => ({ id: a.id!, filename: a.filename!, contentType: a.content_type ?? 'application/octet-stream' })),
  };
  return { kind: 'message', inbound };
}

/** The full received email, as `GET /emails/receiving/{id}` returns it. */
export type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers?: Record<string, string>;
  message_id?: string;
  attachments?: { id: string; filename: string; content_type: string; size?: number }[];
};

export const RESEND_RECEIVING_ENDPOINT = 'https://api.resend.com/emails/receiving';

/**
 * Fetch a received email's body and headers. Throws on a non-2xx so the
 * caller can record a failure instead of answering an empty message.
 * @param id - Resend's received-email id.
 * @param apiKey - `RESEND_API_KEY`.
 * @param fetchImpl - Injected in tests.
 */
export async function fetchReceivedEmail(id: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ReceivedEmail> {
  const res = await fetchImpl(`${RESEND_RECEIVING_ENDPOINT}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Resend receiving API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }
  return (await res.json()) as ReceivedEmail;
}

/**
 * The part of a mail a person actually wrote: quoted history and the
 * signature are cut so the agent answers the question, not the whole thread.
 * Heuristic on purpose — every client quotes differently — and it never
 * returns an empty string when the input had any text.
 * @param text - Plain-text body.
 */
export function stripQuotedHistory(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*-{2,}\s*$/.test(line)) {
      break; // "-- " signature separator
    }
    if (/^-{3,}\s*Original Message\s*-{3,}/i.test(line) || /^_{5,}\s*$/.test(line)) {
      break;
    }
    if (/^On .{6,}? wrote:\s*$/.test(line.trim()) || /^Le .{6,}? a écrit\s*:\s*$/.test(line.trim())) {
      break;
    }
    if (/^From:\s.+/.test(line) && out.length > 0) {
      break; // forwarded/quoted header block
    }
    if (line.trimStart().startsWith('>')) {
      continue;
    }
    out.push(line);
  }
  const trimmed = out.join('\n').trim();
  return trimmed || text.trim();
}

/**
 * Plain text from HTML when the mail carried no text part. Tags are dropped,
 * block elements become line breaks, entities are decoded for the common few.
 * @param html - HTML body.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * `Re: Re: X` → `X`, for the fallback that threads by sender + subject.
 * @param subject - As written.
 */
export function normaliseSubject(subject: string): string {
  return stripReplyPrefixes(subject, /^(?:re|fwd?|aw|sv|antw):/i).toLowerCase();
}

/**
 * Peel `Re:` / `Fwd:`-style prefixes one at a time. A loop rather than a
 * repeated group, so the pattern cannot backtrack super-linearly.
 * @param subject - As written.
 * @param prefix - Which prefixes count, anchored at the start, no whitespace.
 */
function stripReplyPrefixes(subject: string, prefix: RegExp): string {
  let s = subject.trim();
  for (;;) {
    const m = s.match(prefix);
    if (!m) {
      return s;
    }
    s = s.slice(m[0].length).trim();
  }
}

/**
 * The reply's subject: one `Re:` prefix, never stacked.
 * @param subject - The inbound subject.
 */
export function replySubject(subject: string): string {
  const base = stripReplyPrefixes(subject, /^re:/i);
  return base ? `Re: ${base}` : 'Re: your message';
}

/**
 * Message-IDs a reply names, in reference order, brackets stripped — the
 * most recent (`In-Reply-To`) first. From the received email's headers.
 * @param headers - Header map as Resend returns it (lower-case keys expected, mixed tolerated).
 */
export function referencedMessageIds(headers: Record<string, string> | undefined): string[] {
  if (!headers) {
    return [];
  }
  const get = (name: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
  const ids: string[] = [];
  const inReplyTo = stripAngles(get('in-reply-to'));
  if (inReplyTo) {
    ids.push(inReplyTo);
  }
  const refs = get('references') ?? '';
  for (const m of refs.matchAll(/<([^>]+)>/g)) {
    const id = m[1]!.trim();
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}
