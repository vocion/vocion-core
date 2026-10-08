'use client';

import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/features/auth/AuthCard';
import { Link } from '@/libs/I18nNavigation';

type Props = {
  callbackUrl: string;
  /** `?error=` from Auth.js: `AccessDenied` is a refused Google sign-in. */
  error: string | null;
  hint: { email: string; password: string } | null;
  /** Whether "Continue with Google" is configured on this deployment. */
  google?: boolean;
};

/**
 * The words for an Auth.js error, by the code it sent back.
 * @param t - The `SignIn` translator.
 * @param error - Auth.js's `error`.
 * @param code - Auth.js's `code`, set by a credentials refusal.
 */
function errorMessage(t: ReturnType<typeof useTranslations<'SignIn'>>, error: string | null, code?: string | null): string | null {
  if (!error) {
    return null;
  }
  if (code === 'rate_limited') {
    return t('rate_limited');
  }
  if (error === 'CredentialsSignin') {
    return t('invalid');
  }
  if (error === 'AccessDenied') {
    return t('google_denied');
  }
  return t('failed');
}

export function SignInForm({ callbackUrl, error: initialError, hint, google = false }: Props) {
  const t = useTranslations('SignIn');
  const [email, setEmail] = useState(hint?.email ?? '');
  const [password, setPassword] = useState(hint?.password ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(() => errorMessage(t, initialError));
  const [submitting, setSubmitting] = useState(false);

  const autofillHint = () => {
    if (hint) {
      setEmail(hint.email);
      setPassword(hint.password);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setSubmitting(false);
    if (res?.error) {
      setError(errorMessage(t, res.error, res.code));
    } else if (res?.ok) {
      // A second factor, when one is owed, is asked for on this same page:
      // the reload finds the half-finished session and shows the code step.
      window.location.href = res.url ?? callbackUrl;
    }
  };

  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
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

      {google && (
        <>
          <Button type="button" variant="outline" className="w-full" onClick={() => void signIn('google', { callbackUrl })}>
            <GoogleIcon />
            {t('google')}
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            {t('or')}
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('email')}</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
        </div>
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
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </form>

      {/* Accounts come from invites only, so there is no sign-up link to offer. */}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t('invite_only')}
      </p>
    </AuthCard>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
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
