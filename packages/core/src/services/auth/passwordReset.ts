/**
 * Forgot-password: a single-use, short-lived link sent by mail.
 *
 *   requestPasswordReset  → `/api/password-reset` (from `/forgot-password`)
 *   resetPassword         → `/api/password-reset/confirm` (from `/reset-password`)
 *
 * Nothing here says whether an email has a login. The request answers the
 * same for a known and an unknown address, and the mail is sent after the
 * answer is decided rather than before it, so the response time does not
 * carry the answer either. Limits apply per address and per email asked about,
 * equally to every email.
 *
 * Only the SHA-256 of the token is stored: the link in the mail is the one copy
 * of the secret. A new request spends every older link, a used link is spent
 * by a conditional update (two tabs, one reset), and a link expires an hour
 * after it is issued. A reset also clears the sign-in lockout on that email,
 * because a person who just proved they own the mailbox should be able to use
 * the password they chose.
 *
 * The link's address comes from configuration (`NEXT_PUBLIC_APP_URL`, then
 * `AUTH_URL`), never from the request's Host header: a forged Host would
 * otherwise mail a victim a working token pointing at someone else's site.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { hashPassword } from '@/libs/identity/password';
import { appBaseUrl } from '@/libs/links';
import { sendMail } from '@/libs/mail';
import { clear, firstRefusal, hit, RATE_LIMITS } from '@/libs/rateLimit';
import { passwordResetTokenSchema, userSchema } from '@/models/Schema';
import { AppConfig } from '@/utils/AppConfig';

export const RESET_LINK_TTL_MINUTES = 60;
export const MIN_PASSWORD_LENGTH = 8;

export type ResetRequestOutcome
  /**
   * The request went through. `delivery` settles once the link is issued and
   * mailed (or found to have no login to go to); a route does not await it.
   */
  = | { ok: true; delivery: Promise<void> }
    | { ok: false; retryAfterSeconds: number };

export type ResetOutcome
  = | { ok: true; email: string }
    | { ok: false; reason: 'invalid' | 'weak-password' };

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function log(level: 'info' | 'warn' | 'error', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/**
 * Where the mailed link points. Configured addresses only in production;
 * development may fall back to the address the request came in on.
 * @param requestOrigin - The request's own origin, used outside production only.
 */
function resetLinkBase(requestOrigin: string | null): string | null {
  const configured = appBaseUrl() || process.env.AUTH_URL?.trim().replace(/\/+$/, '') || '';
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed value is treated as unset.
    }
  }
  return process.env.NODE_ENV === 'production' ? null : requestOrigin;
}

function resetMail(link: string): { subject: string; html: string; text: string } {
  const minutes = RESET_LINK_TTL_MINUTES;
  return {
    subject: `Reset your ${AppConfig.name} password`,
    text: [
      `Someone asked to reset the password for this email on ${AppConfig.name}.`,
      '',
      `Choose a new password: ${link}`,
      '',
      `The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this mail — your password has not changed.`,
    ].join('\n'),
    html: [
      `<p>Someone asked to reset the password for this email on ${AppConfig.name}.</p>`,
      `<p><a href="${link}">Choose a new password</a></p>`,
      `<p>The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this mail — your password has not changed.</p>`,
    ].join(''),
  };
}

/**
 * Ask for a reset link. Answers the same whether or not the email has a login.
 * @param opts - The request.
 * @param opts.email - The email typed on the form.
 * @param opts.ip - The caller's address, when known.
 * @param opts.requestOrigin - The request's origin, for links outside production.
 * @param opts.now - The current time; tests pass one.
 */
export async function requestPasswordReset(opts: {
  email: string;
  ip: string | null;
  requestOrigin: string | null;
  now?: Date;
}): Promise<ResetRequestOutcome> {
  const now = opts.now ?? new Date();
  const email = opts.email.trim().toLowerCase();
  const limited = firstRefusal(
    await hit(RATE_LIMITS.passwordResetRequestPerIp, opts.ip, now),
    await hit(RATE_LIMITS.passwordResetRequestPerEmail, email, now),
  );
  if (!limited.allowed) {
    return { ok: false, retryAfterSeconds: limited.retryAfterSeconds };
  }

  // Everything past this point happens after the answer is decided, so a
  // known and an unknown email take the same time to answer.
  const delivery = issueAndSend({ email, now, requestOrigin: opts.requestOrigin }).catch((error: unknown) => {
    log('error', 'password reset failed', { error: error instanceof Error ? error.message : String(error) });
  });
  return { ok: true, delivery };
}

async function issueAndSend(opts: { email: string; now: Date; requestOrigin: string | null }): Promise<void> {
  const { email, now } = opts;
  const [user] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email)).limit(1);
  if (!user) {
    return;
  }

  const token = randomBytes(32).toString('base64url');
  await db.transaction(async (tx) => {
    // Only the newest link works: asking twice spends the first.
    await tx
      .update(passwordResetTokenSchema)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokenSchema.userId, user.id), isNull(passwordResetTokenSchema.usedAt)));
    await tx.insert(passwordResetTokenSchema).values({
      id: `prt-${randomUUID()}`,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + RESET_LINK_TTL_MINUTES * 60_000),
    });
  });

  const base = resetLinkBase(opts.requestOrigin);
  if (!base) {
    log('error', 'password reset link not sent: set NEXT_PUBLIC_APP_URL (or AUTH_URL) so the link can name this deployment');
    return;
  }
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  const result = await sendMail({ to: email, ...resetMail(link), tags: { kind: 'password-reset' } });
  if (result.skipped) {
    log('warn', 'password reset requested but outbound mail is off (VOCION_MAIL_ENABLED is not 1)');
  }
}

/**
 * Whether a reset link is still good, without spending it — for the reset
 * page to say "this link has expired" before the person types a password.
 * @param token - The token from the link.
 * @param now - The current time; tests pass one.
 */
export async function resetLinkIsLive(token: string, now: Date = new Date()): Promise<boolean> {
  if (!token) {
    return false;
  }
  const [row] = await db
    .select({ id: passwordResetTokenSchema.id })
    .from(passwordResetTokenSchema)
    .where(and(
      eq(passwordResetTokenSchema.tokenHash, hashToken(token)),
      isNull(passwordResetTokenSchema.usedAt),
      gt(passwordResetTokenSchema.expiresAt, now),
    ))
    .limit(1);
  return Boolean(row);
}

/**
 * Spend a reset link and set the new password.
 * @param opts - The reset.
 * @param opts.token - The token from the link.
 * @param opts.password - The new password.
 * @param opts.now - The current time; tests pass one.
 */
export async function resetPassword(opts: { token: string; password: string; now?: Date }): Promise<ResetOutcome> {
  const now = opts.now ?? new Date();
  if (opts.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'weak-password' };
  }
  // A cheap read first, so a guessed token costs a lookup and not a bcrypt
  // hash; the conditional update below is still what decides.
  if (!(await resetLinkIsLive(opts.token, now))) {
    return { ok: false, reason: 'invalid' };
  }
  const passwordHash = await hashPassword(opts.password);
  const email = await db.transaction(async (tx) => {
    const [spent] = await tx
      .update(passwordResetTokenSchema)
      .set({ usedAt: now })
      .where(and(
        eq(passwordResetTokenSchema.tokenHash, hashToken(opts.token)),
        isNull(passwordResetTokenSchema.usedAt),
        gt(passwordResetTokenSchema.expiresAt, now),
      ))
      .returning({ userId: passwordResetTokenSchema.userId });
    if (!spent) {
      return null;
    }
    const [user] = await tx
      .update(userSchema)
      .set({ passwordHash })
      .where(eq(userSchema.id, spent.userId))
      .returning({ email: userSchema.email });
    // Any other live link for this person is spent with it.
    await tx
      .update(passwordResetTokenSchema)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokenSchema.userId, spent.userId), isNull(passwordResetTokenSchema.usedAt)));
    return user?.email ?? null;
  });
  if (!email) {
    return { ok: false, reason: 'invalid' };
  }
  await clear(RATE_LIMITS.signInFailuresPerAccount, email);
  return { ok: true, email };
}
