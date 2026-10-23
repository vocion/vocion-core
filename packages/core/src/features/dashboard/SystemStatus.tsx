'use client';

import type { Tone } from '@/components/ui/status-pill';
import { Activity, AlertTriangle, CheckCircle2, Database, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { TONE } from '@/components/ui/status-pill';
import { cn } from '@/utils/Helpers';

type ServiceCheck = {
  name: string;
  url: string;
  externalUrl: string;
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
  details?: Record<string, unknown>;
};

type StatusData = {
  services: ServiceCheck[];
  db: Record<string, unknown>;
  retrieval: Record<string, unknown>;
  timestamp: string;
};

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'up': return <CheckCircle2 className="size-4 stroke-pass" />;
    case 'degraded': return <AlertTriangle className="size-4 stroke-warn" />;
    case 'down': return <XCircle className="size-4 stroke-fail" />;
    default: return <Activity className="size-4 stroke-muted-foreground" />;
  }
};

const StatusBadge = ({ status }: { status: string }) => {
  // Through Badge and the shared TONE sets (design sweep, 2026-10-23): the
  // old green-100 / red-100 pills were light-only.
  const variants: Record<string, Tone> = { up: 'pass', degraded: 'amber', down: 'fail' };
  const tone = TONE[variants[status] ?? 'neutral'];
  return (
    <Badge className={cn(tone.bg, tone.fg)}>
      {status}
    </Badge>
  );
};

export const SystemStatus = () => {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // One request at a time: a poll that outlives the interval must not start a
  // second one on top of it (2026-09-25, calls piled up and the app ran out of
  // heap).
  const inFlight = useRef(false);
  const fetchStatus = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/rpc/admin');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Running health checks...
      </div>
    );
  }

  if (error && !data) {
    return (
      <Notice tone="fail">
        Failed to load status:
        {' '}
        {error}
      </Notice>
    );
  }

  if (!data) {
    return null;
  }

  const upCount = data.services.filter(s => s.status === 'up').length;
  const totalCount = data.services.length;

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex size-10 items-center justify-center rounded-full ${upCount === totalCount ? 'bg-pass-soft' : 'bg-warn-soft'}`}>
            {upCount === totalCount
              ? <CheckCircle2 className="size-5 stroke-pass" />
              : <AlertTriangle className="size-5 stroke-warn" />}
          </div>
          <div>
            <div className="font-semibold">
              {upCount}
              /
              {totalCount}
              {' '}
              services healthy
            </div>
            <div className="text-xs text-muted-foreground">
              Last checked:
              {' '}
              {new Date(data.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchStatus}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Service grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.services.map(svc => (
          <div key={svc.name} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusIcon status={svc.status} />
                <span className="font-medium">{svc.name}</span>
              </div>
              <StatusBadge status={svc.status} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {svc.latencyMs}
                ms
              </span>
              {svc.externalUrl && (
                <a
                  href={svc.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  Open
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            {svc.details && Object.keys(svc.details).length > 0 && (
              <div className="mt-2 space-y-0.5">
                {Object.entries(svc.details).slice(0, 3).map(([k, v]) => (
                  <div key={k} className="text-[11px] text-muted-foreground">
                    {k}
                    :
                    {' '}
                    {String(v)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Data stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Retrieval (pgvector + FTS) */}
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Database className="size-4" />
            Retrieval (pgvector + FTS)
          </div>
          <div className="space-y-1">
            {Object.entries(data.retrieval).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-mono font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Vocion DB */}
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Database className="size-4" />
            Vocion Database
          </div>
          <div className="space-y-1">
            {Object.entries(data.db).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-mono font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 text-sm font-semibold">Platform Links</div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Vocion', url: 'http://localhost:3000' },
            { label: 'Langfuse', url: 'http://localhost:3200' },
          ].map(link => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              {link.label}
              <ExternalLink className="size-3 stroke-muted-foreground" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};
