'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';

type Person = { userId: string; name: string | null; email: string | null };
type State = { person: Person | null; canChange: boolean; members: Person[] };

const label = (p: Person) => p.name?.trim() || p.email || p.userId;

/**
 * "Accountable person" — who this workspace's updates are mailed to when a
 * mission or report names no address (`services/workspace/accountable.ts`).
 * Everyone sees who it is; an admin picks from the Org's members.
 */
export function AccountablePerson() {
  const t = useTranslations('Members');
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => client.members.accountable()).then((s) => {
      if (!cancelled) {
        setState(s);
      }
    }).catch(() => { /* not reachable: nothing to show */ });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) {
    return null;
  }

  const change = async (userId: string) => {
    setError(null);
    setSaving(true);
    try {
      const { person } = await client.members.setAccountable({ userId });
      setState({ ...state, person });
    } catch {
      setError(t('accountable_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8 flex flex-wrap items-start justify-between gap-4 border-t border-border/60 pt-4" data-testid="accountable-person">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{t('accountable_title')}</p>
        <p className="text-xs text-muted-foreground">
          {state.person ? t('accountable_who', { name: label(state.person) }) : t('accountable_none')}
        </p>
        {error && <p role="status" className="text-xs text-brand-fail">{error}</p>}
      </div>
      {state.canChange && state.members.length > 0 && (
        <select
          value={state.person?.userId ?? ''}
          disabled={saving}
          aria-label={t('accountable_title')}
          onChange={e => e.target.value && void change(e.target.value)}
          className="h-8 max-w-full rounded-md bg-surface-soft px-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
        >
          {!state.person && <option value="">{t('accountable_choose')}</option>}
          {state.members.map(m => <option key={m.userId} value={m.userId}>{label(m)}</option>)}
        </select>
      )}
    </div>
  );
}
