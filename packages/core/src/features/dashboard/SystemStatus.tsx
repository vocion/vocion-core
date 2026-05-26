'use client';

import { Activity, AlertTriangle, CheckCircle2, Database, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

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
    case 'up': return <CheckCircle2 className="size-4 stroke-green-600" />;
    case 'degraded': return <AlertTriangle className="size-4 stroke-amber-500" />;
    case 'down': return <XCircle className="size-4 stroke-red-500" />;
    default: return <Activity className="size-4 stroke-muted-foreground" />;
  }
};

const StatusBadge = ({ status }: { status: string }) => {
  const variants: Record<string, string> = {
    up: 'bg-green-100 text-green-800',
    degraded: 'bg-amber-100 text-amber-800',
    down: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${variants[status] ?? 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
};

export const SystemStatus = () => {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
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
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load status:
        {' '}
        {error}
      </div>
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
          <div className={`flex size-10 items-center justify-center rounded-full ${upCount === totalCount ? 'bg-green-100' : 'bg-amber-100'}`}>
            {upCount === totalCount
              ? <CheckCircle2 className="size-5 stroke-green-600" />
              : <AlertTriangle className="size-5 stroke-amber-600" />}
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
            { label: 'Temporal UI', url: 'http://localhost:8233' },
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
