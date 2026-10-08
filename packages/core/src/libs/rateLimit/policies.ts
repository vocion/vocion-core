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
 * - a **lockout** counts every attempt BEFORE the secret is checked (`hit`,
 *   one atomic upsert, so a parallel burst cannot slip past it) and is cleared
 *   by a success (`clear`), so what it ends up holding is the failures. Ten
 *   wrong passwords for one email from one address lock that email from that
 *   address; fifty from everywhere together lock it everywhere. `peek` is only
 *   the cheap early refusal at the edge.
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
  /**
   * Lockout: password attempts for one email from one address. The one a
   * guesser meets, and the most a stranger can do to someone else's sign-in:
   * it locks the email from the stranger's own address only.
   */
  signInFailuresPerEmailIp: { name: 'sign-in:failures:email-ip', limit: 10, windowSeconds: QUARTER_HOUR, shared: true },
  /**
   * Lockout ceiling: password attempts for one email from every address
   * together — the wall against guessing spread over many addresses, set high
   * enough that keeping a known person out takes at least five of them.
   */
  signInFailuresPerAccount: { name: 'sign-in:failures', limit: 50, windowSeconds: QUARTER_HOUR, shared: true },
  /** Second-factor attempts from one address. */
  secondFactorPerIp: { name: 'mfa:ip', limit: 30, windowSeconds: QUARTER_HOUR, shared: true },
  /**
   * Lockout: second-factor attempts for one person, counted before the code is
   * checked and cleared by a right one. A code is six digits, so this is the
   * brute-force wall: five tries a window, whatever the concurrency.
   */
  secondFactorFailuresPerAccount: { name: 'mfa:failures', limit: 5, windowSeconds: QUARTER_HOUR, shared: true },
  /** Accounts created (invites accepted by a new user) from one address. */
  signUpPerIp: { name: 'sign-up:ip', limit: 10, windowSeconds: HOUR, shared: true },
  /**
   * Invite emails an admin sends (new invites and resends), per admin. Bounds
   * how much mail one admin account can make this server send.
   */
  inviteEmailPerUser: { name: 'invite-email:user', limit: 50, windowSeconds: HOUR, shared: true },
  /** Invites accepted on an existing login, per address and per person. */
  inviteAcceptPerIp: { name: 'invite-accept:ip', limit: 20, windowSeconds: HOUR, shared: true },
  inviteAcceptPerUser: { name: 'invite-accept:user', limit: 10, windowSeconds: HOUR, shared: true },
  /** Forgot-password requests, per address and per email asked about. */
  passwordResetRequestPerIp: { name: 'password-reset:ip', limit: 10, windowSeconds: HOUR, shared: true },
  passwordResetRequestPerEmail: { name: 'password-reset:email', limit: 3, windowSeconds: HOUR, shared: true },
  /**
   * "Email me a sign-in link" requests, per address and per email asked
   * about — counted for every email alike, so the limit says nothing about
   * which ones have a login.
   */
  emailLinkPerIp: { name: 'email-link:ip', limit: 10, windowSeconds: QUARTER_HOUR, shared: true },
  emailLinkPerEmail: { name: 'email-link:email', limit: 3, windowSeconds: QUARTER_HOUR, shared: true },
  /** Reset links redeemed (or guessed) from one address. */
  passwordResetConfirmPerIp: { name: 'password-reset-confirm:ip', limit: 20, windowSeconds: HOUR, shared: true },
  /** Chat turns and attachment uploads, per person and per address. */
  chatPerUser: { name: 'chat:user', limit: 30, windowSeconds: MINUTE, shared: false },
  chatPerIp: { name: 'chat:ip', limit: 120, windowSeconds: MINUTE, shared: false },
  /** `/api/v1` calls, per caller (a token or a signed-in person) and per address. */
  apiPerCaller: { name: 'api:caller', limit: 1200, windowSeconds: MINUTE, shared: false },
  apiPerIp: { name: 'api:ip', limit: 2400, windowSeconds: MINUTE, shared: false },
  /**
   * Bad bearer tokens from one address. Counted only when a token fails and
   * never consulted before one is checked: on Cloud many tenants' automations
   * share an egress address, and one tenant's integration retrying a revoked
   * token must not refuse another tenant's valid one. In memory: a token
   * carries far too much entropy to guess, so this only slows a script that
   * keeps presenting bad ones.
   */
  apiAuthFailuresPerIp: { name: 'api-auth-failures:ip', limit: 30, windowSeconds: QUARTER_HOUR, shared: false },
} as const satisfies Record<string, RateLimitPolicy>;
