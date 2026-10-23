'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { client } from '@/libs/Orpc';

/**
 * "Members' own connections" — this workspace's say in whether a server the
 * Org declares elsewhere, one that answers each person as themselves, joins a
 * member's turn here (`services/outboundMcp/followingSources.ts`). On, a
 * member's own sign-in answers their own turns here. Off, for a workspace
 * whose shared records must not draw on members' own access. Everyone sees
 * which it is; an admin changes it.
 */
export function MembersOwnConnections() {
  const t = useTranslations('Connectors');
  const [state, setState] = useState<{ on: boolean; canChange: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => client.connect.membersOwnConnections()).then((s) => {
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

  const change = async (on: boolean) => {
    setError(null);
    const before = state;
    setState({ ...state, on });
    try {
      await client.connect.setMembersOwnConnections({ on });
    } catch {
      setState(before);
      setError(t('members_own_failed'));
    }
  };

  return (
    <div className="mt-8 flex items-start justify-between gap-4 border-t border-border/60 pt-4" data-testid="members-own-connections">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{t('members_own_title')}</p>
        <p className="text-xs text-muted-foreground">{state.on ? t('members_own_on') : t('members_own_off')}</p>
        {error && <p role="status" className="text-xs text-brand-fail">{error}</p>}
      </div>
      <Switch on={state.on} disabled={!state.canChange} label={t('members_own_title')} onChange={on => void change(on)} />
    </div>
  );
}
