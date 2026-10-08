import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { resetLinkIsLive } from '@/services/auth/passwordReset';
import { ResetPasswordForm } from './ResetPasswordForm';

/** The token is in this page's URL; no request from it may carry that URL away as a Referer. */
export const metadata: Metadata = { referrer: 'no-referrer' };

/**
 * Where a reset link lands. Checks the link without spending it, so a spent
 * or expired one says so before the person types a new password.
 * @param props - The route's props.
 * @param props.params - The locale.
 * @param props.searchParams - `token`, from the mailed link.
 */
export default async function ResetPasswordPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await props.params;
  const { token } = await props.searchParams;
  setRequestLocale(locale);
  const value = token ?? '';
  return <ResetPasswordForm token={value} live={await resetLinkIsLive(value)} />;
}
