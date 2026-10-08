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
 * @param props - Callbacks.
 * @param props.onDone - Called once the recovery codes are saved; two-step sign-in is on.
 * @param props.onCancel - Shown as a Cancel button when given (the profile page).
 */
export function AuthenticatorSetup(props: { onDone: () => void; onCancel?: () => void }) {
  const t = useTranslations('TwoStep');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const start = useCallback(async () => {
    setLoadFailed(false);
    const result = await postJson<Enrollment>('/api/mfa/enroll');
    if (result.ok) {
      setEnrollment(result.data);
    } else {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    // Every setState in start() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
  }, [start]);

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
    if (result.status === 429) {
      setError(t('rate_limited', { minutes: result.retryAfterMinutes ?? 15 }));
    } else if (result.code === 'INVALID_CODE') {
      setError(t('invalid_code'));
    } else if (result.code === 'ENROLLMENT_REPLACED') {
      setCode('');
      void start();
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
        <p className="text-sm text-destructive" role="alert">{t('setup_failed')}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void start()}>{t('setup_retry')}</Button>
          {props.onCancel && <Button type="button" variant="ghost" onClick={props.onCancel}>{t('cancel')}</Button>}
        </div>
      </div>
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
