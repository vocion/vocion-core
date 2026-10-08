'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/features/auth/AuthCard';
import { postJson } from '@/features/auth/postJson';
import { Link } from '@/libs/I18nNavigation';

const MIN_LENGTH = 8;

/**
 * The token from the link's fragment (`#token=…`), taken out of the address
 * bar as it is read so it does not linger in history, a screenshot, or a URL
 * the browser's error reporting records.
 */
function takeTokenFromFragment(): string {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? '';
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  return token;
}

/**
 * Choose a new password from a reset link. The token comes from the link's
 * fragment, never the query string, so no server log holds it. A link that is
 * already spent or expired says so before the person types anything (checked
 * with a POST), and again if it ran out while they were typing.
 */
export function ResetPasswordForm() {
  const t = useTranslations('ResetPassword');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<'checking' | 'form' | 'done' | 'invalid'>('checking');

  useEffect(() => {
    const fromLink = takeTokenFromFragment();
    const check = async () => {
      const result = fromLink
        ? await postJson<{ live: boolean }>('/api/password-reset/check', { token: fromLink })
        : null;
      setToken(fromLink);
      // A check that could not run (offline, rate limited) shows the form;
      // submitting it says what is wrong.
      setState(result && result.ok && !result.data.live ? 'invalid' : fromLink ? 'form' : 'invalid');
    };
    void check();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(t('weak'));
      return;
    }
    if (password !== confirm) {
      setError(t('mismatch'));
      return;
    }
    setSubmitting(true);
    const result = await postJson<{ ok: true }>('/api/password-reset/confirm', { token, password });
    setSubmitting(false);
    if (result.ok) {
      setState('done');
    } else if (result.status === 429) {
      setError(t('rate_limited', { minutes: result.retryAfterMinutes ?? 60 }));
    } else if (result.code === 'INVALID_LINK') {
      setState('invalid');
    } else if (result.code === 'WEAK_PASSWORD') {
      setError(t('weak'));
    } else {
      setError(t('failed'));
    }
  };

  if (state === 'checking') {
    return <AuthCard title={t('title')} subtitle={t('checking')}>{null}</AuthCard>;
  }

  if (state === 'done') {
    return (
      <AuthCard title={t('done_title')} subtitle={t('done_body')}>
        <Button asChild className="w-full">
          <Link href="/sign-in">{t('sign_in')}</Link>
        </Button>
      </AuthCard>
    );
  }

  if (state === 'invalid') {
    return (
      <AuthCard title={t('invalid_title')} subtitle={t('invalid_body')}>
        <Button asChild className="w-full">
          <Link href="/forgot-password">{t('request_new')}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('title')} subtitle={t('body')}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">{t('password')}</Label>
          <Input id="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={MIN_LENGTH} autoComplete="new-password" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">{t('confirm')}</Label>
          <Input id="confirm-password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
