import type { SignInAccess } from '@/features/branding/AuthBrand';
import { eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { SecondFactorChallenge, SecondFactorEnrollmentGate } from '@/features/auth/SecondFactorChallenge';
import { auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { signInProviderOptions } from '@/libs/identity/signInProviders';
import { tenantAccountSchema } from '@/models/Schema';
import { autoJoinPolicy } from '@/services/auth/autoJoin';
import { emailLinkConfigured } from '@/services/auth/emailLink';
import { getOrgBrand, installAccountId } from '@/services/branding/OrgBrandService';
import { SignInForm } from './SignInForm';

/**
 * Sign-in, start to finish, on one page. The server decides which ways in
 * this deployment offers — a button per configured provider (Google,
 * Microsoft), the email link when mail is set up, the password always (with
 * "Forgot password?") — and the form shows exactly those. When the session
 * that comes back still owes a second factor (`session.mfa`), the same page
 * asks for it: the code from the person's app, or — when their account
 * requires two-step sign-in and they have none yet — setting one up.
 *
 * A refused or failed sign-in comes back here with `?error=` (and, from the
 * invite-only gate, `reason` and `provider`), which the form turns into a
 * sentence; a link request that came back without JavaScript arrives with
 * `type=email` and opens on "check your email".
 * @param props - The route's props.
 * @param props.params - The locale.
 * @param props.searchParams - `callbackUrl`, Auth.js's `error` and `code`, and the gate's `reason`, `provider`, `retryAfter`; `type` after a link request.
 */
export default async function SignInPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string; error?: string; code?: string; reason?: string; provider?: string; retryAfter?: string; type?: string }>;
}) {
  const { locale } = await props.params;
  const { callbackUrl, error, code, reason, provider, retryAfter, type } = await props.searchParams;
  setRequestLocale(locale);
  const destination = callbackUrl ?? '/dashboard';

  const session = await auth();
  if (session?.mfa?.state === 'verify') {
    return <SecondFactorChallenge callbackUrl={destination} />;
  }
  if (session?.mfa?.state === 'enroll') {
    return <SecondFactorEnrollmentGate callbackUrl={destination} />;
  }

  const hintEmail = process.env.VOCION_DEMO_HINT_EMAIL;
  const hintPassword = process.env.VOCION_DEMO_HINT_PASSWORD;
  const hint = hintEmail && hintPassword ? { email: hintEmail, password: hintPassword } : null;
  const providers = signInProviderOptions();
  const emailLink = emailLinkConfigured();
  const access = await signInAccess(providers.map(p => p.label));

  return (
    <SignInForm
      callbackUrl={destination}
      outcome={{
        error: error ?? null,
        code: code ?? null,
        reason: reason ?? null,
        providerLabel: providers.find(p => p.id === provider)?.label ?? null,
        retryAfterSeconds: Number(retryAfter) || null,
      }}
      hint={hint}
      providers={providers}
      emailLink={emailLink}
      linkSent={emailLink && type === 'email' && !error}
      access={access}
    />
  );
}

/**
 * Who may get in, for the line under the form: on a single-Org server, the
 * Org's name (its brand's, else its own) and the domains that join without an
 * invite when a provider can prove them. A multi-Org server knows no Org
 * before sign-in and says nothing about either.
 * @param providerLabels - "Google", "Microsoft", as offered.
 */
async function signInAccess(providerLabels: string[]): Promise<SignInAccess> {
  const accountId = await installAccountId().catch(() => null);
  if (!accountId) {
    return { org: null, autoJoin: null };
  }
  const [brand, [row], policy] = await Promise.all([
    getOrgBrand(accountId).catch(() => null),
    db.select({ name: tenantAccountSchema.name }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1),
    autoJoinPolicy().catch(() => null),
  ]);
  return {
    org: brand?.name ?? row?.name ?? null,
    autoJoin: policy && policy.accountId === accountId && providerLabels.length > 0 ? { domains: [...policy.domains], providers: providerLabels } : null,
  };
}
