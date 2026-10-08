/**
 * "Email me a sign-in link": passwordless sign-in through Auth.js's email
 * provider, sent with the deployment's own mail sender (`libs/mail`, Resend).
 *
 * Offered only when outbound mail is on and configured
 * (`VOCION_MAIL_ENABLED=1` with a transport: `RESEND_API_KEY` and
 * `VOCION_MAIL_FROM`, or the dev mail sink — `libs/mail`) and, in
 * production, when the deployment knows its own address (`NEXT_PUBLIC_APP_URL`
 * or `AUTH_URL`) — see {@link emailLinkConfigured}.
 *
 * The rules:
 *
 * - **Invite-only holds.** A link is mailed only to an address that has a
 *   login, a pending invite, or (where the operator listed its domain) an
 *   auto-join domain. Clicking it signs that login in, or accepts the invite
 *   exactly as Google or Microsoft would (`services/auth/externalSignIn.ts`).
 * - **Nothing to enumerate.** The page answers "If you have an account, we've
 *   sent a link" whatever the address. Whether to send is decided after the
 *   answer, off the request path, so a known and an unknown address also take
 *   the same time to answer.
 * - **One use, fifteen minutes.** Auth.js stores only a hash of the token
 *   (keyed with `AUTH_SECRET`), deletes it on use, and refuses it once expired.
 * - **Limited.** Three links per address and ten per network address every
 *   fifteen minutes, counted for every address alike so the limit reveals
 *   nothing either — in the shared limiter (`libs/rateLimit`), so the count
 *   holds across instances and restarts like every other sign-in limit.
 * - **The link names this deployment, never the request's `Host`.** A forged
 *   Host header would otherwise mail someone a working link to a stranger's
 *   server. In production the address comes from configuration only.
 * - **A mail scanner cannot spend it.** Microsoft Defender and similar tools
 *   open every link in a message before the person does; a link straight to
 *   Auth.js's callback would be used up by the scanner. The mailed link opens
 *   `/sign-in/email-link`, which carries the token in its fragment (so it
 *   never reaches a server log either) and asks the person to press "Sign in".
 */

import type { EmailConfig } from 'next-auth/providers/email';
import type { SignInEnv } from '@/libs/identity/signInProviders';
import process from 'node:process';
import { mailTransportConfigured, sendMail } from '@/libs/mail';
import { EMAIL_LINK_TTL_MINUTES, signInLinkMail } from '@/libs/mail/authMails';
import { firstRefusal, hit, RATE_LIMITS } from '@/libs/rateLimit';
import { EMAIL_LINK_LANDING_PATH, EMAIL_LINK_PROVIDER_ID } from './emailLinkFragment';
import { mayEmailSignInLink } from './signInDecision';

export { EMAIL_LINK_PROVIDER_ID } from './emailLinkFragment';

export { EMAIL_LINK_TTL_MINUTES, signInLinkMail } from '@/libs/mail/authMails';

function log(level: 'info' | 'warn' | 'error', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/**
 * The deployment's configured public origin (`NEXT_PUBLIC_APP_URL`, then
 * `AUTH_URL`), or null when neither is set or parses.
 * @param env - The environment.
 */
export function configuredOrigin(env: SignInEnv = process.env): string | null {
  for (const value of [env.NEXT_PUBLIC_APP_URL, env.AUTH_URL]) {
    const raw = value?.trim();
    if (raw && URL.canParse(raw)) {
      return new URL(raw).origin;
    }
  }
  return null;
}

/**
 * Whether "Email me a sign-in link" is offered: mail is on with a key and a
 * sender, and the link can name this deployment.
 * @param env - The environment; `process.env` by default.
 */
export function emailLinkConfigured(env: SignInEnv = process.env): boolean {
  return mailTransportConfigured(env) && (env.NODE_ENV !== 'production' || configuredOrigin(env) !== null);
}

/**
 * The link to mail, built from Auth.js's callback URL: the landing page on
 * this deployment's own address, with Auth.js's parameters in the fragment.
 * Null when the address is unknown (production with nothing configured).
 * @param authUrl - The callback URL Auth.js built (`…/api/auth/callback/email?callbackUrl&token&email`).
 * @param env - The environment; `process.env` by default.
 */
export function mailedLinkFor(authUrl: string, env: SignInEnv = process.env): string | null {
  if (!URL.canParse(authUrl)) {
    return null;
  }
  const parsed = new URL(authUrl);
  const origin = configuredOrigin(env) ?? (env.NODE_ENV === 'production' ? null : parsed.origin);
  if (!origin) {
    return null;
  }
  const params = new URLSearchParams();
  for (const key of ['token', 'email', 'callbackUrl']) {
    const value = parsed.searchParams.get(key);
    if (value) {
      params.set(key, value);
    }
  }
  return `${origin}${EMAIL_LINK_LANDING_PATH}#${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/**
 * Count a link request against both limits (`emailLinkPerIp`,
 * `emailLinkPerEmail`). Every address counts the same, whether or not a link
 * will be mailed to it.
 * @param input - The request.
 * @param input.email - The typed address, normalized.
 * @param input.ip - The caller's address, or null when unknown (no network limit then).
 * @param input.now - The current time; tests pass one.
 */
export async function countLinkRequest(input: { email: string; ip: string | null; now?: Date }) {
  return firstRefusal(
    await hit(RATE_LIMITS.emailLinkPerIp, input.ip, input.now),
    await hit(RATE_LIMITS.emailLinkPerEmail, input.email, input.now),
  );
}

/**
 * Auth.js's answer to "email me a link": `true` (Auth.js then issues the
 * token and calls {@link sendVerificationRequest}), or the sign-in page that
 * says to wait. The same for every address.
 * @param input - The request.
 * @param input.email - The typed address, normalized.
 * @param input.ip - The caller's address, or null.
 * @param input.now - The current time; tests pass one.
 */
export async function linkRequestAnswer(input: { email: string; ip: string | null; now?: Date }): Promise<true | string> {
  const counted = await countLinkRequest(input);
  if (counted.allowed) {
    return true;
  }
  return `/sign-in?${new URLSearchParams({ error: 'EmailLinkRateLimited', retryAfter: String(counted.retryAfterSeconds) }).toString()}`;
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

/**
 * Mail the link if the address may have one. Runs after the page has its
 * answer; never throws.
 * @param input - The address and the link.
 * @param input.email - The address the link is for.
 * @param input.link - The mailed link.
 * @param input.now - The current time.
 */
export async function deliverSignInLink(input: { email: string; link: string; now?: Date }): Promise<'sent' | 'not-eligible' | 'mail-off' | 'failed'> {
  try {
    const [{ userIdByEmail }, { invitesFor, orgsOf }, { autoJoinPolicy }, { orgsMode }] = await Promise.all([
      import('./externalSignIn'),
      import('./joinInvites'),
      import('./autoJoin'),
      import('@/services/OrgPolicy'),
    ]);
    const [userId, invites] = await Promise.all([userIdByEmail(input.email), invitesFor(input.email)]);
    const orgs = { mode: orgsMode(), memberOf: userId ? await orgsOf(userId) : [], autoJoin: userId ? null : await autoJoinPolicy() };
    if (!mayEmailSignInLink({ email: input.email, userIdByEmail: userId, invites, orgs, now: input.now ?? new Date() })) {
      log('info', 'sign-in link not sent: no login, pending invite or auto-join domain for that address');
      return 'not-eligible';
    }
    const result = await sendMail({ to: input.email, ...signInLinkMail(input.link), tags: { kind: 'sign-in-link' }, brand: 'install' });
    return result.skipped ? 'mail-off' : 'sent';
  } catch (error) {
    log('error', 'sign-in link could not be sent', { error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }
}

/**
 * Auth.js's `sendVerificationRequest`: hand back at once, deliver later.
 * @param params - What Auth.js passes.
 * @param params.identifier - The normalized address.
 * @param params.url - Auth.js's callback URL with the token.
 */
export function sendVerificationRequest(params: { identifier: string; url: string }): void {
  const link = mailedLinkFor(params.url);
  if (!link) {
    log('error', 'sign-in link not sent: set NEXT_PUBLIC_APP_URL (or AUTH_URL) so the link can name this deployment');
    return;
  }
  void deliverSignInLink({ email: params.identifier, link });
}

/** The Auth.js email provider, configured as above. */
export function emailLinkProvider(): EmailConfig {
  return {
    id: EMAIL_LINK_PROVIDER_ID,
    type: 'email',
    name: 'Email',
    maxAge: EMAIL_LINK_TTL_MINUTES * 60,
    sendVerificationRequest,
    options: {},
  };
}
