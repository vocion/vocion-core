import { setRequestLocale } from 'next-intl/server';
import { SignInForm } from './SignInForm';

export default async function SignInPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { locale } = await props.params;
  const { callbackUrl, error } = await props.searchParams;
  setRequestLocale(locale);

  const hintEmail = process.env.VOCION_DEMO_HINT_EMAIL;
  const hintPassword = process.env.VOCION_DEMO_HINT_PASSWORD;
  const hint = hintEmail && hintPassword ? { email: hintEmail, password: hintPassword } : null;

  return (
    <SignInForm
      callbackUrl={callbackUrl ?? '/dashboard'}
      error={error ?? null}
      hint={hint}
    />
  );
}
