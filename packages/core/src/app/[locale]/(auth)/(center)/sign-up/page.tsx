import { setRequestLocale } from 'next-intl/server';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import { SignUpForm } from './SignUpForm';

export default async function SignUpPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { locale } = await props.params;
  const { invite } = await props.searchParams;
  setRequestLocale(locale);

  // First-run = no users yet. The migration may pre-create a default
  // tenant_account row (during the org→project backfill), so we key off
  // user count instead: if zero users exist, this signup creates the
  // first admin.
  const [existing] = await db.select({ id: userSchema.id }).from(userSchema).limit(1);
  const isFirstRun = !existing;

  return <SignUpForm isFirstRun={isFirstRun} inviteToken={invite ?? null} />;
}
