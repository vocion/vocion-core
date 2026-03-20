'use client';

import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

type IndexingProgress = {
  status: string;
  docsIndexed: number;
  batchesCompleted: number;
  failures: number;
  newDocs: number;
};

type Connector = {
  id: number;
  name: string;
  source: string;
  status: string;
  lastAttemptStatus: string | null;
  docsIndexed: number;
  lastIndexed: string | null;
  refreshFreq: number | null;
  inRepeatedError: boolean;
  indexing: IndexingProgress | null;
};

const statusConfig: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20' },
  PAUSED: { label: 'Paused', className: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20' },
  DELETING: { label: 'Deleting', className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20' },
  unknown: { label: 'Unknown', className: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
};

const sourceConfig: Record<string, { label: string; color: string; icon: string }> = {
  hubspot: { label: 'HubSpot', color: '#FF7A59', icon: 'H' },
  google_drive: { label: 'Google Drive', color: '#4285F4', icon: 'G' },
  gmail: { label: 'Gmail', color: '#EA4335', icon: 'M' },
  zoom: { label: 'Zoom', color: '#2D8CFF', icon: 'Z' },
  slack: { label: 'Slack', color: '#4A154B', icon: 'S' },
  salesforce: { label: 'Salesforce', color: '#00A1E0', icon: 'S' },
  jira: { label: 'Jira', color: '#0052CC', icon: 'J' },
  notion: { label: 'Notion', color: '#000000', icon: 'N' },
  confluence: { label: 'Confluence', color: '#1868DB', icon: 'C' },
  github: { label: 'GitHub', color: '#24292F', icon: 'G' },
  zendesk: { label: 'Zendesk', color: '#03363D', icon: 'Z' },
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) {
    return null;
  }
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const SourceIcon = ({ source }: { source: string }) => {
  const config = sourceConfig[source];
  if (!config) {
    return (
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground">
        ?
      </div>
    );
  }
  return (
    <div
      className="flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white"
      style={{ backgroundColor: config.color }}
    >
      {config.icon}
    </div>
  );
};

export const LiveConnectors = () => {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [vespaChunks, setVespaChunks] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    try {
      const res = await fetch('/rpc/onyx/connectors');
      const data = await res.json();
      setConnectors(data.connectors || []);
      setVespaChunks(data.vespaChunks ?? 0);
      setError(data.error || null);
    } catch {
      setError('Failed to fetch connector status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
    const interval = setInterval(fetchConnectors, 10000);
    return () => clearInterval(interval);
  }, [fetchConnectors]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin stroke-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading connectors...</span>
      </div>
    );
  }

  if (connectors.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <div className="text-sm text-muted-foreground">
          {error || 'No connectors configured yet.'}
        </div>
        <a
          href="http://localhost:3100/admin/add-connector"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Add Connector in Onyx
          <ExternalLink className="size-3" />
        </a>
      </div>
    );
  }

  const totalDocs = connectors.reduce((sum, c) => sum + c.docsIndexed, 0);

  return (
    <div>
      {/* Summary bar */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{connectors.length}</span>
            {' '}
            connectors
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{totalDocs.toLocaleString()}</span>
            {' '}
            docs in DB
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{vespaChunks.toLocaleString()}</span>
            {' '}
            searchable chunks
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="http://localhost:3100/admin/indexing/status"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Onyx Admin
            <ExternalLink className="size-3" />
          </a>
          <a
            href="http://localhost:5555"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Flower
            <ExternalLink className="size-3" />
          </a>
          <button type="button" onClick={fetchConnectors} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Connector cards */}
      <div className="space-y-3">
        {connectors.map((c) => {
          const s = statusConfig[c.status] || statusConfig.unknown;
          const sourceLabel = sourceConfig[c.source]?.label || c.source;
          const lastDate = formatDate(c.lastIndexed);

          return (
            <div
              key={c.id}
              className="rounded-lg border border-border p-4 transition-colors hover:bg-muted/20"
            >
              <div className="flex items-center gap-4">
                <SourceIcon source={c.source} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold">{c.name}</span>
                    <Badge variant="outline" className="text-[10px]">{sourceLabel}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground">{c.docsIndexed.toLocaleString()}</span>
                      {' '}
                      docs indexed
                    </span>
                    {lastDate && (
                      <span>
                        Last indexed:
                        {' '}
                        {lastDate}
                      </span>
                    )}
                    {c.refreshFreq && (
                      <span>
                        Refreshes every
                        {' '}
                        {c.refreshFreq >= 3600 ? `${Math.round(c.refreshFreq / 3600)}h` : `${Math.round(c.refreshFreq / 60)}m`}
                      </span>
                    )}
                  </div>
                </div>

                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${s?.className ?? ''}`}>
                  {s?.label ?? c.status}
                </span>
              </div>

              {/* Indexing status bar */}
              <div className="mt-3 rounded-md bg-muted/30 p-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    {c.lastAttemptStatus === 'in_progress'
                      ? <><div className="size-2 animate-pulse rounded-full bg-green-500" /><span className="font-medium text-green-700">Indexing</span></>
                      : c.lastAttemptStatus === 'not_started'
                        ? <><div className="size-2 rounded-full bg-amber-400" /><span className="font-medium text-amber-700">Queued</span></>
                        : c.lastAttemptStatus === 'success'
                          ? <><div className="size-2 rounded-full bg-green-500" /><span className="text-muted-foreground">Up to date</span></>
                          : c.lastAttemptStatus === 'canceled'
                            ? <><div className="size-2 rounded-full bg-muted-foreground/30" /><span className="text-muted-foreground">Idle (last: canceled)</span></>
                            : <><div className="size-2 rounded-full bg-muted-foreground/30" /><span className="text-muted-foreground">{c.lastAttemptStatus ?? 'No data'}</span></>}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {c.indexing && c.indexing.docsIndexed > 0 && (
                      <span>{c.indexing.docsIndexed.toLocaleString()} processing</span>
                    )}
                  </div>
                </div>
              </div>

              {c.inRepeatedError && (
                <div className="mt-2 rounded-md bg-red-500/5 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
                  Connector is in a repeated error state. Check Onyx admin for details.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
