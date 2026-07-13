'use client';

import { Loader2, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * Workspace drift banner — on dashboard load, compare the workspace FILES'
 * sha with the last APPLIED sha for the active project. When they differ
 * (e.g. after a `git pull` that changed agent/mission YAML), offer a
 * one-click "Apply + refresh". Renders nothing when in sync, when the
 * check isn't available on this host, or after dismissal (per-session).
 */
export const WorkspaceDriftBanner = () => {
  const [state, setState] = useState<'hidden' | 'drifted' | 'applying' | 'error'>('hidden');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem('vocion_drift_dismissed')) {
      return;
    }
    let cancelled = false;
    client.context.driftStatus().then((s) => {
      if (!cancelled && s.available && s.drifted) {
        setState('drifted');
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'hidden') {
    return null;
  }

  const applyNow = async () => {
    setState('applying');
    try {
      const result = await client.context.applyNow();
      if (result.errors.length > 0) {
        setError(`applied with ${result.errors.length} error(s) — check the server log`);
        setState('error');
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'apply failed');
      setState('error');
    }
  };

  const dismiss = () => {
    sessionStorage.setItem('vocion_drift_dismissed', '1');
    setState('hidden');
  };

  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-96 items-start gap-3 rounded-lg border border-amber-500/40 bg-background p-4 shadow-lg">
      <RefreshCw className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Workspace files changed</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {state === 'error'
            ? error
            : 'The workspace YAML on disk is newer than what\'s applied — agents, missions, or sources may be stale until you apply.'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={applyNow}
            disabled={state === 'applying'}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {state === 'applying' && <Loader2 className="size-3 animate-spin" />}
            {state === 'applying' ? 'Applying…' : 'Apply + refresh'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
};
