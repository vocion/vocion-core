/**
 * Two-step sign-in: a TOTP authenticator plus one-time recovery codes.
 *
 * The lifecycle, and who calls each step:
 *
 *   beginEnrollment    → secret + QR (profile page, or the sign-in gate when
 *                        the account requires it)
 *   confirmEnrollment  → the first code from the app turns it on and returns
 *                        ten recovery codes, shown once
 *   checkSecondFactor  → every sign-in after that (`/api/mfa/verify`), and
 *                        before turning it off or minting new recovery codes
 *   disableMfa / regenerateRecoveryCodes → the profile page
 *   resetSecondFactor  → an account admin for a member who lost both their
 *                        phone and their codes (`resetMemberSecondFactor`),
 *                        or an operator (`npm run local:reset-mfa`)
 *
 * The secret is encrypted with the credential vault under the scope
 * `user:<id>`, so on KMS it is wrapped like every other credential the
 * deployment holds. Recovery codes are 50 random bits each, stored as an
 * HMAC-SHA256 under a key derived from `AUTH_SECRET` and bound to the person:
 * 50 bits are too few for a bare hash to survive an offline guess, and a read
 * of the tables alone must not yield a second factor. Rotating `AUTH_SECRET`
 * therefore voids unused recovery codes (people mint new ones on the profile
 * page, with a code from their app).
 *
 * Turning two-step sign-in on or off, by any route, ends the person's other
 * sessions (`services/auth/sessionVersion.ts`).
 *
 * Requiring it: `VOCION_REQUIRE_MFA=1` for the whole deployment, or
 * `tenant_account.require_mfa` for everyone in one account. A person who must
 * have it and does not is sent to enrol at sign-in, before any workspace
 * (`signInGateFor`, read by the JWT callback in `libs/Auth.ts`).
 */

import type { RateLimitVerdict } from '@/libs/rateLimit';
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes } from 'node:crypto';
import process from 'node:process';
import { and, count, eq, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import QRCode from 'qrcode';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from '@/libs/identity/totp';
import { clear, hit, RATE_LIMITS } from '@/libs/rateLimit';
import {
  accountMembershipSchema,
  tenantAccountSchema,
  userMfaRecoveryCodeSchema,
  userMfaSchema,
  userSchema,
} from '@/models/Schema';
import { AppConfig } from '@/utils/AppConfig';
import { endOtherSessions } from './sessionVersion';

/** How many recovery codes a person gets at a time. */
export const RECOVERY_CODE_COUNT = 10;

/** Where the requirement comes from, or null when nothing requires it. */
export type MfaRequirement = 'deployment' | 'account' | null;

/**
 * What sign-in still owes after the password (or Google): `verify` a code,
 * `enroll` an authenticator first, or nothing.
 */
export type SignInGate = 'verify' | 'enroll' | null;

export type MfaStatus = {
  enabled: boolean;
  enabledAt: Date | null;
  recoveryCodesLeft: number;
  requiredBy: MfaRequirement;
};

export type EnrollmentStart = {
  /** Base32, for typing into an app that cannot scan. */
  secret: string;
  otpauthUri: string;
  /** The QR code as an inline SVG document. */
  qrSvg: string;
};

export type SecondFactorCheck
  = | { ok: true; method: 'totp' | 'recovery' }
    | { ok: false; reason: 'invalid' }
    | { ok: false; reason: 'locked'; retryAfterSeconds: number };

function vaultScope(userId: string): string {
  return `user:${userId}`;
}

/**
 * The key recovery codes are stored under, derived from `AUTH_SECRET` so it
 * needs no new configuration and never sits in the database beside them.
 */
function recoveryCodeKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET must be set to store or check recovery codes');
  }
  return createHmac('sha256', secret).update('vocion:mfa-recovery-code:v1').digest();
}

/**
 * What is stored for one recovery code: an HMAC bound to the person, so the
 * lookup stays an equality match while the table alone cannot be cracked.
 * @param userId - Whose code it is.
 * @param normalized - The code, from `normalizeRecoveryCode`.
 */
function hashCode(userId: string, normalized: string): string {
  return createHmac('sha256', recoveryCodeKey()).update(`${userId}:${normalized}`).digest('hex');
}

/**
 * A recovery code as typed, reduced to the characters it is made of, so
 * `ABCDE-FGHIJ`, `abcde fghij` and `abcdefghij` are the same code.
 * @param typed - What the person typed.
 */
function normalizeRecoveryCode(typed: string): string {
  return typed.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function newRecoveryCode(): string {
  // 10 base32 characters = 50 random bits, shown as two groups of five.
  const chars = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function logFailure(message: string, error: unknown): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger.error(message, { error: error instanceof Error ? error.message : String(error) }))
    .catch(() => {});
}

async function mfaRow(userId: string) {
  const [row] = await db.select().from(userMfaSchema).where(eq(userMfaSchema.userId, userId)).limit(1);
  return row;
}

async function decryptSecret(row: { userId: string; ciphertext: string; nonce: string; authTag: string; dekId: number }): Promise<string> {
  const plain = await buildCredentialVault().decrypt(vaultScope(row.userId), row.ciphertext, row.nonce, row.authTag, row.dekId);
  return plain.toString('utf8');
}

/**
 * Whether this person must sign in with a second factor, and why.
 * @param userId - The person.
 */
export async function mfaRequirementFor(userId: string): Promise<MfaRequirement> {
  if (process.env.VOCION_REQUIRE_MFA === '1') {
    return 'deployment';
  }
  const [row] = await db
    .select({ id: tenantAccountSchema.id })
    .from(accountMembershipSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, accountMembershipSchema.accountId))
    .where(and(eq(accountMembershipSchema.userId, userId), eq(tenantAccountSchema.requireMfa, true)))
    .limit(1);
  return row ? 'account' : null;
}

/**
 * Whether this person has a confirmed authenticator.
 * @param userId - The person.
 */
export async function mfaEnabled(userId: string): Promise<boolean> {
  const row = await mfaRow(userId);
  return Boolean(row?.enabledAt);
}

/**
 * What sign-in still owes for this person once their first factor passed.
 * @param userId - The person who just proved their password (or Google).
 */
export async function signInGateFor(userId: string): Promise<SignInGate> {
  if (await mfaEnabled(userId)) {
    return 'verify';
  }
  return (await mfaRequirementFor(userId)) ? 'enroll' : null;
}

/**
 * The profile page's view of a person's second factor.
 * @param userId - The person.
 */
export async function mfaStatus(userId: string): Promise<MfaStatus> {
  const row = await mfaRow(userId);
  const enabled = Boolean(row?.enabledAt);
  let recoveryCodesLeft = 0;
  if (enabled) {
    const [left] = await db
      .select({ n: count() })
      .from(userMfaRecoveryCodeSchema)
      .where(and(eq(userMfaRecoveryCodeSchema.userId, userId), isNull(userMfaRecoveryCodeSchema.usedAt)));
    recoveryCodesLeft = Number(left?.n ?? 0);
  }
  return { enabled, enabledAt: row?.enabledAt ?? null, recoveryCodesLeft, requiredBy: await mfaRequirementFor(userId) };
}

/**
 * Start (or restart) setting up an authenticator: a fresh secret, stored
 * encrypted and not yet enabled, and the QR code that carries it. Refused once
 * an authenticator is on — replacing one means turning it off first, which
 * takes a code from the current one.
 * @param userId - The person enrolling.
 */
export async function beginEnrollment(userId: string): Promise<EnrollmentStart | { error: 'already-enabled' | 'no-user' }> {
  const [user] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  if (!user) {
    return { error: 'no-user' };
  }
  const existing = await mfaRow(userId);
  if (existing?.enabledAt) {
    return { error: 'already-enabled' };
  }
  const secret = generateTotpSecret();
  const sealed = await buildCredentialVault().encrypt(vaultScope(userId), Buffer.from(secret, 'utf8'));
  const values = {
    dekId: sealed.dekId,
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    authTag: sealed.authTag,
    enabledAt: null,
    lastUsedStep: null,
  };
  await db
    .insert(userMfaSchema)
    .values({ userId, ...values })
    // Only an unconfirmed enrolment is replaced; a confirmed one is left alone
    // even if it was confirmed between the read above and this write.
    .onConflictDoUpdate({ target: userMfaSchema.userId, set: values, setWhere: isNull(userMfaSchema.enabledAt) });
  const uri = otpauthUri({ secret, issuer: AppConfig.name, account: user.email });
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, otpauthUri: uri, qrSvg };
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => newRecoveryCode());
  await db.transaction(async (tx) => {
    await tx.delete(userMfaRecoveryCodeSchema).where(eq(userMfaRecoveryCodeSchema.userId, userId));
    await tx.insert(userMfaRecoveryCodeSchema).values(codes.map(code => ({ userId, codeHash: hashCode(userId, normalizeRecoveryCode(code)) })));
  });
  return codes;
}

/**
 * Finish setting up: the first code from the person's app proves it reads the
 * secret, turns the authenticator on, and mints the recovery codes — the only
 * time they are ever shown. Ends the person's other sessions: one opened
 * without the second factor should not outlive turning it on.
 * @param userId - The person enrolling.
 * @param typed - The code their app shows.
 * @param now - The current time; tests pass one.
 */
export async function confirmEnrollment(
  userId: string,
  typed: string,
  now: Date = new Date(),
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; reason: 'no-enrollment' | 'already-enabled' | 'invalid' }> {
  const row = await mfaRow(userId);
  if (!row) {
    return { ok: false, reason: 'no-enrollment' };
  }
  if (row.enabledAt) {
    return { ok: false, reason: 'already-enabled' };
  }
  const step = matchTotp(await decryptSecret(row), typed, { now });
  if (step === null) {
    return { ok: false, reason: 'invalid' };
  }
  const turnedOn = await db
    .update(userMfaSchema)
    .set({ enabledAt: now, lastUsedStep: step })
    .where(and(eq(userMfaSchema.userId, userId), isNull(userMfaSchema.enabledAt)))
    .returning({ userId: userMfaSchema.userId });
  if (turnedOn.length === 0) {
    return { ok: false, reason: 'already-enabled' };
  }
  const recoveryCodes = await replaceRecoveryCodes(userId);
  await endOtherSessions(userId);
  return { ok: true, recoveryCodes };
}

/**
 * Whether a typed code is this person's second factor right now, spending it
 * if so: a TOTP code moves `last_used_step` past it, a recovery code is marked
 * used. Both are conditional writes, so two requests racing with one code
 * accept it once.
 * @param userId - The person signing in.
 * @param typed - A six-digit code or a recovery code.
 * @param now - The current time; tests pass one.
 */
export async function verifySecondFactor(userId: string, typed: string, now: Date = new Date()): Promise<'totp' | 'recovery' | null> {
  const row = await mfaRow(userId);
  if (!row?.enabledAt) {
    return null;
  }
  const compact = typed.replace(/\s/g, '');
  if (/^\d{6}$/.test(compact)) {
    let secret: string;
    try {
      secret = await decryptSecret(row);
    } catch (error) {
      // The vault key changed under this secret. Recovery codes do not depend
      // on the vault, so they still sign the person in; this says why codes
      // from the app stopped working.
      logFailure('second factor secret could not be decrypted; recovery codes still work', error);
      return null;
    }
    const step = matchTotp(secret, compact, { now, afterStep: row.lastUsedStep });
    if (step === null) {
      return null;
    }
    const spent = await db
      .update(userMfaSchema)
      .set({ lastUsedStep: step })
      .where(and(
        eq(userMfaSchema.userId, userId),
        isNotNull(userMfaSchema.enabledAt),
        or(isNull(userMfaSchema.lastUsedStep), lt(userMfaSchema.lastUsedStep, step)),
      ))
      .returning({ userId: userMfaSchema.userId });
    return spent.length > 0 ? 'totp' : null;
  }
  const normalized = normalizeRecoveryCode(typed);
  if (normalized.length === 0) {
    return null;
  }
  const spent = await db
    .update(userMfaRecoveryCodeSchema)
    .set({ usedAt: now })
    .where(and(
      eq(userMfaRecoveryCodeSchema.userId, userId),
      eq(userMfaRecoveryCodeSchema.codeHash, hashCode(userId, normalized)),
      isNull(userMfaRecoveryCodeSchema.usedAt),
    ))
    .returning({ id: userMfaRecoveryCodeSchema.id });
  return spent.length > 0 ? 'recovery' : null;
}

/**
 * Count one second-factor attempt against the lockout, BEFORE the code is
 * checked: thirty per address and five per person in fifteen minutes. Counting
 * first is what bounds a parallel burst — `hit` is one atomic upsert, so the
 * sixth of twenty simultaneous guesses is refused whatever order they land in.
 * A right code then calls `clearSecondFactorFailures`. Every place that checks
 * a code (sign-in, enrolment, turning it off, new recovery codes) goes through
 * this.
 * @param userId - The person.
 * @param ip - The caller's address, when known.
 * @param now - The current time; tests pass one.
 */
export async function countSecondFactorAttempt(userId: string, ip: string | null, now: Date = new Date()): Promise<RateLimitVerdict> {
  const fromIp = await hit(RATE_LIMITS.secondFactorPerIp, ip, now);
  if (!fromIp.allowed) {
    return fromIp;
  }
  return hit(RATE_LIMITS.secondFactorFailuresPerAccount, userId, now);
}

/**
 * Forget a person's counted second-factor attempts — a right code does this.
 * @param userId - The person.
 */
export async function clearSecondFactorFailures(userId: string): Promise<void> {
  await clear(RATE_LIMITS.secondFactorFailuresPerAccount, userId);
}

/**
 * `verifySecondFactor` behind the lockout (`countSecondFactorAttempt`): five
 * tries for one person in fifteen minutes, from any address and however many
 * arrive at once, and thirty per address. A right code clears the person's
 * count.
 * @param userId - The person.
 * @param typed - What they typed.
 * @param opts - Request context.
 * @param opts.ip - The caller's address, when known.
 * @param opts.now - The current time; tests pass one.
 */
export async function checkSecondFactor(userId: string, typed: string, opts: { ip: string | null; now?: Date }): Promise<SecondFactorCheck> {
  const now = opts.now ?? new Date();
  const counted = await countSecondFactorAttempt(userId, opts.ip, now);
  if (!counted.allowed) {
    return { ok: false, reason: 'locked', retryAfterSeconds: counted.retryAfterSeconds };
  }
  const method = await verifySecondFactor(userId, typed, now);
  if (!method) {
    return { ok: false, reason: 'invalid' };
  }
  await clearSecondFactorFailures(userId);
  return { ok: true, method };
}

/**
 * Delete a person's authenticator and recovery codes and end their other
 * sessions, whatever requires it. A person who must have one enrols again at
 * their next sign-in.
 * @param userId - The person.
 */
async function removeSecondFactor(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userMfaRecoveryCodeSchema).where(eq(userMfaRecoveryCodeSchema.userId, userId));
    await tx.delete(userMfaSchema).where(eq(userMfaSchema.userId, userId));
  });
  await clearSecondFactorFailures(userId);
  await endOtherSessions(userId);
}

/**
 * Turn the authenticator off. The caller has already checked a code; this
 * refuses only when the deployment or an account requires one.
 * @param userId - The person.
 */
export async function disableMfa(userId: string): Promise<{ ok: true } | { ok: false; reason: 'required'; requiredBy: Exclude<MfaRequirement, null> }> {
  const requiredBy = await mfaRequirementFor(userId);
  if (requiredBy) {
    return { ok: false, reason: 'required', requiredBy };
  }
  await removeSecondFactor(userId);
  return { ok: true };
}

/**
 * The way back in for a person who lost both their authenticator and their
 * recovery codes: remove their second factor without a code and whatever
 * requires it. If an account or the deployment requires one, they set up a
 * new authenticator at their next sign-in, before any workspace. Used by the
 * operator script; an account admin goes through `resetMemberSecondFactor`.
 * @param userId - The person.
 * @returns Whether they had one to remove.
 */
export async function resetSecondFactor(userId: string): Promise<boolean> {
  const had = Boolean(await mfaRow(userId));
  await removeSecondFactor(userId);
  return had;
}

export type MemberResetRefusal = 'self' | 'not-a-member' | 'other-accounts';

/**
 * An account admin resets the second factor of a member of their own account
 * (`resetSecondFactor`). Refused for the admin themself (the profile page
 * turns it off, with a code), for anyone outside the account, and for a person
 * who also belongs to another account: two-step sign-in is the person's, not
 * one account's, so removing it would also weaken their sign-in to a client
 * company this admin does not run. An operator resets that person
 * (`npm run local:reset-mfa`).
 * @param opts - The reset.
 * @param opts.accountId - The admin's account.
 * @param opts.actorUserId - The admin.
 * @param opts.targetUserId - The member.
 */
export async function resetMemberSecondFactor(opts: {
  accountId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<{ ok: true; hadSecondFactor: boolean } | { ok: false; reason: MemberResetRefusal }> {
  if (opts.actorUserId === opts.targetUserId) {
    return { ok: false, reason: 'self' };
  }
  const [member] = await db
    .select({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, opts.accountId), eq(accountMembershipSchema.userId, opts.targetUserId)))
    .limit(1);
  if (!member) {
    return { ok: false, reason: 'not-a-member' };
  }
  const [elsewhere] = await db
    .select({ accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.userId, opts.targetUserId), ne(accountMembershipSchema.accountId, opts.accountId)))
    .limit(1);
  if (elsewhere) {
    return { ok: false, reason: 'other-accounts' };
  }
  return { ok: true, hadSecondFactor: await resetSecondFactor(opts.targetUserId) };
}

/**
 * Throw away every recovery code and mint ten new ones. The caller has
 * already checked a code.
 * @param userId - The person.
 */
export async function regenerateRecoveryCodes(userId: string): Promise<string[] | null> {
  if (!(await mfaEnabled(userId))) {
    return null;
  }
  return replaceRecoveryCodes(userId);
}

/**
 * Require (or stop requiring) a second factor for everyone in one account.
 * The caller has checked that the person is an admin of that account.
 * @param accountId - The account.
 * @param required - On or off.
 */
export async function setAccountMfaRequirement(accountId: string, required: boolean): Promise<void> {
  await db.update(tenantAccountSchema).set({ requireMfa: required }).where(eq(tenantAccountSchema.id, accountId));
}

/**
 * Whether one account requires a second factor of its members.
 * @param accountId - The account.
 */
export async function accountRequiresMfa(accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ requireMfa: tenantAccountSchema.requireMfa })
    .from(tenantAccountSchema)
    .where(eq(tenantAccountSchema.id, accountId))
    .limit(1);
  return Boolean(row?.requireMfa);
}
