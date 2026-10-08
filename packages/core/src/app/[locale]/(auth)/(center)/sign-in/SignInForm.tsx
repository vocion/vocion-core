'use client';

import type { SignInOutcome } from '@/features/auth/signInMessages';
import type { SignInProviderOption } from '@/libs/identity/signInProviders';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OrDivider, ProviderButtons } from '@/features/auth/ProviderButtons';
import { signInMessage } from '@/features/auth/signInMessages';
import { EMAIL_LINK_PROVIDER_ID } from '@/services/auth/emailLinkFragment';
import { VocionLogo } from '@/templates/VocionLogo';

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
};

/** How long a mailed link works, as the page says it. Matches `EMAIL_LINK_TTL_MINUTES`. */
const LINK_MINUTES = 15;

/**
 * Sign-in, every way this deployment offers: a button per provider, then the
 * email field — which mails a sign-in link when mail is set up, with the
 * password one click away ("Use a password"), and asks for the password
 * otherwise.
 * @param props - See {@link Props}.
 * @param props.callbackUrl - Where to land once signed in.
 * @param props.outcome - What the URL carried back.
 * @param props.hint - The demo login, when this is the demo sandbox.
 * @param props.providers - The providers this deployment offers.
 * @param props.emailLink - Whether "Email me a sign-in link" is offered.
 * @param props.linkSent - Open on "check your email".
 */
export function SignInForm({ callbackUrl, outcome, hint, providers = [], emailLink = false, linkSent = false }: Props) {
  const [email, setEmail] = useState(hint?.email ?? '');
  const [password, setPassword] = useState(hint?.password ?? '');
  const [showPassword, setShowPassword] = useState(false);
  // The demo login is a password; everywhere else the link comes first.
  const [mode, setMode] = useState<'link' | 'password'>(emailLink && !hint ? 'link' : 'password');
  const [sentTo, setSentTo] = useState<string | null>(linkSent ? '' : null);
  const [error, setError] = useState<string | null>(() => (outcome ? signInMessage(outcome) : null));
  const [submitting, setSubmitting] = useState(false);

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
      setError(signInMessage({ error: res.error }));
    } else if (res?.ok) {
      window.location.href = res.url ?? callbackUrl;
    }
  };

  const onLinkSubmit = async () => {
    const res = await signIn(EMAIL_LINK_PROVIDER_ID, { email, redirect: false, callbackUrl });
    const params = res?.error && res.url ? new URL(res.url, window.location.origin).searchParams : null;
    if (res?.error) {
      setError(signInMessage({
        error: res.error,
        retryAfterSeconds: Number(params?.get('retryAfter')) || null,
      }));
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
      setError(signInMessage({ error: 'Unknown' }));
    }
    setSubmitting(false);
  };

  const switchMode = (next: 'link' | 'password') => {
    setError(null);
    setMode(next);
  };

  return (
    <div className="w-full max-w-sm px-4">
      <div className="rounded-2xl border border-border/60 bg-card/80 p-8 shadow-xl shadow-black/5 backdrop-blur-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <VocionLogo size="lg" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
          </div>
        </div>

        {hint && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
            <strong>Demo credentials:</strong>
            {' '}
            {hint.email}
            {' / '}
            {hint.password}
            {' · '}
            <button type="button" className="font-medium underline" onClick={autofillHint}>autofill</button>
          </div>
        )}

        {sentTo !== null
          ? (
              <div className="space-y-4 text-center" role="status">
                <h2 className="text-lg font-semibold">Check your email</h2>
                <p className="text-sm text-muted-foreground">
                  {sentTo
                    ? `If you have an account, we've sent a link to ${sentTo}.`
                    : 'If you have an account, we\'ve sent you a link.'}
                  {' '}
                  {`It works once, for ${LINK_MINUTES} minutes.`}
                </p>
                <Button type="button" variant="outline" className="w-full" onClick={() => setSentTo(null)}>
                  Use a different email
                </Button>
              </div>
            )
          : (
              <>
                <ProviderButtons providers={providers} callbackUrl={callbackUrl} />
                {providers.length > 0 && <OrDivider />}

                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  {mode === 'password' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="password">Password</Label>
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
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
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
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {mode === 'link'
                      ? (submitting ? 'Sending…' : 'Email me a sign-in link')
                      : (submitting ? 'Signing in…' : 'Sign in')}
                  </Button>
                  {emailLink && (
                    <button
                      type="button"
                      className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      onClick={() => switchMode(mode === 'link' ? 'password' : 'link')}
                    >
                      {mode === 'link' ? 'Use a password' : 'Email me a sign-in link instead'}
                    </button>
                  )}
                </form>
              </>
            )}

        {/* Accounts come from invites only, so there is no sign-up link to offer. */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          This instance is invite-only — ask an admin for an invite link to join.
        </p>
      </div>
    </div>
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
