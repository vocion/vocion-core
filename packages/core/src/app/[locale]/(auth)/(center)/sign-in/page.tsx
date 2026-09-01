import { setRequestLocale } from 'next-intl/server';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import { SignInForm } from './SignInForm';

/**
 * Self-service sign-up only works while the instance has no users at all:
 * `/api/signup` demands an invite token the moment one exists. The sign-in
 * page therefore has to know which of the two it is, or it offers a
 * "Create an account" link that dead-ends on "Invite required".
 *
 * A database that cannot be reached is reported as invite-only. That is the
 * safe direction: the alternative would advertise a sign-up flow that is
 * equally broken, and nothing else on the page works either.
 */
async function selfSignUpIsOpen(): Promise<boolean> {
  try {
    const [existingUser] = await db.select({ id: userSchema.id }).from(userSchema).limit(1);
    return !existingUser;
  } catch (error) {
    console.error('sign-in: could not check whether the instance has users; treating sign-up as invite-only', error);
    return false;
  }
}

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
  const canSelfSignUp = await selfSignUpIsOpen();

  return (
    <SignInForm
      callbackUrl={callbackUrl ?? '/dashboard'}
      error={error ?? null}
      hint={hint}
      canSelfSignUp={canSelfSignUp}
    />
  );
}
