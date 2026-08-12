'use client';

import type { SourceConfigField, SourceFormValue } from '@/libs/sources/configFields';
import { CheckCircle2, Globe, KeyRound, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/libs/I18nNavigation';
import { buildConfigFromFields, fieldInputDefault } from '@/libs/sources/configFields';

import { UI_FIELDS } from '@/libs/sources/uiFields';

type Source = {
  id: number;
  slug: string;
  kind: string;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  enabled: string;
  createdAt: string;
  authKind: 'none' | 'apikey' | 'oauth';
  objectType: string | null;
  documentCount: number;
  credentialConnected: boolean;
  credentialUpdatedAt: string | null;
};

type ConnectorTile = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  authKind: 'none' | 'apikey' | 'oauth';
  configFields: SourceConfigField[];
};

export function SourcesPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [connectors, setConnectors] = useState<ConnectorTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [addingKind, setAddingKind] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [connectingSource, setConnectingSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/rpc/sources');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to load sources');
        return;
      }
      setError(null);
      setSources(data.sources ?? []);
      setConnectors(data.connectors ?? []);
    } catch (err) {
      setError((err as Error).message);
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
        <p className="text-sm text-muted-foreground">
          Each source crawls a system and feeds chunks into the org's knowledge base. Native pgvector retrieval — no external services.
        </p>
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <Plus className="size-4" />
          Add source
        </button>
      </div>

      {error
        ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )
        : null}

      {loading
        ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
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
                    onConnect={() => setConnectingSource(s)}
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
              key={addingKind}
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
      {connectingSource
        ? (
            <ConnectCredentialDialog
              source={connectingSource}
              onClose={() => setConnectingSource(null)}
              onConnected={async () => {
                setConnectingSource(null);
                await refresh();
              }}
            />
          )
        : null}
    </div>
  );
}

function ConnectCredentialDialog({ source, onClose, onConnected }: {
  source: Source;
  onClose: () => void;
  onConnected: () => Promise<void> | void;
}) {
  const connectorSlug = ((source.config?._connector as string | undefined) ?? source.slug);
  const spec = UI_FIELDS[connectorSlug]?.credentials ?? { help: 'Paste the connector access token.', fields: [{ key: 'token', label: 'Token', type: 'password' as const }] };
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allFilled = spec.fields.every(f => (values[f.key] ?? '').trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const credentials: Record<string, string> = {};
      for (const field of spec.fields) {
        credentials[field.key] = (values[field.key] ?? '').trim();
      }
      const res = await fetch(`/rpc/sources/${source.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to store credential');
        return;
      }
      await onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <DialogTitle>
                Connect
                {' '}
                {source.slug}
              </DialogTitle>
            </div>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-xs text-muted-foreground">{spec.help}</p>
            {spec.fields.map(field => (
              <label key={field.key} className="block">
                <span className="text-sm font-medium text-foreground/80">{field.label}</span>
                <input
                  type={field.type === 'text' ? 'text' : 'password'}
                  required
                  autoComplete="off"
                  value={values[field.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.type === 'text' ? undefined : '••••••••••••••••'}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                />
              </label>
            ))}
            <p className="text-[11px] text-muted-foreground">Stored AES-GCM encrypted at rest — the token never touches logs or the browser again.</p>
            {error
              ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )
              : null}
          </DialogBody>
          <DialogFooter>
            <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !allFilled}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />}
              Save credential
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SourceRow({ source, syncing, onSync, onConnect }: {
  source: Source;
  syncing: boolean;
  onSync: () => void;
  onConnect: () => void;
}) {
  const last = source.lastSyncedAt ? new Date(source.lastSyncedAt) : null;
  const lastLabel = last ? formatRelative(last) : 'never';
  const needsCreds = source.authKind !== 'none' && !source.credentialConnected;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 flex-shrink-0 items-center justify-center rounded-md bg-amber-100/60 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          <Globe className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/sources/${source.slug}`} className="truncate font-display hover:underline">{source.slug}</Link>
            <Badge variant="outline" className="font-mono text-[10px]">{source.kind}</Badge>
            {source.objectType
              ? <Badge variant="outline" className="font-mono text-[10px]">{source.objectType}</Badge>
              : null}
          </div>
          <p className="mt-1 text-xs font-medium text-foreground/70">
            {source.documentCount > 0
              ? `${source.documentCount.toLocaleString()} document${source.documentCount === 1 ? '' : 's'} ingested`
              : 'No documents yet'}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {describeSourceConfig(source.config)}
          </p>
        </div>
        {source.authKind !== 'none'
          ? (
              source.credentialConnected
                ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-3.5" />
                      Connected
                    </span>
                  )
                : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <KeyRound className="size-3.5" />
                      Needs credentials
                    </span>
                  )
            )
          : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          Last sync ·
          {' '}
          {lastLabel}
        </Badge>
        <div className="flex items-center gap-2">
          {source.authKind !== 'none'
            ? (
                <button
                  type="button"
                  onClick={onConnect}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/50"
                >
                  <KeyRound className="size-3" />
                  {source.credentialConnected ? 'Update key' : 'Connect'}
                </button>
              )
            : null}
          <button
            type="button"
            onClick={onSync}
            disabled={syncing || needsCreds}
            title={needsCreds ? 'Connect credentials first' : undefined}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/50 disabled:opacity-50"
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
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? connectors.filter(c => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    : connectors;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent maxWidthClassName="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick a source type</DialogTitle>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-1 flex-col gap-3">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter sources…"
            className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="grid auto-rows-min gap-2 overflow-y-auto sm:grid-cols-2">
            {filtered.map(c => (
              <button
                type="button"
                key={c.slug}
                onClick={() => onPick(c.slug)}
                className="rounded-lg border p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-7 items-center justify-center rounded-md bg-amber-100/60 text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                    {c.icon.slice(0, 1)}
                  </span>
                  <span className="font-medium">{c.name}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{c.description}</p>
                {c.authKind !== 'none'
                  ? (
                      <Badge variant="outline" className="mt-2 text-[10px]">
                        {c.authKind === 'oauth' ? 'OAuth' : 'API key'}
                      </Badge>
                    )
                  : null}
              </button>
            ))}
            {filtered.length === 0
              ? (
                  <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                    No sources match "
                    {query}
                    "
                  </p>
                )
              : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function htmlInputTypeFor(fieldType: SourceConfigField['type']): 'number' | 'url' | 'text' {
  if (fieldType === 'number') {
    return 'number';
  }
  if (fieldType === 'url') {
    return 'url';
  }
  return 'text';
}

function ConfigFieldInput({ field, value, onChange }: {
  field: SourceConfigField;
  value: SourceFormValue;
  onChange: (value: SourceFormValue) => void;
}) {
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <label className="block">
        <span className="text-sm font-medium text-foreground/80">{field.label}</span>
        <select
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="block">
      <span className="text-sm font-medium text-foreground/80">{field.label}</span>
      <input
        type={htmlInputTypeFor(field.type)}
        required={field.required}
        value={(value as string) ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={field.placeholder}
        min={field.type === 'number' ? field.min : undefined}
        step={field.type === 'number' ? 1 : undefined}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      {field.help ? <span className="mt-1 block text-[11px] text-muted-foreground">{field.help}</span> : null}
    </label>
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
  const isWeb = kind === 'web';
  const fields = connector?.configFields ?? [];
  const [url, setUrl] = useState('');
  const [crawl, setCrawl] = useState(true);
  const [maxPages, setMaxPages] = useState(20);
  const [values, setValues] = useState<Record<string, SourceFormValue>>(
    () => Object.fromEntries(fields.map(f => [f.key, fieldInputDefault(f)])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFieldValue = (key: string, value: SourceFormValue) => setValues(v => ({ ...v, [key]: value }));
  // Reuse buildConfigFromFields' own emptiness rules (trims whitespace, collapses a
  // comma/space-only stringArray to []) so "is this required field actually filled in"
  // can't disagree with what submitting the form would actually send.
  const missingRequired = !isWeb && fields.some(f => f.required && buildConfigFromFields([f], values)[f.key] === undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let configJson: Record<string, unknown>;
      if (isWeb) {
        configJson = crawl ? { crawl: { startUrl: url, maxDepth: 1, maxPages } } : { urls: [url] };
      } else {
        configJson = buildConfigFromFields(fields, values);
      }
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>
              Add
              {' '}
              {connector?.name ?? kind}
              {' '}
              source
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {isWeb
              ? (
                  <>
                    <label className="block">
                      <span className="text-sm font-medium text-foreground/80">URL</span>
                      <input
                        type="url"
                        required
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="https://example.com/docs"
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={crawl} onChange={e => setCrawl(e.target.checked)} />
                      Crawl linked pages on the same origin
                    </label>
                    {crawl
                      ? (
                          <label className="block">
                            <span className="text-sm font-medium text-foreground/80">Max pages</span>
                            <input
                              type="number"
                              min={1}
                              max={200}
                              value={maxPages}
                              onChange={e => setMaxPages(Math.max(1, Math.min(200, Number.parseInt(e.target.value, 10) || 1)))}
                              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                          </label>
                        )
                      : null}
                  </>
                )
              : fields.map(field => (
                  <ConfigFieldInput
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    onChange={value => setFieldValue(field.key, value)}
                  />
                ))}
            {error
              ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )
              : null}
          </DialogBody>
          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (isWeb ? !url : missingRequired)}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
