/**
 * Every rate limit the app enforces, in one list, so "how many tries does a
 * person get" has one answer to read and one place to change.
 *
 * A policy counts one kind of attempt against one subject (an IP, an email, a
 * user, an API caller) in a fixed window. `shared` picks the store: limits
 * that guard a secret (a password, a second factor, an invite, a reset link)
 * count in Postgres, so every instance agrees and a lockout outlives a
 * restart; throughput limits on chat and the API count in process memory,
 * where "N per minute per container" is the intent.
 *
 * Two shapes use these:
 *
 * - a **limit** counts every attempt and refuses once the count passes
 *   `limit` (`hit`);
 * - a **lockout** counts only failures, is checked before the attempt
 *   (`peek`), and is cleared by a success (`clear`). Ten wrong passwords for
 *   one email lock that email for the rest of the window, from any IP.
 *
 * The per-IP numbers are generous on purpose: a whole office can sit behind
 * one address, and the per-account lockouts are what stop guessing.
 */

export type RateLimitPolicy = {
  /** Stable name; the first half of every counter key. Never reuse one. */
  name: string;
  /** Attempts allowed in one window. */
  limit: number;
  windowSeconds: number;
  /** Count in Postgres (true) or in this process (false). */
  shared: boolean;
};

const MINUTE = 60;
const QUARTER_HOUR = 15 * MINUTE;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  /** Password sign-in attempts from one address. */
  signInPerIp: { name: 'sign-in:ip', limit: 100, windowSeconds: QUARTER_HOUR, shared: true },
  /** Lockout: wrong passwords for one email. */
  signInFailuresPerAccount: { name: 'sign-in:failures', limit: 10, windowSeconds: QUARTER_HOUR, shared: true },
  /** Second-factor attempts from one address. */
  secondFactorPerIp: { name: 'mfa:ip', limit: 30, windowSeconds: QUARTER_HOUR, shared: true },
  /** Lockout: wrong second-factor codes for one person. A code is six digits, so this is the brute-force wall. */
  secondFactorFailuresPerAccount: { name: 'mfa:failures', limit: 5, windowSeconds: QUARTER_HOUR, shared: true },
  /** Accounts created (invites accepted by a new user) from one address. */
  signUpPerIp: { name: 'sign-up:ip', limit: 10, windowSeconds: HOUR, shared: true },
  /** Invites accepted on an existing login, per address and per person. */
  inviteAcceptPerIp: { name: 'invite-accept:ip', limit: 20, windowSeconds: HOUR, shared: true },
  inviteAcceptPerUser: { name: 'invite-accept:user', limit: 10, windowSeconds: HOUR, shared: true },
  /** Forgot-password requests, per address and per email asked about. */
  passwordResetRequestPerIp: { name: 'password-reset:ip', limit: 10, windowSeconds: HOUR, shared: true },
  passwordResetRequestPerEmail: { name: 'password-reset:email', limit: 3, windowSeconds: HOUR, shared: true },
  /** Reset links redeemed (or guessed) from one address. */
  passwordResetConfirmPerIp: { name: 'password-reset-confirm:ip', limit: 20, windowSeconds: HOUR, shared: true },
  /** Chat turns and attachment uploads, per person and per address. */
  chatPerUser: { name: 'chat:user', limit: 30, windowSeconds: MINUTE, shared: false },
  chatPerIp: { name: 'chat:ip', limit: 120, windowSeconds: MINUTE, shared: false },
  /** `/api/v1` calls, per caller (a token or a signed-in person) and per address. */
  apiPerCaller: { name: 'api:caller', limit: 1200, windowSeconds: MINUTE, shared: false },
  apiPerIp: { name: 'api:ip', limit: 2400, windowSeconds: MINUTE, shared: false },
  /**
   * Bad bearer tokens from one address — the API's lockout. In memory: a token
   * carries far too much entropy to guess, so this only stops a script from
   * hammering, which a per-container count does as well.
   */
  apiAuthFailuresPerIp: { name: 'api-auth-failures:ip', limit: 30, windowSeconds: QUARTER_HOUR, shared: false },
} as const satisfies Record<string, RateLimitPolicy>;
