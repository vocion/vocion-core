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
  // The members list renders only while an admin is choosing, so the page
  // never shows everyone's names twice (the People list already does).
  const [choosing, setChoosing] = useState(false);

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
      setChoosing(false);
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
      {state.canChange && state.members.length > 0 && !choosing && (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          className="h-8 shrink-0 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-surface-soft focus:ring-2 focus:ring-ring/30 focus:outline-none"
        >
          {state.person ? t('accountable_change') : t('accountable_choose')}
        </button>
      )}
      {state.canChange && choosing && (
        <select
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own tap
          autoFocus
          value={state.person?.userId ?? ''}
          disabled={saving}
          aria-label={t('accountable_title')}
          onChange={e => e.target.value && void change(e.target.value)}
          onBlur={() => !saving && setChoosing(false)}
          className="h-8 max-w-full rounded-md bg-surface-soft px-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
        >
          {!state.person && <option value="">{t('accountable_choose')}</option>}
          {state.members.map(m => <option key={m.userId} value={m.userId}>{label(m)}</option>)}
        </select>
      )}
    </div>
  );
}
