/**
 * Outbound email — the one place the app sends mail from.
 *
 * Provider-neutral surface (`sendMail`) over one transport, Resend, called
 * with plain `fetch` (`./resend.ts`), plus the dev mail sink (`./sink.ts`,
 * `VOCION_MAIL_SINK_DIR`), which keeps a copy of every message and stands in
 * for Resend when Resend is not configured. Nothing else in the codebase talks
 * to a mail API; a second provider is a second file here and a branch in
 * `sendMail()`.
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
 *   VOCION_MAIL_SINK_DIR=.mail-sink                   (dev only: see ./sink.ts)
 */

import process from 'node:process';
import { MailError } from './errors';
import { sendViaResend } from './resend';
import { mailSinkDir, writeToSink } from './sink';

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
  /**
   * Extra RFC 5322 headers — `In-Reply-To`, `References`, `Message-ID` — so a
   * reply threads under the mail it answers in the recipient's client.
   */
  headers?: Record<string, string>;
  /**
   * Whose mail this is, so it goes out in that Org's brand — a header with
   * its logo, and its name on the deployment's sender
   * (`services/branding/mailBrand.ts`): a workspace (`{ orgId }`), an Org
   * (`{ accountId }`), or the server's one Org (`'install'`). Absent, the
   * mail goes out exactly as written.
   */
  brand?: { orgId?: string | null; accountId?: string | null } | 'install';
};

export type SendMailResult
  = | { skipped: true; reason: 'disabled' }
    | { skipped: false; provider: 'resend' | 'sink'; id: string | null };

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
 * Whether mail is on AND has somewhere to go: Resend's key and sender, or the
 * dev mail sink. What a feature that only makes sense with working mail
 * (email sign-in links) asks before offering itself.
 * @param env - The environment; `process.env` by default.
 */
export function mailTransportConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VOCION_MAIL_ENABLED !== '1') {
    return false;
  }
  const resend = Boolean(env.RESEND_API_KEY?.trim()) && Boolean(env.VOCION_MAIL_FROM?.trim());
  return resend || mailSinkDir(env) !== null;
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
 * The message in its Org's brand (`services/branding/mailBrand.ts`), when
 * the caller named whose mail it is; as written otherwise. The brand is a
 * finish, never a reason a mail does not go: a failure to read it is logged.
 * @param message - The mail.
 */
async function branded(message: MailMessage): Promise<MailMessage> {
  const { brand, ...rest } = message;
  if (!brand) {
    return rest;
  }
  try {
    const { applyMailBrand } = await import('@/services/branding/mailBrand');
    return await applyMailBrand(rest, brand, process.env.VOCION_MAIL_FROM?.trim() ?? '');
  } catch (err) {
    log('warn', 'mail sent without the Org brand: it could not be read', { error: err instanceof Error ? err.message : String(err) });
    return rest;
  }
}

/**
 * Send one message. When the flag is off, logs and returns `{ skipped: true }`
 * — never throws for "disabled", so a job can treat mail as optional. Throws
 * `MailError` for a misconfiguration or a provider rejection.
 *
 * With the dev mail sink on (`VOCION_MAIL_SINK_DIR`), every message is also
 * written there — delivered or not — and with mail on but no Resend settings,
 * the sink is where it is delivered (`./sink.ts`).
 * @param message - The mail to send.
 */
export async function sendMail(message: MailMessage): Promise<SendMailResult> {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  const sink = mailSinkDir();
  // What the sink records: the mail as it went out, branded once it is.
  const sent = { html: message.html };
  // A copy in the sink never decides a send: a disk error is logged, and
  // only matters when the sink was the transport (then it is the failure).
  const keep = async (delivered: 'resend' | 'sink' | false, from: string | null): Promise<string | null> => {
    if (!sink) {
      return null;
    }
    const mail = { at: new Date().toISOString(), from, to: recipients, subject: message.subject, text: message.text ?? null, html: sent.html, tags: message.tags ?? {}, delivered };
    if (delivered === 'sink') {
      return writeToSink(sink, mail);
    }
    return writeToSink(sink, mail).catch((error: unknown) => {
      log('warn', 'could not write to the dev mail sink', { error: error instanceof Error ? error.message : String(error) });
      return null;
    });
  };
  if (!mailEnabled()) {
    await keep(false, message.from ?? process.env.VOCION_MAIL_FROM?.trim() ?? null);
    log('info', 'mail skipped: VOCION_MAIL_ENABLED is not 1', { subject: message.subject, to: recipients.length });
    return { skipped: true, reason: 'disabled' };
  }
  // In the Org's brand when the caller named whose mail it is (`brand`).
  const outgoing = await branded(message);
  sent.html = outgoing.html;
  const resendConfigured = Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(process.env.VOCION_MAIL_FROM?.trim());
  if (sink && !resendConfigured) {
    const id = await keep('sink', outgoing.from ?? process.env.VOCION_MAIL_FROM?.trim() ?? null);
    log('info', 'mail written to the dev mail sink', { subject: message.subject, to: recipients.length });
    return { skipped: false, provider: 'sink', id };
  }
  const { apiKey, from } = mailConfig();
  const id = await sendViaResend({ apiKey, from: outgoing.from ?? from, message: { ...outgoing, to: recipients } });
  await keep('resend', outgoing.from ?? from);
  log('info', 'mail sent', { provider: 'resend', id, subject: message.subject, to: recipients.length });
  return { skipped: false, provider: 'resend', id };
}
