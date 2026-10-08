import { setRequestLocale } from 'next-intl/server';
import { signInProviderOptions } from '@/libs/identity/signInProviders';
import { emailLinkConfigured } from '@/services/auth/emailLink';
import { SignInForm } from './SignInForm';

/**
 * Sign-in. The server decides which ways in this deployment offers — a
 * button per configured provider (Google, Microsoft), the email link when
 * mail is set up, the password always — and the form shows exactly those.
 * A refused or failed sign-in comes back here with `?error=` (and, from the
 * invite-only gate, `reason` and `provider`), which the form turns into a
 * sentence; a link request that came back without JavaScript arrives with
 * `type=email` and opens on "check your email".
 * @param props - The route's props.
 * @param props.params - The locale.
 * @param props.searchParams - `callbackUrl`, Auth.js's `error`, and the gate's `reason`, `provider`, `retryAfter`; `type` after a link request.
 */
export default async function SignInPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string; error?: string; reason?: string; provider?: string; retryAfter?: string; type?: string }>;
}) {
  const { locale } = await props.params;
  const { callbackUrl, error, reason, provider, retryAfter, type } = await props.searchParams;
  setRequestLocale(locale);

  const hintEmail = process.env.VOCION_DEMO_HINT_EMAIL;
  const hintPassword = process.env.VOCION_DEMO_HINT_PASSWORD;
  const hint = hintEmail && hintPassword ? { email: hintEmail, password: hintPassword } : null;
  const providers = signInProviderOptions();
  const emailLink = emailLinkConfigured();

  return (
    <SignInForm
      callbackUrl={callbackUrl ?? '/dashboard'}
      outcome={{
        error: error ?? null,
        reason: reason ?? null,
        providerLabel: providers.find(p => p.id === provider)?.label ?? null,
        retryAfterSeconds: Number(retryAfter) || null,
      }}
      hint={hint}
      providers={providers}
      emailLink={emailLink}
      linkSent={emailLink && type === 'email' && !error}
    />
  );
}
