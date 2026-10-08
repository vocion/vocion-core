import { setRequestLocale } from 'next-intl/server';
import { EmailLinkLanding } from './EmailLinkLanding';

/**
 * Where a mailed sign-in link opens. It does not sign anyone in by being
 * opened: mail scanners open every link in a message first, and a link that
 * signed in on open would be spent before the person got to it. The page
 * reads the token from its fragment and asks the person to press "Sign in"
 * (`services/auth/emailLink.ts`).
 * @param props - The route's props.
 * @param props.params - The locale.
 */
export default async function EmailLinkPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  return <EmailLinkLanding />;
}
