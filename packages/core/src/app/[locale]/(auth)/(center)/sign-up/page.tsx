import { setRequestLocale } from 'next-intl/server';
import { SignUpForm } from './SignUpForm';

/**
 * Accounts are created by accepting an invite, so this page needs nothing
 * from the database — the invite token in the URL is the whole input. The
 * token is validated by /api/signup on submit, not here.
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function SignUpPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { locale } = await props.params;
  const { invite } = await props.searchParams;
  setRequestLocale(locale);

  return <SignUpForm inviteToken={invite ?? null} />;
}
