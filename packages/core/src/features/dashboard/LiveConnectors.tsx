'use client';
/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, style/max-statements-per-line */

import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Loader2, MoreVertical, Pause, Play, RefreshCw, RotateCcw, Square, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

type Connector = {
  id: number; // cc_pair_id
  connectorId: number | null;
  credentialIds: number[];
  name: string;
  source: string;
  status: string; // ACTIVE, PAUSED, INITIAL_INDEXING, DELETING, etc.
  lastAttemptStatus: string | null; // in_progress, not_started, success, failed, canceled
  lastFinishedStatus: string | null; // last completed attempt: success, failed, canceled
  lastSuccess: string | null; // ISO timestamp of last successful index
  docsIndexed: number;
  latestAttemptDocs: number;
  lastIndexed: string | null;
  refreshFreq: number | null;
  inProgress: boolean;
  inRepeatedError: boolean;
  lastError?: {
    message: string | null;
    time: string | null;
    docsIndexed: number;
  } | null;
  indexingProgress?: {
    newDocsIndexed: number;
    totalDocsIndexed: number;
    docsRemoved: number;
    errorCount: number;
    timeStarted: string | null;
    timeUpdated: string | null;
  } | null;
};

const statusConfig: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20' },
  INITIAL_INDEXING: { label: 'Initial Indexing', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20' },
  SCHEDULED: { label: 'Scheduled', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20' },
  PAUSED: { label: 'Paused', className: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20' },
  DELETING: { label: 'Deleting', className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20' },
  INVALID: { label: 'Invalid', className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20' },
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

const timeAgo = (dateStr: string | null) => {
  if (!dateStr) {
    return null;
  }
  const d = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) {
    return 'just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
};

const SourceIcon = ({ source }: { source: string }) => {
  const config = sourceConfig[source];
  if (!config) {
    return (
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground">?</div>
    );
  }
  return (
    <div className="flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: config.color }}>
      {config.icon}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Connector action menu                                               */
/* ------------------------------------------------------------------ */

const ConnectorActions = ({ connector, onAction }: { connector: Connector; onAction: (action: string, c: Connector) => void }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 z-50 mt-1 w-52 rounded-lg border border-border bg-popover p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setOpen(false); onAction('reindex_incremental', connector);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <RefreshCw className="size-3.5" />
              Re-index (incremental)
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false); onAction('reindex_full', connector);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <RotateCcw className="size-3.5" />
              Re-index (full)
            </button>
            <div className="my-1 border-t border-border" />
            {connector.inProgress
              ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false); onAction('cancel', connector);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-500/10"
                  >
                    <Square className="size-3.5" />
                    Cancel indexing
                  </button>
                )
              : connector.status === 'PAUSED'
                ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false); onAction('resume', connector);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                    >
                      <Play className="size-3.5" />
                      Resume connector
                    </button>
                  )
                : (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false); onAction('pause', connector);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-yellow-600 transition-colors hover:bg-yellow-500/10"
                    >
                      <Pause className="size-3.5" />
                      Pause connector
                    </button>
                  )}
          </div>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Error details (collapsible)                                         */
/* ------------------------------------------------------------------ */

const ConnectorErrorDetails = ({ connector: c }: { connector: Connector }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md bg-red-500/5 px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
      >
        {expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <AlertTriangle className="size-3.5 shrink-0" />
        <span className="flex-1">
          {c.inRepeatedError
            ? 'Connector in repeated error state'
            : 'Last sync failed'}
          {c.lastError?.time && ` — ${formatDate(c.lastError.time)}`}
        </span>
      </button>
      {expanded && c.lastError?.message && (
        <div className="mt-1 rounded-md border border-red-500/10 bg-red-500/5 p-3">
          <pre className="font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-red-600/80 dark:text-red-400/80">
            {c.lastError.message}
          </pre>
          {c.lastError.docsIndexed > 0 && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              {c.lastError.docsIndexed.toLocaleString()}
              {' '}
              docs indexed before failure
            </div>
          )}
        </div>
      )}
      {expanded && !c.lastError?.message && (
        <div className="mt-1 rounded-md border border-red-500/10 bg-red-500/5 p-3 text-[11px] text-muted-foreground">
          No error details available. Check Onyx admin for more info.
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Indexing status bar                                                  */
/* ------------------------------------------------------------------ */

const IndexingStatusBar = ({ c }: { c: Connector }) => {
  // Determine the status to display
  const isIndexing = c.inProgress || c.lastAttemptStatus === 'in_progress';
  const isQueued = c.lastAttemptStatus === 'not_started' && !c.inProgress;
  const lastFailed = c.lastFinishedStatus === 'failed';
  const lastCanceled = c.lastFinishedStatus === 'canceled';
  const lastSuccess = c.lastFinishedStatus === 'success' || (c.lastSuccess && !lastFailed && !lastCanceled && !isIndexing && !isQueued);

  return (
    <div className="mt-3 rounded-md bg-muted/30 p-2.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {isIndexing
            ? (
                <>
                  <div className="size-2 animate-pulse rounded-full bg-green-500" />
                  <span className="font-medium text-green-700 dark:text-green-400">Indexing</span>
                  {c.indexingProgress
                    ? (
                        <span className="text-muted-foreground">
                          {c.indexingProgress.newDocsIndexed.toLocaleString()}
                          {' '}
                          new
                          {c.indexingProgress.totalDocsIndexed !== c.indexingProgress.newDocsIndexed && (
                            <>
                              {' '}
                              /
                              {c.indexingProgress.totalDocsIndexed.toLocaleString()}
                              {' '}
                              total
                            </>
                          )}
                          {' '}
                          docs
                          {c.indexingProgress.docsRemoved > 0 && (
                            <>
                              ,
                              {c.indexingProgress.docsRemoved}
                              {' '}
                              removed
                            </>
                          )}
                          {c.indexingProgress.errorCount > 0 && (
                            <>
                              ,
                              {c.indexingProgress.errorCount}
                              {' '}
                              errors
                            </>
                          )}
                          {c.indexingProgress.timeStarted && (
                            <>
                              {' '}
                              &middot; started
                              {timeAgo(c.indexingProgress.timeStarted)}
                            </>
                          )}
                        </span>
                      )
                    : c.latestAttemptDocs > 0
                      ? (
                          <span className="text-muted-foreground">
                            (
                            {c.latestAttemptDocs.toLocaleString()}
                            {' '}
                            docs this run)
                          </span>
                        )
                      : null}
                </>
              )
            : isQueued
              ? (
                  <>
                    <div className="size-2 rounded-full bg-amber-400" />
                    <span className="font-medium text-amber-700 dark:text-amber-400">Queued</span>
                  </>
                )
              : lastFailed
                ? (
                    <>
                      <XCircle className="size-3.5 text-red-500" />
                      <span className="font-medium text-red-600 dark:text-red-400">Last sync failed</span>
                      {c.lastSuccess && (
                        <span className="text-muted-foreground">
                          (last success:
                          {' '}
                          {formatDate(c.lastSuccess)}
                          )
                        </span>
                      )}
                      {!c.lastSuccess && (
                        <span className="text-muted-foreground">(never completed successfully)</span>
                      )}
                    </>
                  )
                : lastCanceled
                  ? (
                      <>
                        <div className="size-2 rounded-full bg-muted-foreground/30" />
                        <span className="text-muted-foreground">Last sync canceled</span>
                        {c.lastSuccess && (
                          <span className="text-muted-foreground">
                            (last success:
                            {' '}
                            {formatDate(c.lastSuccess)}
                            )
                          </span>
                        )}
                      </>
                    )
                  : lastSuccess
                    ? (
                        <>
                          <div className="size-2 rounded-full bg-green-500" />
                          <span className="text-muted-foreground">Up to date</span>
                          {c.lastSuccess && (
                            <span className="text-muted-foreground">
                              (
                              {timeAgo(c.lastSuccess)}
                              )
                            </span>
                          )}
                        </>
                      )
                    : (
                        <>
                          <div className="size-2 rounded-full bg-muted-foreground/30" />
                          <span className="text-muted-foreground">{c.lastAttemptStatus ?? 'Waiting for first sync'}</span>
                        </>
                      )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export const LiveConnectors = () => {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [vespaChunks, setVespaChunks] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

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

  const handleAction = async (action: string, connector: Connector) => {
    setActionFeedback(`Running ${action.replace('_', ' ')} on ${connector.name}...`);
    try {
      const res = await fetch('/rpc/onyx/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ccPairId: connector.id,
          connectorId: connector.connectorId,
          credentialIds: connector.credentialIds,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setActionFeedback(`Error: ${data.error}`);
      } else {
        setActionFeedback(`${action.replace('_', ' ')} started for ${connector.name}`);
        // Refresh immediately
        fetchConnectors();
      }
    } catch (err: any) {
      setActionFeedback(`Error: ${err.message}`);
    }
    setTimeout(() => setActionFeedback(null), 5000);
  };

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
  const failedCount = connectors.filter(c => c.lastFinishedStatus === 'failed').length;

  return (
    <div>
      {/* Action feedback toast */}
      {actionFeedback && (
        <div className="mb-3 rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">
          {actionFeedback}
        </div>
      )}

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
          {failedCount > 0 && (
            <div className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="size-3.5" />
              <span className="font-medium">
                {failedCount}
                {' '}
                failed
              </span>
            </div>
          )}
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
              key={`${c.source}-${c.id}`}
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

                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${s?.className ?? ''}`}>
                    {s?.label ?? c.status}
                  </span>
                  <ConnectorActions connector={c} onAction={handleAction} />
                </div>
              </div>

              <IndexingStatusBar c={c} />

              {(c.lastError || c.inRepeatedError) && (
                <ConnectorErrorDetails connector={c} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
