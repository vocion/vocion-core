/**
 * The sentence the sign-in page shows for what came back in its URL: an
 * Auth.js `error`, and for a refused Google, Microsoft or email-link sign-in
 * the `reason` the invite-only gate gave (`services/auth/externalSignIn.ts`).
 * Every one says what happened and what to do next.
 */

/** What the sign-in page's URL carried. */
export type SignInOutcome = {
  error: string | null;
  /** Why the gate refused (`no-invite`, `unverified-email`, …). */
  reason?: string | null;
  /** The provider's name as a person knows it ("Google"), when one refused. */
  providerLabel?: string | null;
  /** Seconds to wait, after too many link requests. */
  retryAfterSeconds?: number | null;
};

/**
 * The sentence for an outcome, or null when there is nothing to say.
 * @param outcome - What the URL carried.
 */
export function signInMessage(outcome: SignInOutcome): string | null {
  const { error, reason } = outcome;
  const provider = outcome.providerLabel || 'The provider';
  if (!error) {
    return null;
  }
  switch (error) {
    case 'CredentialsSignin':
      return 'Invalid email or password.';
    case 'Verification':
      return 'That sign-in link has expired or was already used. Ask for a new one.';
    case 'EmailLinkRateLimited': {
      const minutes = Math.max(1, Math.ceil((outcome.retryAfterSeconds ?? 900) / 60));
      return `Too many sign-in links asked for. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    case 'OAuthAccountNotLinked':
      return `That ${provider} account is linked to a different login. Sign in with the account you linked.`;
    case 'AccessDenied':
      switch (reason) {
        case 'unverified-email':
          return `${provider} didn't confirm an email address for this account, so it can't be matched to an invite. Use an account with a verified address, or ask an admin to invite you.`;
        case 'personal-account':
          return 'Use a work or school Microsoft account. Personal Microsoft accounts can\'t sign in here.';
        case 'untrusted-issuer':
          return `${provider} sign-in couldn't be verified. Try again.`;
        case 'invite-failed':
          return 'Your invite couldn\'t be accepted. Open the invite link from your email, or ask an admin for a new one.';
        default:
          return 'No invite for this address. Ask an admin to invite you.';
      }
    default:
      return 'Sign-in didn\'t finish. Try again.';
  }
}
