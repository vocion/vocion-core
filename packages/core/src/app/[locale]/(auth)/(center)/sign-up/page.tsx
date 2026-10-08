import { setRequestLocale } from 'next-intl/server';
import { auth } from '@/libs/Auth';
import { signInProviderOptions } from '@/libs/identity/signInProviders';
import { describeInviteForUser } from '@/services/InviteAcceptance';
import { JoinAccountCard } from './JoinAccountCard';
import { SignUpForm } from './SignUpForm';

/**
 * Where an invite link lands. Signed out, it is the sign-up form: accounts
 * are created by accepting an invite, and /api/signup validates the token on
 * submit. Signed in, it is the offer to join the invite's account on the
 * login they already have (vocion-core#128); the proxy lets a signed-in
 * person through to this page only when the URL carries an invite.
 * @param props - The route's props.
 * @param props.params - The locale.
 * @param props.searchParams - `invite`, the token from the link.
 */
export default async function SignUpPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { locale } = await props.params;
  const { invite } = await props.searchParams;
  setRequestLocale(locale);

  if (invite) {
    const session = await auth();
    if (session?.user?.id) {
      return (
        <JoinAccountCard
          inviteToken={invite}
          invite={await describeInviteForUser(session.user.id, invite)}
          signedInEmail={session.user.email ?? null}
        />
      );
    }
  }

  return <SignUpForm inviteToken={invite ?? null} providers={invite ? signInProviderOptions() : []} />;
}
