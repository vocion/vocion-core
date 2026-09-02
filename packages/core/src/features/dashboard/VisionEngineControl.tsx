'use client';

import { Loader2, Power, PowerOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * The classifier switch. Shows whether the workspace's trained Rekognition
 * model is RUNNING (Analyze runs the hybrid: Claude Vision + classifier) or
 * stopped (Claude Vision alone), and lets a person start or stop it. Polls
 * while the endpoint is in a transitional state — starting takes several
 * minutes and bills per hour once up.
 * @param props
 * @param props.compact
 */
export type VisionModelStatus = {
  configured: boolean;
  status?: string;
  statusMessage?: string | null;
  f1?: number | null;
  since?: string | null;
  hybrid?: boolean;
  versionArn?: string | null;
};

export function useVisionModel(pollMs = 15_000) {
  const [state, setState] = useState<VisionModelStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/vision/model', { cache: 'no-store' });
      const body = (await res.json()) as VisionModelStatus & { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      setState(body);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const transitional = state?.status === 'STARTING' || state?.status === 'STOPPING' || state?.status === 'TRAINING_IN_PROGRESS';
    const t = setInterval(() => void refresh(), transitional ? 10_000 : pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs, state?.status]);
  return { state, error, refresh };
}

export function VisionEngineControl({ compact = false }: { compact?: boolean }) {
  const { state, error, refresh } = useVisionModel();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function flip(action: 'start' | 'stop') {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch('/api/v1/vision/model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = state?.status ?? (error ? 'ERROR' : 'LOADING');
  const running = status === 'RUNNING';
  const transitional = status === 'STARTING' || status === 'STOPPING';
  const canStart = status === 'TRAINING_COMPLETED' || status === 'STOPPED';
  const tone = running ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700' : transitional ? 'border-amber-600/40 bg-amber-500/10 text-amber-700' : 'border-border bg-muted/40 text-muted-foreground';
  const label = running ? 'Running' : status === 'STARTING' ? 'Starting…' : status === 'STOPPING' ? 'Stopping…' : status === 'TRAINING_IN_PROGRESS' ? 'Training…' : status === 'TRAINING_COMPLETED' || status === 'STOPPED' ? 'Off' : status === 'LOADING' ? '…' : status;

  return (
    <div className={`rounded-lg border border-border ${compact ? 'p-3' : 'p-4'} bg-background`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Engines
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
              <span className={`size-1.5 rounded-full ${running ? 'bg-emerald-500' : transitional ? 'animate-pulse bg-amber-500' : 'bg-muted-foreground/50'}`} aria-hidden />
              Rekognition classifier
              {' '}
              {label}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {running
              ? 'Analyze runs the hybrid: Claude Vision names the region, the Rekognition classifier gives a second opinion, disagreements are held for a person. The endpoint bills per hour while it runs.'
              : transitional
                ? 'Endpoint is changing state — a few minutes. Analyze keeps working on Claude Vision alone meanwhile.'
                : status === 'TRAINING_IN_PROGRESS'
                  ? 'Model is still training. Analyze runs on Claude Vision alone.'
                  : 'Analyze runs on Claude Vision alone (reference comparison). Start the classifier to add the Rekognition second opinion.'}
            {typeof state?.f1 === 'number' && !compact && ` Test F1 ${state.f1.toFixed(2)} on a small held-out set.`}
          </p>
          {(error || actionError) && <p className="mt-1 text-xs text-red-600">{actionError ?? error}</p>}
        </div>
        <div className="flex items-center gap-2">
          <a href="/dashboard/models" className="text-xs underline-offset-2 hover:underline">Model details</a>
          {running || status === 'STARTING'
            ? (
                <button type="button" disabled={busy || status === 'STARTING'} onClick={() => flip('stop')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50">
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PowerOff className="size-3.5" aria-hidden />}
                  Stop classifier
                </button>
              )
            : (
                <button type="button" disabled={busy || !canStart} onClick={() => flip('start')} title={canStart ? 'Start the Rekognition endpoint (~10 min to come up; bills per hour)' : `Cannot start from ${status}`} className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:bg-foreground/90 disabled:opacity-50">
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Power className="size-3.5" aria-hidden />}
                  Start classifier
                </button>
              )}
        </div>
      </div>
    </div>
  );
}
