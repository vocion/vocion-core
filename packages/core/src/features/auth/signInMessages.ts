/**
 * The sentence the sign-in page shows for what came back in its URL: an
 * Auth.js `error` (and `code`, for a refused password), and for a refused
 * Google, Microsoft or email-link sign-in the `reason` the invite-only gate
 * gave (`services/auth/externalSignIn.ts`). Every one says what happened and
 * what to do next.
 *
 * Pure: it answers with a message key in the `SignIn` namespace and its
 * values, and the page translates it (`en.json`, `fr.json`), so the rule for
 * which sentence is tested without a renderer.
 */

/** What the sign-in page's URL carried. */
export type SignInOutcome = {
  error: string | null;
  /** Auth.js's `code` on a refused password: `rate_limited` after a lockout. */
  code?: string | null;
  /** Why the gate refused (`no-invite`, `unverified-email`, …). */
  reason?: string | null;
  /** The provider's name as a person knows it ("Google"), when one refused. */
  providerLabel?: string | null;
  /** Seconds to wait, after too many link requests. */
  retryAfterSeconds?: number | null;
};

/** A sentence in the `SignIn` namespace, with what fills it. */
export type SignInMessage = {
  key:
    | 'invalid'
    | 'rate_limited'
    | 'link_expired'
    | 'link_rate_limited'
    | 'account_not_linked'
    | 'unverified_email'
    | 'personal_account'
    | 'untrusted_issuer'
    | 'invite_failed'
    | 'no_invite'
    | 'failed';
  values?: Record<string, string | number>;
};

/**
 * The sentence for an outcome, or null when there is nothing to say.
 * @param outcome - What the URL carried.
 */
export function signInMessage(outcome: SignInOutcome): SignInMessage | null {
  const { error, reason } = outcome;
  const provider = outcome.providerLabel || 'The provider';
  if (!error) {
    return null;
  }
  switch (error) {
    case 'CredentialsSignin':
      return outcome.code === 'rate_limited' ? { key: 'rate_limited' } : { key: 'invalid' };
    case 'Verification':
      return { key: 'link_expired' };
    case 'EmailLinkRateLimited':
      return { key: 'link_rate_limited', values: { minutes: Math.max(1, Math.ceil((outcome.retryAfterSeconds ?? 900) / 60)) } };
    case 'OAuthAccountNotLinked':
      return { key: 'account_not_linked', values: { provider } };
    case 'AccessDenied':
      switch (reason) {
        case 'unverified-email':
          return { key: 'unverified_email', values: { provider } };
        case 'personal-account':
          return { key: 'personal_account' };
        case 'untrusted-issuer':
          return { key: 'untrusted_issuer', values: { provider } };
        case 'invite-failed':
          return { key: 'invite_failed' };
        default:
          return { key: 'no_invite' };
      }
    default:
      return { key: 'failed' };
  }
}
