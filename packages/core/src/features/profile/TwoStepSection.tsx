'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AuthenticatorSetup } from '@/features/auth/AuthenticatorSetup';
import { RecoveryCodes } from '@/features/auth/RecoveryCodes';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { client } from '@/libs/Orpc';

type Status = Awaited<ReturnType<typeof client.profile.mfa.status>>;

/** What the section is doing right now, beyond showing the status. */
type Step
  = | { kind: 'idle' }
    | { kind: 'setup' }
    | { kind: 'confirm'; action: 'disable' | 'regenerate' }
    | { kind: 'codes'; codes: string[] };

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Two-step sign-in on the profile page: its state in one line, the one move
 * that changes it, and — for an account admin — the switch that requires it
 * of everyone in the account. Setting it up is the same component the
 * sign-in gate uses (`AuthenticatorSetup`).
 */
export function TwoStepSection() {
  const t = useTranslations('TwoStep');
  const format = useFormatter();
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await client.profile.mfa.status());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    // Every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'confirm') {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (step.action === 'disable') {
        await client.profile.mfa.disable({ code });
        setStep({ kind: 'idle' });
        setMessage({ ok: true, text: t('turned_off') });
      } else {
        const { recoveryCodes } = await client.profile.mfa.regenerateRecoveryCodes({ code });
        setStep({ kind: 'codes', codes: recoveryCodes });
      }
      setCode('');
      await refresh();
    } catch (error) {
      setMessage({ ok: false, text: errorText(error, t('failed')) });
    }
    setBusy(false);
  };

  const onRequireChange = async (required: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      await client.profile.mfa.setAccountRequirement({ required });
      setMessage({ ok: true, text: required ? t('account_require_on') : t('account_require_off') });
      await refresh();
    } catch (error) {
      setMessage({ ok: false, text: errorText(error, t('failed')) });
    }
    setBusy(false);
  };

  // Not offered where it cannot be used: the demo sandbox, where every
  // visitor shares one login (`libs/identity/demoSandbox.ts`).
  if (!status || !status.available) {
    return null;
  }

  const required = status.requiredBy === 'deployment'
    ? t('required_deployment')
    : status.requiredBy === 'account' ? t('required_account') : null;

  return (
    <DashboardSection title={t('profile_title')} description={t('profile_description')}>
      <div className="max-w-md space-y-4">
        <p className="text-sm">
          {status.enabled && status.enabledAt
            ? `${t('status_on', { date: format.dateTime(new Date(status.enabledAt), { dateStyle: 'medium' }) })} ${t('codes_left', { count: status.recoveryCodesLeft })}`
            : t('status_off')}
          {required && <span className="text-muted-foreground">{` ${required}`}</span>}
        </p>

        {step.kind === 'setup' && (
          <AuthenticatorSetup
            askPassword={status.hasPassword}
            onCancel={() => setStep({ kind: 'idle' })}
            onDone={() => {
              setStep({ kind: 'idle' });
              setMessage({ ok: true, text: t('turned_on') });
              void refresh();
            }}
          />
        )}

        {step.kind === 'codes' && (
          <RecoveryCodes codes={step.codes} onDone={() => setStep({ kind: 'idle' })} />
        )}

        {step.kind === 'confirm' && (
          <form onSubmit={onConfirm} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="mfa-current-code">{t('confirm_code_label')}</Label>
              <Input id="mfa-current-code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy} variant={step.action === 'disable' ? 'destructive' : 'default'}>
                {step.action === 'disable' ? t('turn_off') : t('new_codes')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'idle' })}>{t('cancel')}</Button>
            </div>
          </form>
        )}

        {step.kind === 'idle' && (
          <div className="flex flex-wrap gap-2">
            {!status.enabled && <Button type="button" onClick={() => setStep({ kind: 'setup' })}>{t('set_up')}</Button>}
            {status.enabled && (
              <Button type="button" variant="outline" onClick={() => setStep({ kind: 'confirm', action: 'regenerate' })}>
                {t('new_codes')}
              </Button>
            )}
            {status.enabled && !status.requiredBy && (
              <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'confirm', action: 'disable' })}>
                {t('turn_off')}
              </Button>
            )}
          </div>
        )}

        {message && (
          <p className={`text-sm ${message.ok ? 'text-emerald-600' : 'text-destructive'}`} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </p>
        )}

        {status.account?.canChange && (
          <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t('account_require_label')}</p>
              <p className="text-xs text-muted-foreground">{t('account_require_hint')}</p>
            </div>
            <Switch
              on={status.account.required}
              label={t('account_require_label')}
              disabled={busy}
              onChange={on => void onRequireChange(on)}
            />
          </div>
        )}
      </div>
    </DashboardSection>
  );
}
