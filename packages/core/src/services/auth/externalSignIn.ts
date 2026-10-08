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
 * - `accept-invite` — the login is created from the oldest usable invite by
 *   `acceptInviteAsNewUser`, the same function the invite link's form calls,
 *   and every other pending invite to that address is accepted on it through
 *   `acceptInviteAsExistingUser`, which applies that path's own rules. Auth.js
 *   then finds the new login by its address and links the provider to it.
 * - `refuse` — `/sign-in?error=AccessDenied&reason=<why>`; the page has a
 *   sentence for each reason.
 *
 * Auth.js never creates a user itself: `libs/Auth.ts` gives its adapter a
 * `createUser` that throws. The only way a login comes to exist is an invite.
 */

import type { SignInDecision, SignInRefusal } from './signInDecision';
import type { TrustedEmail } from '@/libs/identity/trustedEmail';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { authAccountSchema, inviteSchema, userSchema } from '@/models/Schema';
import { acceptInviteAsExistingUser, acceptInviteAsNewUser } from '@/services/InviteAcceptance';
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
 * Every invite addressed to this email, in any state.
 * @param email - Lowercased.
 */
export async function invitesFor(email: string) {
  return db
    .select({ token: inviteSchema.token, email: inviteSchema.email, acceptedAt: inviteSchema.acceptedAt, expiresAt: inviteSchema.expiresAt })
    .from(inviteSchema)
    .where(sql`lower(${inviteSchema.email}) = ${email}`);
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
  return decideSignIn({ method: attempt.method, identity, linkedUserId: linked, userIdByEmail: byEmail, invites, now });
}

/**
 * Create the login from the first invite and accept the rest on it.
 * @param email - The verified address.
 * @param name - The provider's name for the person, if any.
 * @param tokens - Usable invites, oldest expiry first.
 * @param now - The current time.
 * @returns Whether a login now exists for the address.
 */
async function acceptInvites(email: string, name: string | null, tokens: string[], now: Date): Promise<boolean> {
  const [first, ...rest] = tokens;
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
  for (const token of rest) {
    try {
      const joined = await acceptInviteAsExistingUser(created.userId, token);
      if (!joined.ok) {
        log('info', 'a further invite was left for its link', { status: joined.status, error: joined.error });
      }
    } catch (error) {
      log('warn', 'accepting a further invite at sign-in failed; its link still works', { error: error instanceof Error ? error.message : String(error) });
    }
  }
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
      return (await acceptInvites(decision.email, name, decision.inviteTokens, now)) ? true : refusalUrl('invite-failed', provider);
    }
    case 'refuse':
      log('info', 'sign-in refused', { method: attempt.method, provider, reason: decision.reason });
      return refusalUrl(decision.reason, provider);
  }
}
