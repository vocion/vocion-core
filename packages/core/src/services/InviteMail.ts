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
import { mailEnabled, sendMail } from '@/libs/mail';
import { inviteMail } from '@/libs/mail/authMails';
import { mailSinkDir } from '@/libs/mail/sink';
import { inviteSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { configuredOrigin } from '@/services/auth/emailLink';

/** What happened to an invite's email. */
export type InviteDelivery
  /** Mailed to the address. */
  = | { status: 'sent' }
  /** This server sends no mail: share the link. */
    | { status: 'mail-off' }
  /** Mail is on and this one did not go; the reason is for the admin. */
    | { status: 'failed'; reason: string };

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
  if (!enabled && !mailSinkDir()) {
    return { status: 'mail-off' };
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
      return { status: 'failed', reason: 'That invite was accepted or revoked.' };
    }
    if (row.expiresAt < new Date()) {
      return { status: 'failed', reason: 'That invite has expired. Re-invite to make a fresh one.' };
    }
    const link = inviteLinkFor(row.token, input.requestOrigin);
    if (!link) {
      if (!enabled) {
        return { status: 'mail-off' };
      }
      log('error', 'invite email not sent: set NEXT_PUBLIC_APP_URL (or AUTH_URL) so the link can name this deployment');
      return { status: 'failed', reason: 'This server does not know its own address (NEXT_PUBLIC_APP_URL), so the link could not be mailed. Copy it instead.' };
    }
    const mail = inviteMail({ orgName: row.orgName, inviterName: row.inviterName || row.inviterEmail || null, role: row.role, link, expiresAt: row.expiresAt });
    const sent = await sendMail({ to: row.email, ...mail, tags: { kind: 'invite' } });
    return sent.skipped ? { status: 'mail-off' } : { status: 'sent' };
  } catch (error) {
    log('warn', 'invite email could not be sent; the link still works', { error: error instanceof Error ? error.message : String(error) });
    return { status: 'failed', reason: 'The email did not go. Copy the link and send it yourself.' };
  }
}

/**
 * Count one invite email against the admin's hourly allowance
 * (`inviteEmailPerUser`). Null when it may go; otherwise the sentence saying
 * when the next one can.
 * @param userId - The admin sending it.
 */
export async function inviteEmailRefusal(userId: string): Promise<{ message: string; retryAfterSeconds: number } | null> {
  const { describeWait, hit, RATE_LIMITS } = await import('@/libs/rateLimit');
  const verdict = await hit(RATE_LIMITS.inviteEmailPerUser, userId);
  return verdict.allowed
    ? null
    : { message: `Too many invite emails. Try again in ${describeWait(verdict.retryAfterSeconds)}, or copy the link.`, retryAfterSeconds: verdict.retryAfterSeconds };
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
    ? { status: 'failed', reason: refusal.message }
    : await sendInviteEmail({ accountId: input.accountId, inviteId: input.inviteId, requestOrigin: input.requestOrigin });
  const { tellInvitee } = await import('@/services/auth/joinInvites');
  await tellInvitee({ email: input.email, accountId: input.accountId, inviteId: input.inviteId });
  return delivery;
}
