/**
 * The rule for whether an invite can be accepted, with no database or
 * framework imports so both acceptance paths — a new user (`/api/signup`) and
 * an existing login joining another account (`services/InviteAcceptance.ts`)
 * — can share it.
 */

/** The invite columns the acceptance rules read. */
type InviteForCheck = { email: string; acceptedAt: Date | null; expiresAt: Date };

/** Why an invite cannot be accepted, as the HTTP answer to give. */
export type InviteProblem = { status: 403 | 404 | 410; error: string };

/**
 * Why this invite cannot be accepted by `email` right now, or null when it
 * can. Shared by the new-user path and the existing-login path, so both
 * refuse the same invites in the same words.
 * @param invite - The invite row, or undefined when the token matched none.
 * @param email - The email of the person accepting.
 * @param now - The current time.
 */
export function inviteProblem(invite: InviteForCheck | undefined, email: string, now: Date): InviteProblem | null {
  if (!invite) {
    return { status: 404, error: 'Invalid invite token.' };
  }
  if (invite.acceptedAt) {
    return { status: 410, error: 'This invite has already been used.' };
  }
  if (invite.expiresAt < now) {
    return { status: 410, error: 'This invite has expired.' };
  }
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    return { status: 403, error: 'This invite was issued for a different email.' };
  }
  return null;
}
