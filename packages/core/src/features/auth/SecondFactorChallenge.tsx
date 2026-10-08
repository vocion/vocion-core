'use client';

import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from './AuthCard';
import { AuthenticatorSetup } from './AuthenticatorSetup';
import { postJson, sameOriginDestination } from './postJson';

/**
 * The second step of signing in, shown on the sign-in page while the session
 * waits on a code: the authenticator's six digits, or a recovery code.
 * @param props - Where to go after.
 * @param props.callbackUrl - The page the person was signing in to reach.
 */
export function SecondFactorChallenge(props: { callbackUrl: string }) {
  const t = useTranslations('TwoStep');
  const [mode, setMode] = useState<'app' | 'recovery'>('app');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await postJson<{ ok: true }>('/api/mfa/verify', { code });
    if (result.ok) {
      window.location.href = sameOriginDestination(props.callbackUrl);
      return;
    }
    setSubmitting(false);
    if (result.status === 429) {
      setError(t('rate_limited', { minutes: result.retryAfterMinutes ?? 15 }));
    } else if (result.code === 'INVALID_CODE') {
      setError(t('invalid_code'));
    } else if (result.code === 'NO_PENDING_SIGN_IN') {
      window.location.reload();
    } else {
      setError(t('failed'));
    }
  };

  const switchMode = () => {
    setMode(m => (m === 'app' ? 'recovery' : 'app'));
    setCode('');
    setError(null);
  };

  return (
    <AuthCard title={t('challenge_title')} subtitle={mode === 'app' ? t('challenge_body') : t('recovery_body')}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mfa-code">{mode === 'app' ? t('code_label') : t('recovery_label')}</Label>
          <Input
            id="mfa-code"
            value={code}
            onChange={e => setCode(e.target.value)}
            required
            {...(mode === 'app'
              ? { inputMode: 'numeric' as const, autoComplete: 'one-time-code', pattern: '[0-9 ]*', maxLength: 7 }
              : { autoComplete: 'off', spellCheck: false, maxLength: 32 })}
          />
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? t('verifying') : t('verify')}
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        <button type="button" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={switchMode}>
          {mode === 'app' ? t('use_recovery') : t('use_app')}
        </button>
        <StartOver />
      </div>
    </AuthCard>
  );
}

/**
 * The sign-in gate for a person whose account (or deployment) requires
 * two-step sign-in and who has not set it up: set it up here, then go on.
 * @param props - Where to go after.
 * @param props.callbackUrl - The page the person was signing in to reach.
 */
export function SecondFactorEnrollmentGate(props: { callbackUrl: string }) {
  const t = useTranslations('TwoStep');
  return (
    <AuthCard title={t('gate_title')} subtitle={t('gate_body')}>
      <AuthenticatorSetup onDone={() => {
        window.location.href = sameOriginDestination(props.callbackUrl);
      }}
      />
      <div className="mt-6 text-center text-sm">
        <StartOver />
      </div>
    </AuthCard>
  );
}

function StartOver() {
  const t = useTranslations('TwoStep');
  return (
    <button
      type="button"
      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      onClick={() => void signOut({ callbackUrl: '/sign-in' })}
    >
      {t('start_over')}
    </button>
  );
}
