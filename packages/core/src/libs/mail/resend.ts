/**
 * Resend transport — `POST https://api.resend.com/emails` over plain `fetch`.
 *
 * No SDK: the request is one JSON body and one bearer header, and a
 * dependency would only add a second copy of `fetch`. Kept behind
 * `libs/mail/index.ts`; nothing else imports this file.
 */

import type { MailMessage } from './index';
import { MailError } from './errors';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type ResendRequest = {
  apiKey: string;
  from: string;
  message: Omit<MailMessage, 'to' | 'from'> & { to: string[] };
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
};

/**
 * The body Resend accepts. Exported so the test can pin the exact shape.
 * @param from
 * @param message
 */
export function buildResendBody(from: string, message: ResendRequest['message']): Record<string, unknown> {
  const body: Record<string, unknown> = {
    from,
    to: message.to,
    subject: message.subject,
    html: message.html,
  };
  if (message.text) {
    body.text = message.text;
  }
  if (message.replyTo) {
    body.reply_to = message.replyTo;
  }
  if (message.tags && Object.keys(message.tags).length > 0) {
    body.tags = Object.entries(message.tags).map(([name, value]) => ({ name, value }));
  }
  if (message.headers && Object.keys(message.headers).length > 0) {
    body.headers = message.headers;
  }
  return body;
}

/**
 * Send and return Resend's message id (or null if the response carried none).
 * A non-2xx response becomes a `MailError('PROVIDER')` carrying the status
 * and the first 500 chars of the body, so a misconfigured sender domain is
 * readable in the job result instead of a bare "500".
 * @param req - Key, sender, message and an optional fetch to inject.
 */
export async function sendViaResend(req: ResendRequest): Promise<string | null> {
  const doFetch = req.fetchImpl ?? fetch;
  const res = await doFetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildResendBody(req.from, req.message)),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new MailError('PROVIDER', `Resend rejected the message (${res.status}): ${raw.slice(0, 500)}`, 502);
  }
  try {
    const parsed = JSON.parse(raw) as { id?: string };
    return typeof parsed.id === 'string' ? parsed.id : null;
  } catch {
    return null;
  }
}
