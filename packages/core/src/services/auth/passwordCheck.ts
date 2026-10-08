/**
 * A password, checked behind the sign-in lockout. The password step of
 * signing in (`authorizeCredentials` in `libs/Auth.ts`) and every other place
 * that asks a signed-in person for their password again (setting up two-step
 * sign-in) go through `checkPassword`, so guessing costs the same everywhere.
 *
 * Two lockouts, both counted BEFORE the password is compared (`hit` is one
 * atomic upsert, so a parallel burst cannot all pass a check made before any
 * of it was counted) and cleared by the right password:
 *
 * - ten attempts for one email from one address (`signInFailuresPerEmailIp`)
 *   — what a guesser meets, and all a stranger can do to someone else's
 *   sign-in is lock it from the stranger's own address;
 * - fifty for one email from every address together
 *   (`signInFailuresPerAccount`) — the ceiling against guessing spread over
 *   many addresses.
 *
 * A request with no known address is counted under one shared "no address"
 * subject for that email, which is the old per-email lockout of ten. The demo
 * sandbox's shared login is exempt (`libs/identity/demoSandbox.ts`).
 */

import type { RateLimitVerdict } from '@/libs/rateLimit';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { isDemoSharedLogin } from '@/libs/identity/demoSandbox';
import { verifyPassword } from '@/libs/identity/password';
import { clear, firstRefusal, hit, peek, RATE_LIMITS } from '@/libs/rateLimit';
import { userSchema } from '@/models/Schema';

/** A bcrypt hash of a random string nobody kept: compared against when an email has no password. */
const UNMATCHABLE_HASH = '$2b$10$pRkOzEk/o8AbZjs3ZFhEausYA.tBI4KL789lt5j3pbqpPStDXQjGi';

export type PasswordCheck
  = | { ok: true; user: { id: string; email: string; name: string | null; image: string | null } }
    | { ok: false; reason: 'wrong' }
    | { ok: false; reason: 'locked'; retryAfterSeconds: number };

function fromAddress(email: string, ip: string | null): string {
  return `${email}|${ip ?? 'no-address'}`;
}

/**
 * Whether an email is locked out from this address, without counting — the
 * early 429 `/api/auth/[...nextauth]` answers before Auth.js runs. The lockout
 * itself is `checkPassword`.
 * @param email - The email being signed in with.
 * @param ip - The caller's address, when known.
 */
export async function passwordLockout(email: string | null, ip: string | null): Promise<RateLimitVerdict> {
  if (!email || isDemoSharedLogin(email)) {
    return { allowed: true };
  }
  const normalized = email.trim().toLowerCase();
  return firstRefusal(
    await peek(RATE_LIMITS.signInFailuresPerEmailIp, fromAddress(normalized, ip)),
    await peek(RATE_LIMITS.signInFailuresPerAccount, normalized),
  );
}

/**
 * Forget an email's password failures: everywhere, and from one address. A
 * right password does this, and so does a reset (the person just proved they
 * own the mailbox).
 * @param email - The email.
 * @param ip - The address the success came from, when known.
 */
export async function clearPasswordLockout(email: string, ip: string | null): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await clear(RATE_LIMITS.signInFailuresPerEmailIp, fromAddress(normalized, ip));
  await clear(RATE_LIMITS.signInFailuresPerAccount, normalized);
}

/**
 * Check one password attempt for an email, behind the lockout.
 * @param opts - The attempt.
 * @param opts.email - The email typed (any case).
 * @param opts.password - The password typed.
 * @param opts.ip - The caller's address, when known.
 * @param opts.now - The current time; tests pass one.
 */
export async function checkPassword(opts: { email: string; password: string; ip: string | null; now?: Date }): Promise<PasswordCheck> {
  const email = opts.email.trim().toLowerCase();
  const exempt = isDemoSharedLogin(email);
  if (!exempt) {
    // From this address first, so one address hammering an email stops
    // counting toward the everywhere ceiling once it is locked out itself.
    const here = await hit(RATE_LIMITS.signInFailuresPerEmailIp, fromAddress(email, opts.ip), opts.now);
    if (!here.allowed) {
      return { ok: false, reason: 'locked', retryAfterSeconds: here.retryAfterSeconds };
    }
    const everywhere = await hit(RATE_LIMITS.signInFailuresPerAccount, email, opts.now);
    if (!everywhere.allowed) {
      return { ok: false, reason: 'locked', retryAfterSeconds: everywhere.retryAfterSeconds };
    }
  }
  const [user] = await db
    .select({ id: userSchema.id, email: userSchema.email, name: userSchema.name, image: userSchema.image, passwordHash: userSchema.passwordHash })
    .from(userSchema)
    .where(eq(userSchema.email, email))
    .limit(1);
  // An email with no password still pays for one bcrypt compare, so the
  // time to answer does not say whether the email has a login. The attempt
  // was counted above for unknown emails too, so a lockout says nothing
  // about it either.
  const matched = await verifyPassword(opts.password, user?.passwordHash ?? UNMATCHABLE_HASH);
  if (!user?.passwordHash || !matched) {
    return { ok: false, reason: 'wrong' };
  }
  if (!exempt) {
    await clearPasswordLockout(email, opts.ip);
  }
  return { ok: true, user: { id: user.id, email: user.email, name: user.name, image: user.image } };
}
