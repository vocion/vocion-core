'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * Workspace drift banner — on dashboard load, compare the workspace FILES'
 * sha with the last APPLIED sha for the active project. When they differ
 * (e.g. after a `git pull` that changed agent/mission YAML), offer a
 * one-click "Apply". Renders nothing when in sync, when the check isn't
 * available on this host, or after dismissal (per-session).
 *
 * Deliberately quiet: a one-line, muted, bottom-anchored strip with two text
 * buttons — housekeeping information, not an alert. (Downgraded from the
 * orange card per the 2026-07-20 mobile UX pass.)
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
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-md border border-border/70 bg-muted/95 px-3 py-2 shadow-sm backdrop-blur sm:inset-x-4 sm:bottom-4">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {state === 'error'
          ? `Apply failed — ${error}`
          : 'Workspace files changed — applied config is stale.'}
      </p>
      <button
        type="button"
        onClick={applyNow}
        disabled={state === 'applying'}
        className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-foreground transition hover:underline disabled:opacity-50"
      >
        {state === 'applying' && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
        {state === 'applying' ? 'Applying…' : 'Apply'}
      </button>
      <span className="text-xs text-muted-foreground/50" aria-hidden="true">·</span>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 text-xs text-muted-foreground transition hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  );
};
