/**
 * Invites, delivered by email when this server sends mail.
 *
 * An invite is still a link (`/sign-up?invite=<token>`), and the link is still
 * the invite: Copy link works with mail on or off. With mail on
 * (`libs/mail`), creating an invite also mails it to the address — "Join
 * Northwind on Vocion", who sent it, one button, when it expires — and an
 * admin can send it again from the invite's row. With mail off nothing is
 * sent, and the dialog says to share the link.
 *
 * A person who already has a login gets the same mail, and the same link opens
 * the one-click "Join Northwind" card for them (`JoinAccountCard`); their next
 * sign-in also joins it on its own (`services/auth/joinInvites.ts`).
 *
 * The link names this deployment from configuration (`NEXT_PUBLIC_APP_URL`,
 * then `AUTH_URL`), never the request's Host header, in production. A mail
 * that cannot be sent never undoes the invite: the admin is told why, and the
 * link is there to copy.
 */

import process from 'node:process';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { mailEnabled, MailError, sendMail } from '@/libs/mail';
import { inviteMail } from '@/libs/mail/authMails';
import { mailSinkDir } from '@/libs/mail/sink';
import { inviteSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { configuredOrigin } from '@/services/auth/emailLink';

/**
 * What happened to an invite's email. Anything but `sent` carries the reason,
 * in words for the admin, and is logged as a warning (`notSent`): an invite
 * that was not mailed is never silent, on the screen or in the logs.
 */
export type InviteDelivery
  /** Mailed to the address. */
  = | { status: 'sent' }
  /** This server sends no mail: share the link. */
    | { status: 'mail-off'; reason: string }
  /** Mail is on and this one did not go. */
    | { status: 'failed'; reason: string };

/** Why nothing was mailed on a server with mail off. */
export const MAIL_OFF_REASON = 'This server does not send email';

function log(level: 'info' | 'warn' | 'error', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/**
 * The link an invitee opens, on this deployment's own address. Outside
 * production, the address the admin is using stands in when none is
 * configured; in production a missing address means no mail.
 * @param token - The invite's token.
 * @param requestOrigin - The admin's request origin, used outside production only.
 */
export function inviteLinkFor(token: string, requestOrigin: string | null): string | null {
  const origin = configuredOrigin() ?? (process.env.NODE_ENV === 'production' ? null : requestOrigin);
  return origin ? `${origin}/sign-up?invite=${encodeURIComponent(token)}` : null;
}

export { inviteMail } from '@/libs/mail/authMails';

/**
 * An invite that was not mailed: logged as a warning with its reason (and the
 * invite, never the address), and returned for the screen to say.
 * @param delivery - What happened instead of a send.
 * @param context - Which invite, and anything that explains it.
 */
function notSent<D extends Exclude<InviteDelivery, { status: 'sent' }>>(delivery: D, context: Record<string, unknown>): D {
  log('warn', `invite email not sent: ${delivery.reason}`, { ...context, status: delivery.status, reason: delivery.reason });
  return delivery;
}

/**
 * Mail one pending invite to its address. Never throws: the invite stands
 * whatever happens to its mail.
 * @param input - Which invite, and from where.
 * @param input.accountId - The Org the invite is in (from the session, never the request).
 * @param input.inviteId - The invite.
 * @param input.requestOrigin - The admin's request origin, for links outside production.
 */
export async function sendInviteEmail(input: { accountId: string; inviteId: string; requestOrigin: string | null }): Promise<InviteDelivery> {
  // With mail off nothing is sent — but the dev mail sink, when on, still
  // keeps what would have been (`libs/mail/sink.ts`), so it is composed.
  const enabled = mailEnabled();
  const where = { inviteId: input.inviteId, accountId: input.accountId };
  if (!enabled && !mailSinkDir()) {
    return notSent({ status: 'mail-off', reason: MAIL_OFF_REASON }, { ...where, hint: 'set VOCION_MAIL_ENABLED=1 (with RESEND_API_KEY and VOCION_MAIL_FROM) to email invites' });
  }
  try {
    const [row] = await db
      .select({
        email: inviteSchema.email,
        token: inviteSchema.token,
        role: inviteSchema.role,
        expiresAt: inviteSchema.expiresAt,
        orgName: tenantAccountSchema.name,
        inviterName: userSchema.name,
        inviterEmail: userSchema.email,
      })
      .from(inviteSchema)
      .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, inviteSchema.accountId))
      .leftJoin(userSchema, eq(userSchema.id, inviteSchema.invitedBy))
      .where(and(eq(inviteSchema.id, input.inviteId), eq(inviteSchema.accountId, input.accountId), isNull(inviteSchema.acceptedAt)))
      .limit(1);
    if (!row) {
      return notSent({ status: 'failed', reason: 'That invite was accepted or revoked' }, where);
    }
    if (row.expiresAt < new Date()) {
      return notSent({ status: 'failed', reason: 'That invite has expired; re-invite to make a fresh one' }, where);
    }
    const link = inviteLinkFor(row.token, input.requestOrigin);
    if (!link) {
      if (!enabled) {
        return notSent({ status: 'mail-off', reason: MAIL_OFF_REASON }, where);
      }
      return notSent(
        { status: 'failed', reason: 'This server does not know its own address (NEXT_PUBLIC_APP_URL), so the link could not be mailed' },
        { ...where, hint: 'set NEXT_PUBLIC_APP_URL (or AUTH_URL) so the link can name this deployment' },
      );
    }
    const mail = inviteMail({ orgName: row.orgName, inviterName: row.inviterName || row.inviterEmail || null, role: row.role, link, expiresAt: row.expiresAt });
    const sent = await sendMail({ to: row.email, ...mail, tags: { kind: 'invite' } });
    if (sent.skipped) {
      return notSent({ status: 'mail-off', reason: MAIL_OFF_REASON }, where);
    }
    log('info', 'invite email sent', { ...where, provider: sent.provider, id: sent.id });
    return { status: 'sent' };
  } catch (error) {
    // A missing setting is the admin's to fix, so it is named; a provider's
    // refusal is detail for the logs.
    const reason = error instanceof MailError && error.code === 'MISCONFIGURED'
      ? error.message.replace(/\.$/, '')
      : 'The mail provider did not accept it';
    return notSent({ status: 'failed', reason }, { ...where, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Count one invite email against the admin's hourly allowance
 * (`inviteEmailPerUser`). Null when it may go; otherwise the sentence saying
 * when the next one can (`message`), and the same as a reason for a delivery
 * line (`reason`).
 * @param userId - The admin sending it.
 */
export async function inviteEmailRefusal(userId: string): Promise<{ message: string; reason: string; retryAfterSeconds: number } | null> {
  const { describeWait, hit, RATE_LIMITS } = await import('@/libs/rateLimit');
  const verdict = await hit(RATE_LIMITS.inviteEmailPerUser, userId);
  return verdict.allowed
    ? null
    : {
        message: `Too many invite emails. Try again in ${describeWait(verdict.retryAfterSeconds)}, or copy the link.`,
        reason: `Too many invite emails this hour; try again in ${describeWait(verdict.retryAfterSeconds)}`,
        retryAfterSeconds: verdict.retryAfterSeconds,
      };
}

/**
 * Everything that follows making an invite, wherever it was made — the
 * Members page or a setup card in chat (`members.invite`): mail it when mail
 * is on (within the admin's allowance), and tell a person who already has a
 * login in the app (`tellInvitee`). Never throws; the invite stands whatever
 * happens here.
 * @param input - The invite just made.
 * @param input.accountId - Its Org.
 * @param input.inviteId - The invite.
 * @param input.email - The invited address.
 * @param input.invitedBy - The admin who made it, whose allowance the email counts against.
 * @param input.requestOrigin - The admin's request origin, for links outside production.
 */
export async function deliverInvite(input: { accountId: string; inviteId: string; email: string; invitedBy: string; requestOrigin: string | null }): Promise<InviteDelivery> {
  const refusal = mailEnabled() ? await inviteEmailRefusal(input.invitedBy).catch(() => null) : null;
  const delivery: InviteDelivery = refusal
    ? notSent({ status: 'failed', reason: refusal.reason }, { inviteId: input.inviteId, accountId: input.accountId, retryAfterSeconds: refusal.retryAfterSeconds })
    : await sendInviteEmail({ accountId: input.accountId, inviteId: input.inviteId, requestOrigin: input.requestOrigin });
  // Telling a person in the app is a courtesy: it never takes the mail's
  // answer, or the invite, down with it.
  try {
    const { tellInvitee } = await import('@/services/auth/joinInvites');
    await tellInvitee({ email: input.email, accountId: input.accountId, inviteId: input.inviteId });
  } catch (error) {
    log('warn', 'invitee could not be told in the app; the invite stands', { inviteId: input.inviteId, error: error instanceof Error ? error.message : String(error) });
  }
  return delivery;
}
