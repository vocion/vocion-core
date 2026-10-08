import { setRequestLocale } from 'next-intl/server';
import { ForgotPasswordForm } from './ForgotPasswordForm';

/**
 * Forgot-password: an email in, a reset link out (`services/auth/passwordReset.ts`).
 * @param props - The route's props.
 * @param props.params - The locale.
 */
export default async function ForgotPasswordPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  return <ForgotPasswordForm />;
}
