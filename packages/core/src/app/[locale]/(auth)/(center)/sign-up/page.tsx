import { eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { OrgBrandProvider } from '@/features/branding/BrandContext';
import { OrgBrandStyle } from '@/features/branding/OrgBrandStyle';
import { auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { signInProviderOptions } from '@/libs/identity/signInProviders';
import { inviteSchema } from '@/models/Schema';
import { brandViewForAccount } from '@/services/branding/OrgBrandService';
import { describeInviteForUser } from '@/services/InviteAcceptance';
import { JoinAccountCard } from './JoinAccountCard';
import { SignUpForm } from './SignUpForm';

/**
 * Where an invite link lands. Signed out, it is the sign-up form: accounts
 * are created by accepting an invite, and /api/signup validates the token on
 * submit. Signed in, it is the offer to join the invite's account on the
 * login they already have (vocion-core#128); the proxy lets a signed-in
 * person through to this page only when the URL carries an invite.
 *
 * The page wears the brand of the Org the invite is into — the layout's Org
 * on a single-Org server, and the invite's own on a server with several,
 * where nobody signed in yet means the layout knows no Org.
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

  const brand = invite ? await inviteBrand(invite) : null;
  const wear = (page: React.ReactNode) => (brand
    ? (
        <>
          <OrgBrandStyle brand={brand} />
          <OrgBrandProvider value={brand}>{page}</OrgBrandProvider>
        </>
      )
    : page);

  if (invite) {
    const session = await auth();
    if (session?.user?.id) {
      return wear(
        <JoinAccountCard
          inviteToken={invite}
          invite={await describeInviteForUser(session.user.id, invite)}
          signedInEmail={session.user.email ?? null}
        />,
      );
    }
  }

  return wear(<SignUpForm inviteToken={invite ?? null} providers={invite ? signInProviderOptions() : []} />);
}

/**
 * The brand of the Org an invite is into, or null (no such invite, an Org with no brand).
 * @param token - The invite token from the link.
 */
async function inviteBrand(token: string) {
  const [row] = await db.select({ accountId: inviteSchema.accountId }).from(inviteSchema).where(eq(inviteSchema.token, token)).limit(1).catch(() => []);
  return row ? brandViewForAccount(row.accountId).catch(() => null) : null;
}
