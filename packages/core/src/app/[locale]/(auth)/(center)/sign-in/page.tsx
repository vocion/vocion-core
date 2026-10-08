import { setRequestLocale } from 'next-intl/server';
import { SecondFactorChallenge, SecondFactorEnrollmentGate } from '@/features/auth/SecondFactorChallenge';
import { auth } from '@/libs/Auth';
import { googleSignInConfigured } from '@/libs/identity/google';
import { SignInForm } from './SignInForm';

/**
 * Sign-in, start to finish, on one page. The first step is the password (or
 * Google). When the session that comes back still owes a second factor
 * (`session.mfa`), the same page asks for it: the code from the person's app,
 * or — when their account requires two-step sign-in and they have none yet —
 * setting one up. A fully signed-in visitor never gets here; the proxy sends
 * them to the dashboard.
 * @param props - The route's props.
 * @param props.params - The locale.
 * @param props.searchParams - `callbackUrl`, and Auth.js's `error`.
 */
export default async function SignInPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { locale } = await props.params;
  const { callbackUrl, error } = await props.searchParams;
  setRequestLocale(locale);
  const destination = callbackUrl ?? '/dashboard';

  const session = await auth();
  if (session?.mfa?.state === 'verify') {
    return <SecondFactorChallenge callbackUrl={destination} />;
  }
  if (session?.mfa?.state === 'enroll') {
    return <SecondFactorEnrollmentGate callbackUrl={destination} />;
  }

  const hintEmail = process.env.VOCION_DEMO_HINT_EMAIL;
  const hintPassword = process.env.VOCION_DEMO_HINT_PASSWORD;
  const hint = hintEmail && hintPassword ? { email: hintEmail, password: hintPassword } : null;

  return (
    <SignInForm
      callbackUrl={destination}
      error={error ?? null}
      hint={hint}
      google={googleSignInConfigured()}
    />
  );
}
