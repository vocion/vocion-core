/**
 * Who a Google, Microsoft or email-link sign-in is, and whether to let them
 * in. The deployment is invite-only, and these ways in keep it that way: they
 * are new ways to prove who you are, never a way to become someone.
 *
 * In order:
 *
 * 1. **Already linked** — the provider account was linked to a login before.
 *    That person signs in. The link was made on a verified address; the
 *    provider's subject id, not today's email claim, is the identity now.
 * 2. **No address the provider vouches for** — refused. An unverified address
 *    is exactly what someone taking over another person's login would bring.
 * 3. **A login with that address** — the provider is linked to it (OAuth) or
 *    the person signs in (an email link, which proves the mailbox).
 * 4. **A pending, unexpired invite to that address** — the invite is accepted
 *    the way the invite link's form accepts it, which creates the login and
 *    the membership (`acceptInviteAsNewUser`).
 * 5. **Anything else** — refused: no invite for this address.
 *
 * Nothing here creates a user except step 4, and step 4 needs an invite.
 *
 * Pure: the facts come in, the decision goes out. `services/auth/externalSignIn.ts`
 * gathers the facts and carries the decision out.
 */

import type { TrustedEmail, TrustedEmailRefusal } from '@/libs/identity/trustedEmail';
import { inviteProblem } from '@/services/inviteRules';

/** An invite row addressed to the email, as the rules read it. */
export type InviteFact = {
  token: string;
  email: string;
  acceptedAt: Date | null;
  expiresAt: Date;
};

export type SignInFacts = {
  /** `oauth` for Google, Microsoft and registered providers; `email-link` for a mailed link. */
  method: 'oauth' | 'email-link';
  /** The address the provider vouches for. An email link's address is proven by the click. */
  identity: TrustedEmail;
  /** The login this provider account is already linked to, if any (OAuth only). */
  linkedUserId: string | null;
  /** The login whose email is the vouched-for address, if any. */
  userIdByEmail: string | null;
  /** Invites addressed to that email, in any state; the rules pick the usable ones. */
  invites: InviteFact[];
  now: Date;
};

/** Why a sign-in was refused. Each has its own sentence on the sign-in page. */
export type SignInRefusal = TrustedEmailRefusal | 'no-invite';

export type SignInDecision
  /** Sign this login in, as it is. */
  = | { kind: 'sign-in'; userId: string }
  /** Link the provider account to this login, then sign it in. */
    | { kind: 'link'; userId: string }
  /** Create the login by accepting these invites (oldest first), then sign it in. */
    | { kind: 'accept-invite'; email: string; inviteTokens: string[] }
    | { kind: 'refuse'; reason: SignInRefusal };

/**
 * The decision for one sign-in. See the module docstring for the order.
 * @param facts - What the provider said and what the database holds.
 */
export function decideSignIn(facts: SignInFacts): SignInDecision {
  if (facts.method === 'oauth' && facts.linkedUserId) {
    return { kind: 'sign-in', userId: facts.linkedUserId };
  }
  if (!facts.identity.ok) {
    return { kind: 'refuse', reason: facts.identity.reason };
  }
  const { email } = facts.identity;
  if (facts.userIdByEmail) {
    return facts.method === 'oauth'
      ? { kind: 'link', userId: facts.userIdByEmail }
      : { kind: 'sign-in', userId: facts.userIdByEmail };
  }
  const usable = usableInvites(facts.invites, email, facts.now);
  if (usable.length > 0) {
    return { kind: 'accept-invite', email, inviteTokens: usable.map(i => i.token) };
  }
  return { kind: 'refuse', reason: 'no-invite' };
}

/**
 * The invites `email` could accept right now — the same rule the invite
 * link's form applies (`inviteProblem`): unaccepted, unexpired, addressed to
 * exactly this email — oldest expiry first, so the order is stable.
 * @param invites - Candidate invites.
 * @param email - The vouched-for address.
 * @param now - The current time.
 */
export function usableInvites(invites: readonly InviteFact[], email: string, now: Date): InviteFact[] {
  return invites
    .filter(invite => inviteProblem(invite, email, now) === null)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

/**
 * Whether a link may be emailed to this address at all: it has a login or a
 * usable invite. The answer is never shown to whoever asked — the page says
 * the same thing either way.
 * @param facts - The login and invites for the address.
 * @param facts.email - The address.
 * @param facts.userIdByEmail - Its login, if any.
 * @param facts.invites - Invites addressed to it.
 * @param facts.now - The current time.
 */
export function mayEmailSignInLink(facts: { email: string; userIdByEmail: string | null; invites: InviteFact[]; now: Date }): boolean {
  return Boolean(facts.userIdByEmail) || usableInvites(facts.invites, facts.email, facts.now).length > 0;
}
