import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ResetPasswordForm } from './ResetPasswordForm';

/** Belt and braces: nothing on this page may carry its URL away as a Referer. */
export const metadata: Metadata = { referrer: 'no-referrer' };

/**
 * Where a reset link lands. The token is in the link's fragment
 * (`/reset-password#token=…`), which never reaches this server, its logs or an
 * error tracker's request record, so the page is the same for every link: the
 * form reads the token in the browser and checks it with a POST
 * (`services/auth/passwordReset.ts`).
 * @param props - The route's props.
 * @param props.params - The locale.
 */
export default async function ResetPasswordPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  return <ResetPasswordForm />;
}
