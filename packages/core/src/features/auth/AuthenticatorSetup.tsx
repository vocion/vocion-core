'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { postJson } from './postJson';
import { RecoveryCodes } from './RecoveryCodes';

type Enrollment = { secret: string; otpauthUri: string; qrSvg: string };

/**
 * Setting up an authenticator, in three moves: scan, type the first code,
 * keep the recovery codes. The same component serves the profile page and
 * the sign-in gate an account that requires it puts in front of a workspace,
 * so there is one way to set it up.
 *
 * From the profile, a person with a password types it first
 * (`askPassword`): a session alone must not be enough to put an authenticator
 * in front of someone's next sign-in. A person without one (Google only) must
 * have signed in in the last ten minutes, which the server checks.
 * @param props - Callbacks.
 * @param props.onDone - Called once the recovery codes are saved; two-step sign-in is on.
 * @param props.onCancel - Shown as a Cancel button when given (the profile page).
 * @param props.askPassword - Ask for the current password before starting (the profile page, for a person who has one).
 */
export function AuthenticatorSetup(props: { onDone: () => void; onCancel?: () => void; askPassword?: boolean }) {
  const t = useTranslations('TwoStep');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(Boolean(props.askPassword));
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const start = useCallback(async (withPassword?: string) => {
    setLoadFailed(null);
    const result = await postJson<Enrollment>('/api/mfa/enroll', withPassword === undefined ? {} : { password: withPassword });
    if (result.ok) {
      setNeedsPassword(false);
      setPassword('');
      setEnrollment(result.data);
      return;
    }
    if (result.code === 'WRONG_PASSWORD' || result.code === 'PASSWORD_REQUIRED') {
      setNeedsPassword(true);
      setError(t('setup_wrong_password'));
    } else if (result.status === 429) {
      setError(t('rate_limited', { minutes: result.retryAfterMinutes ?? 15 }));
    } else {
      setLoadFailed(result.code === 'REAUTH_REQUIRED' ? t('setup_reauth') : t('setup_failed'));
    }
  }, [t]);

  useEffect(() => {
    if (props.askPassword) {
      return;
    }
    // Every setState in start() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
  }, [start, props.askPassword]);

  const onPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    await start(password);
    setSubmitting(false);
  };

  const onConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await postJson<{ recoveryCodes: string[] }>('/api/mfa/enroll/confirm', { code });
    setSubmitting(false);
    if (result.ok) {
      setRecoveryCodes(result.data.recoveryCodes);
      return;
    }
    if (result.status === 401) {
      // The sign-in this setup belonged to has ended (a hold lasts ten
      // minutes); the page shows the step to take now, the password.
      window.location.reload();
    } else if (result.status === 429) {
      setError(t('rate_limited', { minutes: result.retryAfterMinutes ?? 15 }));
    } else if (result.code === 'INVALID_CODE') {
      setError(t('invalid_code'));
    } else if (result.code === 'ENROLLMENT_REPLACED') {
      setCode('');
      setEnrollment(null);
      setNeedsPassword(Boolean(props.askPassword));
      if (!props.askPassword) {
        void start();
      }
      setError(t('setup_failed'));
    } else {
      setError(result.error ?? t('failed'));
    }
  };

  if (recoveryCodes) {
    return <RecoveryCodes codes={recoveryCodes} onDone={props.onDone} />;
  }

  if (loadFailed) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive" role="alert">{loadFailed}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => (props.askPassword ? setLoadFailed(null) : void start())}>{t('setup_retry')}</Button>
          {props.onCancel && <Button type="button" variant="ghost" onClick={props.onCancel}>{t('cancel')}</Button>}
        </div>
      </div>
    );
  }

  if (needsPassword) {
    return (
      <form onSubmit={onPassword} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="mfa-setup-password">{t('setup_password_label')}</Label>
          <p className="text-xs text-muted-foreground">{t('setup_password_intro')}</p>
          <Input
            id="mfa-setup-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={submitting}>{t('setup_password_continue')}</Button>
          {props.onCancel && <Button type="button" variant="ghost" onClick={props.onCancel}>{t('cancel')}</Button>}
        </div>
      </form>
    );
  }

  if (!enrollment) {
    return <p className="text-sm text-muted-foreground">{t('setup_loading')}</p>;
  }

  return (
    <form onSubmit={onConfirm} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('setup_scan')}</p>
      <div className="flex justify-center">
        {/* An <img> of the server-made SVG, not inlined markup: nothing from the response is parsed as HTML. */}
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qrSvg)}`}
          alt={t('setup_qr_alt')}
          width={176}
          height={176}
          className="rounded-lg border border-border/60 bg-white p-2"
        />
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t('setup_manual')}</p>
        <code className="block rounded bg-muted px-2 py-1.5 text-center font-mono text-xs tracking-wider break-all select-all">
          {enrollment.secret.replace(/(.{4})/g, '$1 ').trim()}
        </code>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mfa-setup-code">{t('setup_code_label')}</Label>
        <Input
          id="mfa-setup-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          value={code}
          onChange={e => setCode(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? t('setup_confirming') : t('setup_confirm')}
        </Button>
        {props.onCancel && <Button type="button" variant="ghost" onClick={props.onCancel}>{t('cancel')}</Button>}
      </div>
    </form>
  );
}
