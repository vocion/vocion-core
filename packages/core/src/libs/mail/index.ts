/**
 * Outbound email — the one place the app sends mail from.
 *
 * Provider-neutral surface (`sendMail`) over a single transport today:
 * Resend, called with plain `fetch` (`./resend.ts`). Nothing else in the
 * codebase talks to a mail API; a second provider is a second file here and
 * a branch in `sendMail()`.
 *
 * Ships DARK. `VOCION_MAIL_ENABLED=1` turns it on, following the
 * `externalWorkersEnabled()` triple: a predicate, an assert that throws the
 * error a caller can map to a status code, and a `sendMail` that — when the
 * flag is off — logs, returns `{ skipped: true }` and delivers nothing. So a
 * deployment that has not configured a sender never half-sends, and a job
 * that composes a report can still publish it in-app.
 *
 * Env (declared in `libs/Env.ts` AND documented in `.env.example`):
 *   VOCION_MAIL_ENABLED=1
 *   RESEND_API_KEY=re_…
 *   VOCION_MAIL_FROM="Vocion <reports@example.com>"   (a verified Resend domain)
 */

import process from 'node:process';
import { MailError } from './errors';
import { sendViaResend } from './resend';

export { MailError } from './errors';

export type MailAddress = string;

export type MailMessage = {
  to: MailAddress | MailAddress[];
  subject: string;
  html: string;
  /** Plain-text alternative. Always supply one — some clients render nothing else. */
  text?: string;
  /** Overrides `VOCION_MAIL_FROM` for this message only. */
  from?: MailAddress;
  replyTo?: MailAddress;
  /** Opaque tags the provider stores alongside the message (Resend: `tags`). */
  tags?: Record<string, string>;
};

export type SendMailResult
  = | { skipped: true; reason: 'disabled' }
    | { skipped: false; provider: 'resend'; id: string | null };

/** Feature flag — ships dark. `VOCION_MAIL_ENABLED=1` turns it on. */
export function mailEnabled(): boolean {
  return process.env.VOCION_MAIL_ENABLED === '1';
}

/** Throw the 501 a route returns when mail is off. */
export function assertMailEnabled(): void {
  if (!mailEnabled()) {
    throw new MailError('DISABLED', 'Outbound mail is not enabled on this deployment (set VOCION_MAIL_ENABLED=1).', 501);
  }
}

/**
 * The configured sender, or a `MailError` naming what is missing. Read at
 * call time, not module load, so a test or a worker boot can set the env
 * first.
 */
export function mailConfig(): { apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  const from = process.env.VOCION_MAIL_FROM?.trim() ?? '';
  const missing = [apiKey === '' && 'RESEND_API_KEY', from === '' && 'VOCION_MAIL_FROM'].filter(Boolean);
  if (missing.length > 0) {
    throw new MailError('MISCONFIGURED', `Outbound mail is enabled but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set.`);
  }
  return { apiKey, from };
}

/**
 * `libs/Logger` has a top-level await that is fatal in the tsx Temporal
 * worker, so log through a dynamic import — same pattern as the schedule
 * services.
 * @param level
 * @param message
 * @param properties
 */
function log(level: 'info' | 'warn', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/**
 * Send one message. When the flag is off, logs and returns `{ skipped: true }`
 * — never throws for "disabled", so a job can treat mail as optional. Throws
 * `MailError` for a misconfiguration or a provider rejection.
 * @param message - The mail to send.
 */
export async function sendMail(message: MailMessage): Promise<SendMailResult> {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  if (!mailEnabled()) {
    log('info', 'mail skipped: VOCION_MAIL_ENABLED is not 1', { subject: message.subject, to: recipients.length });
    return { skipped: true, reason: 'disabled' };
  }
  const { apiKey, from } = mailConfig();
  const id = await sendViaResend({ apiKey, from: message.from ?? from, message: { ...message, to: recipients } });
  log('info', 'mail sent', { provider: 'resend', id, subject: message.subject, to: recipients.length });
  return { skipped: false, provider: 'resend', id };
}
