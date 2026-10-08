import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { OperatorConsole } from '@/features/operator/OperatorConsole';
import { clerkAuth as auth } from '@/libs/Auth';
import { isOperatorUser } from '@/services/operator';

/**
 * /dashboard/operator — every client account on the deployment, for the
 * people who operate it (`VOCION_OPERATOR_EMAILS`).
 *
 * Anyone else gets the ordinary 404: the page is not one that exists for
 * them, the same answer a workspace they cannot reach gives. The routes behind
 * it (`routers/Operator.ts`) check again on every call, so the page is a door,
 * not the lock.
 * @param props - The route's props.
 * @param props.params - Carries the locale.
 */
export default async function OperatorPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { userId } = await auth();
  if (!userId || !(await isOperatorUser(userId))) {
    notFound();
  }
  return <OperatorConsole />;
}
