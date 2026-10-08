/**
 * Sign in with Google, without opening sign-up.
 *
 * The deployment stays invite-only: Google is a second way to prove who you
 * are, never a way in for someone nobody invited. So a Google sign-in is let
 * through only when Google vouches for the email (`email_verified`) and that
 * email already has a login here or is named on a pending invite.
 *
 * - **An existing login** is linked by that verified email (Auth.js
 *   `allowDangerousEmailAccountLinking`, made safe by the verified check
 *   below): one person stays one user, with a password and Google both.
 * - **A pending invite** makes the user on first sign-in. While that person
 *   belongs to no account at all, every Google sign-in accepts the pending
 *   invites addressed to their email through the same path a signed-in
 *   person's "Join" takes (`acceptInviteAsExistingUser`), so the memberships
 *   and the personal workspace land exactly as they would by the invite link.
 *   "While unplaced" rather than "on the first sign-in only": a failure on the
 *   first sign-in is retried on the next one instead of leaving a login with
 *   nowhere to go. Once the person is in an account, a further invite is
 *   theirs to take or leave on the Join card its link opens — Google never
 *   joins someone who already has a way in to another company.
 *
 * Enabled by setting `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` (a Google OAuth
 * client whose redirect URI is `<app>/api/auth/callback/google`). Unset, the
 * provider is not registered and the button does not render.
 */

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, inviteSchema, userSchema } from '@/models/Schema';
import { acceptInviteAsExistingUser } from '@/services/InviteAcceptance';

/** The parts of Google's OpenID profile the gate reads. */
export type GoogleProfileClaims = {
  email?: string | null;
  email_verified?: boolean | null;
};

async function pendingInvitesFor(email: string, now: Date) {
  return db
    .select({ token: inviteSchema.token })
    .from(inviteSchema)
    .where(and(
      sql`lower(${inviteSchema.email}) = ${email}`,
      isNull(inviteSchema.acceptedAt),
      gt(inviteSchema.expiresAt, now),
    ));
}

/**
 * Whether a Google sign-in may proceed: a verified email that has a login
 * here or a pending invite.
 * @param profile - Google's profile claims.
 * @param now - The current time; tests pass one.
 */
export async function googleSignInAllowed(profile: GoogleProfileClaims | null | undefined, now: Date = new Date()): Promise<boolean> {
  const email = profile?.email?.trim().toLowerCase();
  if (!email || profile?.email_verified !== true) {
    return false;
  }
  const [user] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email)).limit(1);
  if (user) {
    return true;
  }
  return (await pendingInvitesFor(email, now)).length > 0;
}

/**
 * On a Google sign-in, accept the pending invites addressed to a person who
 * belongs to no account yet. Each goes through `acceptInviteAsExistingUser`,
 * which re-checks the invite and adds the membership; one that went stale in
 * between is skipped, and one that throws does not stop the others. A person
 * already in an account is left alone.
 * @param userId - The person Google signed in.
 * @param email - Their verified email.
 * @param now - The current time; tests pass one.
 * @returns How many invites were accepted.
 */
export async function acceptPendingInvitesIfUnplaced(userId: string, email: string, now: Date = new Date()): Promise<number> {
  const [placed] = await db
    .select({ accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .limit(1);
  if (placed) {
    return 0;
  }
  let accepted = 0;
  let failure: unknown = null;
  for (const invite of await pendingInvitesFor(email.trim().toLowerCase(), now)) {
    try {
      const result = await acceptInviteAsExistingUser(userId, invite.token);
      if (result.ok) {
        accepted += 1;
      }
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure && accepted === 0) {
    // Nothing landed, so the caller logs it and the next sign-in retries.
    throw failure;
  }
  return accepted;
}
