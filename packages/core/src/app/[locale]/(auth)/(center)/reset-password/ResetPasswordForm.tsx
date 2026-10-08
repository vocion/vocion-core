'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/features/auth/AuthCard';
import { postJson } from '@/features/auth/postJson';
import { Link } from '@/libs/I18nNavigation';

const MIN_LENGTH = 8;

/**
 * Choose a new password from a reset link. A link that is already spent or
 * expired says so before the person types anything (`live` from the page),
 * and again if it ran out while they were typing.
 * @param props - The link.
 * @param props.token - The token from `?token=`.
 * @param props.live - Whether the link was still good when the page loaded.
 */
export function ResetPasswordForm(props: { token: string; live: boolean }) {
  const t = useTranslations('ResetPassword');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(props.live ? 'form' : 'invalid');

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
    const result = await postJson<{ ok: true }>('/api/password-reset/confirm', { token: props.token, password });
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
