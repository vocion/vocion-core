'use client';

import { Globe, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

type Source = {
  id: number;
  slug: string;
  kind: string;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  enabled: string;
  createdAt: string;
};

type ConnectorTile = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  authKind: 'none' | 'apikey' | 'oauth';
};

export function SourcesPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [connectors, setConnectors] = useState<ConnectorTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [addingKind, setAddingKind] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/rpc/sources');
      const data = await res.json();
      setSources(data.sources ?? []);
      setConnectors(data.connectors ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSync = useCallback(async (id: number) => {
    setSyncingId(id);
    setError(null);
    try {
      const res = await fetch(`/rpc/sources/${id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Sync failed');
      } else {
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Each source crawls a system and feeds chunks into the org's knowledge base. Native pgvector retrieval — no external services.
        </p>
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="bg-foreground text-background hover:bg-foreground/90 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
        >
          <Plus className="size-4" />
          Add source
        </button>
      </div>

      {error
        ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm">
              {error}
            </div>
          )
        : null}

      {loading
        ? (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading sources…
            </div>
          )
        : sources.length === 0
          ? (
              <EmptyState
                icon={Globe}
                title="No sources yet"
                description="Add a web URL, file upload, or connect a third-party system to populate this org's knowledge base."
                action={{ label: 'Add source', onClick: () => setPicker(true) }}
              />
            )
          : (
              <div className="grid gap-3 sm:grid-cols-2">
                {sources.map(s => (
                  <SourceRow
                    key={s.id}
                    source={s}
                    syncing={syncingId === s.id}
                    onSync={() => handleSync(s.id)}
                  />
                ))}
              </div>
            )}

      {picker
        ? (
            <ConnectorPicker
              connectors={connectors}
              onClose={() => setPicker(false)}
              onPick={(slug) => {
                setPicker(false);
                setAddingKind(slug);
              }}
            />
          )
        : null}
      {addingKind
        ? (
            <AddSourceDialog
              kind={addingKind}
              connector={connectors.find(c => c.slug === addingKind) ?? null}
              onClose={() => setAddingKind(null)}
              onAdded={async () => {
                setAddingKind(null);
                await refresh();
              }}
            />
          )
        : null}
    </div>
  );
}

function SourceRow({ source, syncing, onSync }: { source: Source; syncing: boolean; onSync: () => void }) {
  const last = source.lastSyncedAt ? new Date(source.lastSyncedAt) : null;
  const lastLabel = last ? formatRelative(last) : 'never';
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <span className="bg-amber-100/60 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 inline-flex size-9 flex-shrink-0 items-center justify-center rounded-md">
          <Globe className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display truncate">{source.slug}</span>
            <Badge variant="outline" className="font-mono text-[10px]">{source.kind}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
            {describeSourceConfig(source.config)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          Last sync ·
          {' '}
          {lastLabel}
        </Badge>
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className="hover:bg-muted/50 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {syncing
            ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Syncing…
                </>
              )
            : (
                <>
                  <RefreshCw className="size-3" />
                  Sync now
                </>
              )}
        </button>
      </div>
    </div>
  );
}

function describeSourceConfig(config: Record<string, unknown>): string {
  const c = config as { urls?: string[]; crawl?: { startUrl?: string; maxPages?: number } };
  if (c.crawl?.startUrl) {
    return `Crawl ${c.crawl.startUrl} · up to ${c.crawl.maxPages ?? 50} pages`;
  }
  if (c.urls?.length) {
    return c.urls.length === 1 ? c.urls[0]! : `${c.urls.length} URLs`;
  }
  return 'Configured source';
}

function ConnectorPicker({
  connectors,
  onClose,
  onPick,
}: {
  connectors: ConnectorTile[];
  onClose: () => void;
  onPick: (slug: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background w-full max-w-2xl rounded-xl border shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-display text-lg">Pick a source type</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">
            Cancel
          </button>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          {connectors.map(c => (
            <button
              type="button"
              key={c.slug}
              onClick={() => onPick(c.slug)}
              className="hover:bg-muted/50 hover:border-foreground/20 rounded-lg border p-3 text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="bg-amber-100/60 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 inline-flex size-7 items-center justify-center rounded-md text-sm font-medium">
                  {c.icon.slice(0, 1)}
                </span>
                <span className="font-medium">{c.name}</span>
              </div>
              <p className="text-muted-foreground mt-2 text-xs">{c.description}</p>
              {c.authKind !== 'none'
                ? (
                    <Badge variant="outline" className="mt-2 text-[10px]">
                      {c.authKind === 'oauth' ? 'OAuth' : 'API key'}
                    </Badge>
                  )
                : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddSourceDialog({
  kind,
  connector,
  onClose,
  onAdded,
}: {
  kind: string;
  connector: ConnectorTile | null;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const [url, setUrl] = useState('');
  const [crawl, setCrawl] = useState(true);
  const [maxPages, setMaxPages] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const configJson = crawl
        ? { crawl: { startUrl: url, maxDepth: 1, maxPages } }
        : { urls: [url] };
      const res = await fetch('/rpc/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, configJson }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create source');
        return;
      }
      await onAdded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background w-full max-w-md rounded-xl border shadow-xl">
        <form onSubmit={submit}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-display text-lg">
              Add
              {' '}
              {connector?.name ?? kind}
              {' '}
              source
            </h3>
          </div>
          <div className="space-y-4 p-4">
            <label className="block">
              <span className="text-foreground/80 text-sm font-medium">URL</span>
              <input
                type="url"
                required
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/docs"
                className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={crawl} onChange={e => setCrawl(e.target.checked)} />
              Crawl linked pages on the same origin
            </label>
            {crawl
              ? (
                  <label className="block">
                    <span className="text-foreground/80 text-sm font-medium">Max pages</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={maxPages}
                      onChange={e => setMaxPages(Math.max(1, Math.min(200, Number.parseInt(e.target.value, 10) || 1)))}
                      className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    />
                  </label>
                )
              : null}
            {error
              ? (
                  <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm">
                    {error}
                  </div>
                )
              : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground rounded-full px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !url}
              className="bg-foreground text-background hover:bg-foreground/90 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting
                ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Adding…
                    </>
                  )
                : 'Add source'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) {
    return 'just now';
  }
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
