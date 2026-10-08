'use client';

import type { SignInMessage, SignInOutcome } from '@/features/auth/signInMessages';
import type { SignInAccess } from '@/features/branding/AuthBrand';
import type { SignInProviderOption } from '@/libs/identity/signInProviders';
import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/features/auth/AuthCard';
import { OrDivider, ProviderButtons } from '@/features/auth/ProviderButtons';
import { signInMessage } from '@/features/auth/signInMessages';
import { useAccentButtonClass, useSignInTarget } from '@/features/branding/AuthBrand';
import { Link } from '@/libs/I18nNavigation';
import { EMAIL_LINK_PROVIDER_ID } from '@/services/auth/emailLinkFragment';

type Props = {
  callbackUrl: string;
  /** What the URL carried back: Auth.js's `error`, and the gate's `reason` for a refused sign-in. */
  outcome?: SignInOutcome;
  hint: { email: string; password: string } | null;
  /** "Continue with …" buttons for the providers this deployment offers. */
  providers?: SignInProviderOption[];
  /** Whether "Email me a sign-in link" is offered. */
  emailLink?: boolean;
  /** Open on "check your email" (a link request that came back without JavaScript). */
  linkSent?: boolean;
  /** Whose instance this is and who may get in, for the subtitle and the line under the form. */
  access?: SignInAccess;
};

/**
 * "A", "A or B", "A, B or C".
 * @param items - The words.
 * @param or - The word for "or".
 */
function listOr(items: string[], or: string): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${or} ${items.at(-1)}`;
}

/** How long a mailed link works, as the page says it. Matches `EMAIL_LINK_TTL_MINUTES`. */
const LINK_MINUTES = 15;

/**
 * Sign-in, every way this deployment offers: a button per provider, then the
 * email field — which mails a sign-in link when mail is set up, with the
 * password one click away ("Use a password"), and asks for the password
 * otherwise. "Forgot password?" sits beside the password field and leads to
 * a reset link by email (`/forgot-password`). A second factor, when one is
 * owed, is asked for on this same page after the first step (`page.tsx`).
 * @param props - See {@link Props}.
 * @param props.callbackUrl - Where to land once signed in.
 * @param props.outcome - What the URL carried back.
 * @param props.hint - The demo login, when this is the demo sandbox.
 * @param props.providers - The providers this deployment offers.
 * @param props.emailLink - Whether "Email me a sign-in link" is offered.
 * @param props.linkSent - Open on "check your email".
 * @param props.access
 */
export function SignInForm({ callbackUrl, outcome, hint, providers = [], emailLink = false, linkSent = false, access }: Props) {
  const t = useTranslations('SignIn');
  // Spelled out key by key, so the translation check sees every sentence used.
  const say = (message: SignInMessage | null): string | null => {
    if (!message) {
      return null;
    }
    const provider = String(message.values?.provider ?? '');
    switch (message.key) {
      case 'invalid':
        return t('invalid');
      case 'rate_limited':
        return t('rate_limited');
      case 'link_expired':
        return t('link_expired');
      case 'link_rate_limited':
        return t('link_rate_limited', { minutes: Number(message.values?.minutes ?? 15) });
      case 'account_not_linked':
        return t('account_not_linked', { provider });
      case 'unverified_email':
        return t('unverified_email', { provider });
      case 'personal_account':
        return t('personal_account');
      case 'untrusted_issuer':
        return t('untrusted_issuer', { provider });
      case 'invite_failed':
        return t('invite_failed');
      case 'no_invite':
        return t('no_invite');
      case 'failed':
        return t('failed');
    }
  };
  const [email, setEmail] = useState(hint?.email ?? '');
  const [password, setPassword] = useState(hint?.password ?? '');
  const [showPassword, setShowPassword] = useState(false);
  // The demo login is a password; everywhere else the link comes first.
  const [mode, setMode] = useState<'link' | 'password'>(emailLink && !hint ? 'link' : 'password');
  const [sentTo, setSentTo] = useState<string | null>(linkSent ? '' : null);
  const [error, setError] = useState<string | null>(() => (outcome ? say(signInMessage(outcome)) : null));
  const [submitting, setSubmitting] = useState(false);
  // An Org's own sign-in: its name in the subtitle, its accent on the button.
  const accentButton = useAccentButtonClass();
  const target = useSignInTarget() ?? access?.org ?? null;

  const autofillHint = () => {
    if (hint) {
      setEmail(hint.email);
      setPassword(hint.password);
      setMode('password');
    }
  };

  const onPasswordSubmit = async () => {
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    if (res?.error) {
      setError(say(signInMessage({ error: res.error, code: res.code })));
    } else if (res?.ok) {
      // A second factor, when one is owed, is asked for on this same page:
      // the reload finds the half-finished session and shows the code step.
      window.location.href = res.url ?? callbackUrl;
    }
  };

  const onLinkSubmit = async () => {
    const res = await signIn(EMAIL_LINK_PROVIDER_ID, { email, redirect: false, callbackUrl });
    const params = res?.error && res.url ? new URL(res.url, window.location.origin).searchParams : null;
    if (res?.error) {
      setError(say(signInMessage({
        error: res.error,
        retryAfterSeconds: Number(params?.get('retryAfter')) || null,
      })));
      return;
    }
    // The same answer whether or not the address has a login.
    setSentTo(email);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await (mode === 'link' ? onLinkSubmit() : onPasswordSubmit());
    } catch {
      setError(say(signInMessage({ error: 'Unknown' })));
    }
    setSubmitting(false);
  };

  const switchMode = (next: 'link' | 'password') => {
    setError(null);
    setMode(next);
  };

  return (
    <AuthCard title={t('title')} subtitle={target ? t('subtitle_org', { org: target }) : t('subtitle')}>
      {hint && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>{t('demo_credentials')}</strong>
          {' '}
          {hint.email}
          {' / '}
          {hint.password}
          {' · '}
          <button type="button" className="font-medium underline" onClick={autofillHint}>{t('autofill')}</button>
        </div>
      )}

      {sentTo !== null
        ? (
            <div className="space-y-4 text-center" role="status">
              <h2 className="text-lg font-semibold">{t('check_email_title')}</h2>
              <p className="text-sm text-muted-foreground">
                {sentTo ? t('check_email_to', { email: sentTo }) : t('check_email')}
                {' '}
                {t('link_works_for', { minutes: LINK_MINUTES })}
              </p>
              <Button type="button" variant="outline" className="w-full" onClick={() => setSentTo(null)}>
                {t('different_email')}
              </Button>
            </div>
          )
        : (
            <>
              <ProviderButtons providers={providers} callbackUrl={callbackUrl} />
              {providers.length > 0 && <OrDivider />}

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t('email')}</Label>
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                {mode === 'password' && (
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <Label htmlFor="password">{t('password')}</Label>
                      <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                        {t('forgot_password')}
                      </Link>
                    </div>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        aria-label={showPassword ? t('hide_password') : t('show_password')}
                        aria-pressed={showPassword}
                        tabIndex={-1}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>
                )}
                {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                <Button type="submit" className={accentButton ? `w-full ${accentButton}` : 'w-full'} disabled={submitting}>
                  {mode === 'link'
                    ? (submitting ? t('link_sending') : t('link_submit'))
                    : (submitting ? t('submitting') : t('submit'))}
                </Button>
                {emailLink && (
                  <button
                    type="button"
                    className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    onClick={() => switchMode(mode === 'link' ? 'password' : 'link')}
                  >
                    {mode === 'link' ? t('use_password') : t('use_link')}
                  </button>
                )}
              </form>
            </>
          )}

      {/* Who may get in, as the install's policy says: a domain that joins
          by itself, else whom to ask. There is no sign-up link to offer. */}
      <p className="mt-6 text-center text-sm text-muted-foreground" data-testid="sign-in-access">
        {access?.autoJoin
          ? t('access_auto_join', { domains: listOr(access.autoJoin.domains.map(d => `@${d}`), t('or')), providers: listOr(access.autoJoin.providers, t('or')) })
          : target
            ? t('access_ask', { org: target })
            : t('invite_only')}
      </p>
    </AuthCard>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
