/**
 * The invite-only gate for Google, Microsoft and email-link sign-in: gather
 * the facts `decideSignIn` needs, carry out its decision, and answer Auth.js's
 * `signIn` callback with `true` or the sign-in page URL that says why not.
 *
 * Carrying out the decision:
 *
 * - `sign-in` / `link` — nothing to do here. Auth.js signs the linked person
 *   in, or links the provider account to the login with the verified address
 *   (`allowDangerousEmailAccountLinking`, safe because the provider's
 *   `profile` only ever returns a verified address — `libs/identity/signInProviders.ts`).
 *   Linking tells the person ("Google added to your sign-in methods",
 *   `signInMethodLinked`), and any invite still open for their address is
 *   joined once sign-in completes (`joinPendingInvites`, from `libs/Auth.ts`).
 * - `accept-invite` — the login is created from the first joinable invite by
 *   `acceptInviteAsNewUser`, the same function the invite link's form calls;
 *   the rest are joined on it as sign-in completes, by the same
 *   `joinPendingInvites` every sign-in runs. Auth.js then finds the new login
 *   by its address and links the provider to it.
 * - `auto-join` — the login is created as a member of the install's Org
 *   (`joinByDomain`, `services/auth/autoJoin.ts`), only where the operator
 *   listed the address's domain.
 * - `refuse` — `/sign-in?error=AccessDenied&reason=<why>`; the page has a
 *   sentence for each reason.
 *
 * Auth.js never creates a user itself: `libs/Auth.ts` gives its adapter a
 * `createUser` that throws. A login comes to exist only through an invite, or
 * a domain an operator listed.
 */

import type { OrgFacts, SignInDecision, SignInRefusal } from './signInDecision';
import type { TrustedEmail } from '@/libs/identity/trustedEmail';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { authAccountSchema, userSchema } from '@/models/Schema';
import { acceptInviteAsNewUser } from '@/services/InviteAcceptance';
import { orgsMode } from '@/services/OrgPolicy';
import { autoJoinPolicy, joinByDomain } from './autoJoin';
import { invitesFor, orgName, orgsOf, tellJoined } from './joinInvites';
import { decideSignIn } from './signInDecision';

/** One sign-in attempt, as Auth.js's `signIn` callback sees it. */
export type SignInAttempt
  = | {
    method: 'oauth';
    /** Auth.js's provider id (`google`, `microsoft-entra-id`, …). */
    provider: string;
    /** The person's stable id at the provider (`sub`). */
    providerAccountId: string;
    identity: TrustedEmail;
    /** The name the provider gave, for a login made from an invite. */
    name: string | null;
  }
  | {
    method: 'email-link';
    /** The address the link was mailed to; the click proves it. */
    email: string;
  };

function log(level: 'info' | 'warn' | 'error', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/**
 * Where a refused sign-in lands: the sign-in page, which reads `reason`.
 * @param reason - Why.
 * @param provider - Which provider refused, for the sentence ("Google didn't…").
 */
export function refusalUrl(reason: SignInRefusal | 'invite-failed', provider?: string): string {
  const params = new URLSearchParams({ error: 'AccessDenied', reason });
  if (provider) {
    params.set('provider', provider);
  }
  return `/sign-in?${params.toString()}`;
}

/**
 * The login with this email, if any.
 * @param email - Lowercased.
 */
export async function userIdByEmail(email: string): Promise<string | null> {
  const [user] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email)).limit(1);
  return user?.id ?? null;
}

/**
 * The login a provider account is linked to, if any.
 * @param provider - Auth.js's provider id.
 * @param providerAccountId - The person's id at the provider.
 */
async function linkedUserId(provider: string, providerAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: authAccountSchema.userId })
    .from(authAccountSchema)
    .where(and(eq(authAccountSchema.provider, provider), eq(authAccountSchema.providerAccountId, providerAccountId)))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * The Org rules a sign-in is decided under. The auto-join policy is read only
 * for an address with no login, the one case it can decide.
 * @param userId - The login the address has, if any.
 */
async function orgFacts(userId: string | null): Promise<OrgFacts> {
  return {
    mode: orgsMode(),
    memberOf: userId ? await orgsOf(userId) : [],
    autoJoin: userId ? null : await autoJoinPolicy(),
  };
}

/**
 * The decision for one attempt, from the database's facts. Exported for tests.
 * @param attempt - What Auth.js handed the callback.
 * @param now - The current time; tests pass one.
 */
export async function decide(attempt: SignInAttempt, now: Date = new Date()): Promise<SignInDecision> {
  const identity: TrustedEmail = attempt.method === 'oauth'
    ? attempt.identity
    : { ok: true, email: attempt.email.trim().toLowerCase() };
  const email = identity.ok ? identity.email : null;
  const [linked, byEmail, invites] = await Promise.all([
    attempt.method === 'oauth' ? linkedUserId(attempt.provider, attempt.providerAccountId) : null,
    email ? userIdByEmail(email) : null,
    email ? invitesFor(email) : [],
  ]);
  const orgs = await orgFacts(linked ?? byEmail);
  return decideSignIn({ method: attempt.method, identity, linkedUserId: linked, userIdByEmail: byEmail, invites, orgs, now });
}

/**
 * Create the login from the first joinable invite. The rest are joined on it
 * as this same sign-in completes (`joinPendingInvites`), under the one rule
 * every sign-in follows.
 * @param email - The verified address.
 * @param name - The provider's name for the person, if any.
 * @param tokens - Joinable invites, oldest expiry first.
 * @param now - The current time.
 * @returns Whether a login now exists for the address.
 */
async function acceptFirstInvite(email: string, name: string | null, tokens: string[], now: Date): Promise<boolean> {
  const [first] = tokens;
  if (!first) {
    return false;
  }
  const created = await acceptInviteAsNewUser({ inviteToken: first, email, name, passwordHash: null }, now);
  if (!created.ok) {
    // A parallel sign-in made the login first: that is a login to link to.
    if (created.code === 'EXISTING_USER') {
      return true;
    }
    log('warn', 'invite could not be accepted at sign-in', { status: created.status, error: created.error });
    return false;
  }
  await tellJoined(created.userId, [{ accountId: created.accountId, name: await orgName(created.accountId) }]);
  return true;
}

/**
 * Auth.js's answer for one Google, Microsoft or email-link sign-in: `true` to
 * go on, or the sign-in page URL that says why not.
 * @param attempt - What Auth.js handed the callback.
 * @param now - The current time; tests pass one.
 */
export async function admitSignIn(attempt: SignInAttempt, now: Date = new Date()): Promise<true | string> {
  const provider = attempt.method === 'oauth' ? attempt.provider : undefined;
  const decision = await decide(attempt, now);
  switch (decision.kind) {
    case 'sign-in':
    case 'link':
      return true;
    case 'accept-invite': {
      const name = attempt.method === 'oauth' ? attempt.name : null;
      return (await acceptFirstInvite(decision.email, name, decision.inviteTokens, now)) ? true : refusalUrl('invite-failed', provider);
    }
    case 'auto-join': {
      const name = attempt.method === 'oauth' ? attempt.name : null;
      const joined = await joinByDomain({ email: decision.email, name, accountId: decision.accountId, domain: decision.domain });
      if (joined.ok) {
        await tellJoined(joined.userId, [{ accountId: joined.accountId, name: await orgName(joined.accountId) }]);
        return true;
      }
      // A parallel sign-in made the login first: that is a login to link to.
      return joined.reason === 'exists' ? true : refusalUrl('no-invite', provider);
    }
    case 'refuse':
      log('info', 'sign-in refused', { method: attempt.method, provider, reason: decision.reason });
      return refusalUrl(decision.reason, provider);
  }
}
