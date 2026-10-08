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
 *    the person signs in (an email link, which proves the mailbox). Invites
 *    still open for that address are joined once sign-in completes
 *    ({@link invitesToJoin}, carried out by `services/auth/joinInvites.ts`).
 * 4. **Pending, unexpired invites to that address** — accepted the way the
 *    invite link's form accepts one, which creates the login and the
 *    membership (`acceptInviteAsNewUser`); the rest are joined on that login.
 *    Every Org that asked is joined on a multi-Org server; a single-Org
 *    server joins the one Org it allows.
 * 5. **An address in an auto-join domain** — only where the operator listed
 *    the domain (`VOCION_AUTO_JOIN_DOMAINS`) on a single-Org install: a login
 *    is made and joins the install's Org as a member
 *    (`services/auth/autoJoin.ts`).
 * 6. **Anything else** — refused: no invite for this address.
 *
 * Nothing here creates a user except steps 4 and 5, and each needs a verified
 * address that an admin (an invite) or the operator (a domain) asked in.
 *
 * Pure: the facts come in, the decision goes out. `services/auth/externalSignIn.ts`
 * gathers the facts and carries the decision out. {@link invitesToJoin} is the
 * one rule for which invites a person joins, read here and by the join that
 * runs at the end of every sign-in, password included.
 */

import type { TrustedEmail, TrustedEmailRefusal } from '@/libs/identity/trustedEmail';
import { inviteProblem } from '@/services/inviteRules';

/** An invite row addressed to the email, as the rules read it. */
export type InviteFact = {
  token: string;
  /** The Org (`tenant_account.id`) the invite asks the person into. */
  accountId: string;
  email: string;
  acceptedAt: Date | null;
  expiresAt: Date;
};

/**
 * Where an address may join without an invite: the install's one Org, for
 * the domains its operator listed. Null when the install has no such
 * setting, or it does not apply (a multi-Org server). Read by
 * `services/auth/autoJoin.ts`.
 */
export type AutoJoinPolicy = {
  /** Lowercased domains, no `@`. */
  domains: readonly string[];
  /** The Org a matching address joins. */
  accountId: string;
};

/** The Org rules a sign-in is decided under. */
export type OrgFacts = {
  /** `single` unless an extension lifts the single-Org rule (`services/OrgPolicy.ts`). */
  mode: 'single' | 'multi';
  /** The Orgs this login is already in, oldest membership first. Empty for someone with no login. */
  memberOf: readonly string[];
  /** Who may join without an invite, or null. */
  autoJoin: AutoJoinPolicy | null;
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
  orgs: OrgFacts;
  now: Date;
};

/** Why a sign-in was refused. Each has its own sentence on the sign-in page. */
export type SignInRefusal = TrustedEmailRefusal | 'no-invite';

export type SignInDecision
  /** Sign this login in, as it is. */
  = | { kind: 'sign-in'; userId: string }
  /** Link the provider account to this login, then sign it in. */
    | { kind: 'link'; userId: string }
  /** Create the login by accepting the first invite, join the rest on it, then sign it in. */
    | { kind: 'accept-invite'; email: string; inviteTokens: string[] }
  /** Create the login as a member of the install's Org (an auto-join domain), then sign it in. */
    | { kind: 'auto-join'; email: string; accountId: string; domain: string }
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
  const joinable = invitesToJoin(facts.invites, email, facts.now, facts.orgs);
  if (joinable.length > 0) {
    return { kind: 'accept-invite', email, inviteTokens: joinable.map(i => i.token) };
  }
  const domain = autoJoinDomain(email, facts.orgs);
  if (domain && facts.orgs.autoJoin) {
    return { kind: 'auto-join', email, accountId: facts.orgs.autoJoin.accountId, domain };
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
 * The invites a person with this address joins, in order: the usable ones
 * ({@link usableInvites}), one per Org, none to an Org they are already in.
 *
 * - **Multi-Org** — every Org that asked.
 * - **Single-Org** — the one Org this install allows the person: the Org
 *   they are already in, or, for someone in none, the Org of the invite
 *   that expires first. An invite to any other Org is left alone (its link
 *   says why, through `secondOrgProblem`).
 *
 * The one rule for joining: the first sign-in of someone new
 * ({@link decideSignIn}) and the join at the end of every sign-in
 * (`services/auth/joinInvites.ts`) both read it.
 * @param invites - Invites addressed to the email, in any state.
 * @param email - The address, verified or the login's own.
 * @param now - The current time.
 * @param orgs - The Org rules.
 */
export function invitesToJoin(invites: readonly InviteFact[], email: string, now: Date, orgs: Pick<OrgFacts, 'mode' | 'memberOf'>): InviteFact[] {
  const member = new Set(orgs.memberOf);
  const usable = usableInvites(invites, email, now);
  const allowedOrg = orgs.mode === 'single' ? (orgs.memberOf[0] ?? usable[0]?.accountId ?? null) : null;
  const seen = new Set<string>();
  const out: InviteFact[] = [];
  for (const invite of usable) {
    if (member.has(invite.accountId) || seen.has(invite.accountId)) {
      continue;
    }
    if (allowedOrg !== null && invite.accountId !== allowedOrg) {
      continue;
    }
    seen.add(invite.accountId);
    out.push(invite);
  }
  return out;
}

/**
 * The listed domain `email` is in, when the install lets that domain join
 * without an invite; null otherwise. Only ever on a single-Org install, and
 * only for an address with no login (a login joins nothing this way).
 *
 * Exact domains: `northwind.example` takes `ana@northwind.example`, not
 * `ana@mail.northwind.example` and not `ana@evilnorthwind.example`.
 * @param email - The verified address.
 * @param orgs - The Org rules.
 */
export function autoJoinDomain(email: string, orgs: Pick<OrgFacts, 'mode' | 'autoJoin'>): string | null {
  if (orgs.mode !== 'single' || !orgs.autoJoin) {
    return null;
  }
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return null;
  }
  const domain = email.slice(at + 1).toLowerCase();
  return orgs.autoJoin.domains.includes(domain) ? domain : null;
}

/**
 * Whether a link may be emailed to this address at all: it has a login, a
 * usable invite, or an auto-join domain. The answer is never shown to whoever
 * asked — the page says the same thing either way.
 * @param facts - The login and invites for the address.
 * @param facts.email - The address.
 * @param facts.userIdByEmail - Its login, if any.
 * @param facts.invites - Invites addressed to it.
 * @param facts.orgs - The Org rules, for the auto-join domains.
 * @param facts.now - The current time.
 */
export function mayEmailSignInLink(facts: { email: string; userIdByEmail: string | null; invites: InviteFact[]; orgs: OrgFacts; now: Date }): boolean {
  return Boolean(facts.userIdByEmail)
    || invitesToJoin(facts.invites, facts.email, facts.now, facts.orgs).length > 0
    || autoJoinDomain(facts.email, facts.orgs) !== null;
}
