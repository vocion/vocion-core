'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { client } from '@/libs/Orpc';

/**
 * "Include in members' Personal" — one Org's say in what its members' one
 * Personal reads (`services/personal/reach.ts`). On: its items show in Personal
 * with their content, labelled with this Org. Off, for a client whose contract
 * forbids aggregation: Personal shows only how many wait here, with a link in.
 * Shown to the Org's admins, and only where there are several Orgs at all.
 */
export function OrgPersonalReach() {
  const t = useTranslations('Members');
  const [state, setState] = useState<{ include: boolean; canChange: boolean; applies: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => client.personal.orgReach()).then((s) => {
      if (!cancelled) {
        setState(s);
      }
    }).catch(() => { /* not an admin, or not reachable: nothing to show */ });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state?.applies || !state.canChange) {
    return null;
  }

  const change = async (include: boolean) => {
    setError(null);
    const before = state;
    setState({ ...state, include });
    try {
      await client.personal.setOrgReach({ include });
    } catch {
      setState(before);
      setError(t('personal_reach_failed'));
    }
  };

  return (
    <div className="mt-8 flex items-start justify-between gap-4 border-t border-border/60 pt-4" data-testid="org-personal-reach">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{t('personal_reach_title')}</p>
        <p className="text-xs text-muted-foreground">{state.include ? t('personal_reach_on') : t('personal_reach_off')}</p>
        {error && <p role="status" className="text-xs text-brand-fail">{error}</p>}
      </div>
      <Switch on={state.include} label={t('personal_reach_title')} onChange={on => void change(on)} />
    </div>
  );
}
