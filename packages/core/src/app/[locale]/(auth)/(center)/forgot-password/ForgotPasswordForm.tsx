'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/features/auth/AuthCard';
import { postJson } from '@/features/auth/postJson';
import { Link } from '@/libs/I18nNavigation';

/**
 * Ask for a reset link. The answer is the same whether or not the email has a
 * login (`/api/password-reset`), so the confirmation says "if".
 */
export function ForgotPasswordForm() {
  const t = useTranslations('ForgotPassword');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await postJson<{ ok: true }>('/api/password-reset', { email });
    setSubmitting(false);
    if (result.ok) {
      setSentTo(email);
    } else if (result.status === 429) {
      setError(t('rate_limited', { minutes: result.retryAfterMinutes ?? 60 }));
    } else {
      setError(t('failed'));
    }
  };

  if (sentTo) {
    return (
      <AuthCard title={t('sent_title')} subtitle={t('sent_body', { email: sentTo })}>
        <p className="text-center text-sm">
          <Link className="underline" href="/sign-in">{t('back')}</Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('title')} subtitle={t('body')}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('email')}</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href="/sign-in">{t('back')}</Link>
      </p>
    </AuthCard>
  );
}
