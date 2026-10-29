'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { client } from '@/libs/Orpc';

type Setting = { on: boolean; chosen: boolean | null; defaultOn: boolean; overridden: boolean; canChange: boolean };

/**
 * "Help improve Vocion: let the daily review read chat content" — the Org's
 * say in what the daily usage review reads (`services/usageReview/privacy.ts`,
 * docs/guides/usage-review.md). On, the review judges whether each chat got
 * the person where they wanted and its findings reach the operator's roll-up;
 * off, it reads metadata only. The line under the switch says which default
 * this deployment starts from: on for Vocion Cloud, off when self-hosted.
 * Shown to the Org's admins.
 */
export function OrgUsageReview() {
  const t = useTranslations('Members');
  const [state, setState] = useState<Setting | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => client.usageReview.setting()).then((s) => {
      if (!cancelled) {
        setState(s);
      }
    }).catch(() => { /* not reachable: nothing to show */ });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state?.canChange) {
    return null;
  }

  const change = async (on: boolean) => {
    setError(null);
    const before = state;
    setState({ ...state, on: state.overridden || on, chosen: on });
    try {
      setState(await client.usageReview.setSetting({ on }));
    } catch {
      setState(before);
      setError(t('usage_review_failed'));
    }
  };

  const line = state.on
    ? (state.defaultOn ? t('usage_review_on_cloud') : t('usage_review_on_self_hosted'))
    : (state.defaultOn ? t('usage_review_off_cloud') : t('usage_review_off_self_hosted'));
  const shown = state.chosen ?? state.on;

  return (
    <div className="mt-8 flex items-start justify-between gap-4 border-t border-border/60 pt-4" data-testid="org-usage-review">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{t('usage_review_title')}</p>
        <p className="text-xs text-muted-foreground">{line}</p>
        {state.overridden && <p className="text-xs text-muted-foreground">{t('usage_review_overridden')}</p>}
        {error && <p role="status" className="text-xs text-brand-fail">{error}</p>}
      </div>
      <Switch on={shown} label={t('usage_review_title')} onChange={on => void change(on)} />
    </div>
  );
}
