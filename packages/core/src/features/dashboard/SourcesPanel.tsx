'use client';

import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  CircleAlert,
  Contact,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Plug,
  Plus,
  RefreshCw,
  Search,
  SquareKanban,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/libs/I18nNavigation';

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

/** Connector-specific credential fields. Most read a single `token`; some take a full key set. */
type CredField = { key: string; label: string; optional?: boolean };
const TOKEN_FIELD: CredField = { key: 'token', label: 'Token' };
const CRED_FIELDS: Record<string, { help: string; fields: CredField[] }> = {
  hubspot: { help: 'HubSpot → Settings → Integrations → Private Apps. Needs crm.objects read (+ write for gated updates).', fields: [{ key: 'token', label: 'Private-app token' }] },
  slack: { help: 'Slack app → OAuth & Permissions → Bot User OAuth Token (xoxb-…).', fields: [{ key: 'token', label: 'Bot / user token' }] },
  gmail: { help: 'A Google OAuth access token with gmail.readonly. (Full OAuth sign-in flow is coming; paste a token to start.)', fields: [{ key: 'token', label: 'OAuth access token' }] },
  drive: { help: 'A Google OAuth access token with drive.readonly.', fields: [{ key: 'token', label: 'OAuth access token' }] },
  ga4: { help: 'A Google OAuth access token with analytics.readonly.', fields: [{ key: 'token', label: 'OAuth access token' }] },
  googleAds: { help: 'A Google Ads OAuth access token.', fields: [{ key: 'token', label: 'OAuth access token' }, { key: 'developerToken', label: 'Developer token', optional: true }] },
  strapi: { help: 'Strapi admin → Settings → API Tokens → Create new API Token. Read-only is enough — this connector never writes back.', fields: [{ key: 'token', label: 'API token' }] },
  zoom: { help: 'Zoom App Marketplace → Develop → Build App → Server-to-Server OAuth. Needs scopes user:read:admin + cloud_recording:read:admin. All three values are on the app\'s Credentials page.', fields: [{ key: 'accountId', label: 'Account ID' }, { key: 'clientId', label: 'Client ID' }, { key: 'clientSecret', label: 'Client secret' }] },
};

function ConnectCredentialDialog({ source, onClose, onConnected }: {
  source: Source;
  onClose: () => void;
  onConnected: () => Promise<void> | void;
}) {
  const connectorSlug = ((source.config?._connector as string | undefined) ?? source.slug);
  const spec = CRED_FIELDS[connectorSlug] ?? { help: 'Paste the connector access token.', fields: [TOKEN_FIELD] };
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = spec.fields.every(f => f.optional || (values[f.key] ?? '').trim() !== '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const credentials: Record<string, string> = {};
      for (const f of spec.fields) {
        const v = (values[f.key] ?? '').trim();
        if (v) {
          credentials[f.key] = v;
        }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border bg-background shadow-xl">
        <form onSubmit={submit}>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <KeyRound className="size-4 text-muted-foreground" />
            <h3 className="font-display text-lg">
              Connect
              {' '}
              {source.slug}
            </h3>
          </div>
          <div className="space-y-4 p-4">
            <p className="text-xs text-muted-foreground">{spec.help}</p>
            {spec.fields.map(field => (
              <label key={field.key} className="block">
                <span className="text-sm font-medium text-foreground/80">{field.label}</span>
                <input
                  type="password"
                  required={!field.optional}
                  autoComplete="off"
                  value={values[field.key] ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder="••••••••••••••••"
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
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
            <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !complete}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />}
              Save credential
            </button>
          </div>
        </form>
      </div>
    </div>
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

/**
 * How many connector cards render before the picker asks for a click to show
 * more. The registry is small today but grows with every connector shipped, and
 * a modal that paints a hundred cards on open is the cost nobody notices until
 * it is slow. Rendering a page at a time keeps the open instant without pulling
 * in a virtual-list dependency; the search box is what makes a long list usable.
 */
const CONNECTOR_PAGE_SIZE = 25;

/**
 * The Lucide icons connectors name in their `icon` field (`libs/sources/*.ts`).
 * Listed explicitly rather than looked up off the whole Lucide namespace, which
 * would pull every icon in the library into the client bundle. A connector whose
 * icon is missing here gets the generic plug rather than nothing.
 */
const CONNECTOR_ICONS: Record<string, LucideIcon> = {
  BarChart3,
  Calendar,
  Contact,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  Globe,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  SquareKanban,
  Video,
};

/**
 * A connector's icon. The `icon` field carries a Lucide icon NAME, so rendering
 * it as text used to print its first letter — "D" on the Strapi tile, from
 * `Database`, which reads like a shortcut key and means nothing.
 * @param props.name - The Lucide icon name from the connector's tile data.
 * @param root0
 * @param root0.name
 */
function ConnectorIcon({ name }: { name: string }) {
  const Icon = CONNECTOR_ICONS[name] ?? Plug;
  return <Icon className="size-4" aria-hidden="true" />;
}

/**
 * Connectors whose name, slug or description contains every word in the query,
 * sorted A–Z by name. Word-at-a-time (rather than one substring match) so
 * "google ads" finds the Google Ads tile whichever order the words are typed.
 * An empty query matches everything, which is what the picker shows on open.
 *
 * Alphabetical rather than registry order: the registry is append-ordered by
 * when each connector shipped, which tells an operator scanning the list
 * nothing, and the order shifts under them every time one is added.
 * @param connectors - Every connector the server offers as a tile.
 * @param query - What the operator typed in the picker's search box.
 */
export function filterConnectors(connectors: ConnectorTile[], query: string): ConnectorTile[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 0);
  const matches = words.length === 0
    ? [...connectors]
    : connectors.filter((connector) => {
        const haystack = `${connector.name} ${connector.slug} ${connector.description}`.toLowerCase();
        return words.every(word => haystack.includes(word));
      });
  return matches.sort((left, right) => left.name.localeCompare(right.name));
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
  const [visibleCount, setVisibleCount] = useState(CONNECTOR_PAGE_SIZE);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The picker opens for this input — typing straight away is the point. Done
  // with a ref rather than `autoFocus`, which the a11y lint rules bar.
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const matches = useMemo(() => filterConnectors(connectors, query), [connectors, query]);
  const visible = matches.slice(0, visibleCount);
  const hiddenCount = matches.length - visible.length;

  // A new query starts a fresh page — otherwise a search run after "Show more"
  // would keep the taller list height for a two-result match.
  const changeQuery = (next: string) => {
    setQuery(next);
    setVisibleCount(CONNECTOR_PAGE_SIZE);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-display text-lg">Pick a source type</h3>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
        <div className="border-b px-4 py-3">
          <label className="relative block">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={e => changeQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onClose();
                }
              }}
              placeholder="Search source types — name or what it ingests"
              aria-label="Search source types"
              className="w-full rounded-md border border-input bg-background py-2 pr-3 pl-9 text-sm"
            />
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            {matches.length === connectors.length
              ? `${connectors.length} source types`
              : `${matches.length} of ${connectors.length} source types`}
          </p>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto p-4">
          {visible.map(c => (
            <button
              type="button"
              key={c.slug}
              onClick={() => onPick(c.slug)}
              className="rounded-lg border p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex size-7 items-center justify-center rounded-md bg-amber-100/60 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                  <ConnectorIcon name={c.icon} />
                </span>
                <span className="font-medium">{c.name}</span>
                {c.authKind !== 'none'
                  ? (
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {c.authKind === 'oauth' ? 'OAuth' : 'API key'}
                      </Badge>
                    )
                  : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{c.description}</p>
            </button>
          ))}
          {matches.length === 0
            ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No source type matches “
                  {query}
                  ”.
                </p>
              )
            : null}
          {hiddenCount > 0
            ? (
                <button
                  type="button"
                  onClick={() => setVisibleCount(count => count + CONNECTOR_PAGE_SIZE)}
                  className="rounded-lg border border-dashed py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Show
                  {' '}
                  {Math.min(hiddenCount, CONNECTOR_PAGE_SIZE)}
                  {' '}
                  more (
                  {hiddenCount}
                  {' '}
                  hidden)
                </button>
              )
            : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Split a typed collection list into the array the Strapi connector's config
 * schema wants. Commas and newlines both separate, so a pasted list works, and
 * blanks from a trailing comma are dropped rather than failing validation.
 * @param raw
 */
export function parseStrapiCollections(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

/**
 * POST a new source row, reporting the new id so a caller can keep working with
 * it — storing a token, say. `error` carries the server's message on failure.
 * @param kind - Connector slug.
 * @param configJson - The connector's own config blob.
 */
async function createSourceReturningId(
  kind: string,
  configJson: Record<string, unknown>,
): Promise<{ id: number | null; error: string | null }> {
  const res = await fetch('/rpc/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, configJson }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { id: null, error: data.error ?? 'Failed to create source' };
  }
  const newId = data.source?.id;
  return { id: typeof newId === 'number' ? newId : null, error: null };
}

/**
 * POST a new source row. Returns the server's message on failure, null on success.
 * @param kind - Connector slug.
 * @param configJson - The connector's own config blob.
 */
async function createSource(kind: string, configJson: Record<string, unknown>): Promise<string | null> {
  const { error } = await createSourceReturningId(kind, configJson);
  return error;
}

/**
 * The chrome every add-source form shares: title, error strip, Cancel and the
 * submit button's pending state. The fields themselves differ per connector —
 * a web crawl needs a start URL, Strapi needs an instance and its collections —
 * so each form owns its own state and hands its config to `onSubmit`.
 * @param root0
 * @param root0.title
 * @param root0.error
 * @param root0.submitting
 * @param root0.canSubmit
 * @param root0.onClose
 * @param root0.onSubmit
 * @param root0.children
 */
function AddSourceDialogFrame({
  title,
  error,
  submitting,
  canSubmit,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  error: string | null;
  submitting: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border bg-background shadow-xl">
        <form onSubmit={onSubmit}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-display text-lg">{title}</h3>
          </div>
          <div className="space-y-4 p-4">
            {children}
            {error
              ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )
              : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !canSubmit}
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
          </div>
        </form>
      </div>
    </div>
  );
}

const FIELD_CLASS = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function AddWebSourceDialog({ kind, title, onClose, onAdded }: {
  kind: string;
  title: string;
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
      const message = await createSource(kind, configJson);
      if (message) {
        setError(message);
        return;
      }
      await onAdded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AddSourceDialogFrame
      title={title}
      error={error}
      submitting={submitting}
      canSubmit={url.trim().length > 0}
      onClose={onClose}
      onSubmit={submit}
    >
      <label className="block">
        <span className="text-sm font-medium text-foreground/80">URL</span>
        <input
          type="url"
          required
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.com/docs"
          className={FIELD_CLASS}
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
                className={FIELD_CLASS}
              />
            </label>
          )
        : null}
    </AddSourceDialogFrame>
  );
}

/** One collection's verdict from the inspect call. Mirrors `StrapiCollectionCheck`. */
type CollectionCheck = {
  collection: string;
  status: 'ok' | 'not-found' | 'forbidden' | 'error';
  entryCount: number | null;
  message: string | null;
};

/** What the inspect route reported about an instance. */
type StrapiInspection = {
  reachable: boolean;
  authorized: boolean;
  detectedVersion: 4 | 5 | null;
  collections: string[] | null;
  enumerationNote: string | null;
  checks: CollectionCheck[];
  error: string | null;
};

/**
 * Ask the server to look at a Strapi instance with these details. The call goes
 * through our own API rather than the browser because a partner's Strapi will
 * not allow a cross-origin request, and the token should not leave our origin.
 * @param baseUrl - Instance root as typed.
 * @param token - The API token as typed.
 * @param collections - Names to verify; empty asks only for the catalogue.
 */
async function inspectStrapi(
  baseUrl: string,
  token: string,
  collections: string[],
): Promise<{ inspection: StrapiInspection | null; error: string | null }> {
  const res = await fetch('/rpc/connectors/strapi/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { baseUrl }, credentials: { token }, collections }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { inspection: null, error: data.error ?? 'Could not reach that Strapi instance' };
  }
  return { inspection: data.inspection as StrapiInspection, error: null };
}

/**
 * Store the API token against a freshly created source, so adding a Strapi
 * source is one pass instead of add-then-Connect.
 * @param sourceId - The id returned by the create call.
 * @param token - The API token to store in the vault.
 */
async function storeSourceToken(sourceId: number, token: string): Promise<string | null> {
  const res = await fetch(`/rpc/sources/${sourceId}/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials: { token } }),
  });
  const data = await res.json();
  if (!res.ok) {
    return data.error ?? 'The source was created but its token could not be stored';
  }
  return null;
}

/**
 * The check icon and wording for one collection's verdict.
 * @param root0
 * @param root0.check
 */
function CollectionCheckRow({ check }: { check: CollectionCheck }) {
  const isOk = check.status === 'ok';
  return (
    <li className="flex items-start gap-2 text-xs">
      {isOk
        ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        : <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
      <span>
        <span className="font-medium">{check.collection}</span>
        {isOk
          ? ` — ${check.entryCount ?? 0} ${check.entryCount === 1 ? 'entry' : 'entries'}`
          : ` — ${check.message ?? check.status}`}
      </span>
    </li>
  );
}

/**
 * Strapi's own fields. The operator gives the instance URL and an API token
 * first; the server then looks the instance up and, where the instance allows
 * it, hands back a list of collections to tick rather than plural api ids to
 * type from memory. Instances that keep their content-type list behind the admin
 * API cannot be enumerated with an API token, so the typed list stays available
 * and each name typed there is verified against the instance.
 *
 * One source covers every collection on one instance — `ensureSource` keys a row
 * on (org, connector slug), so a second Strapi source would resolve back to the
 * first (see `libs/sources/strapi.ts`). That is why collections are a list here
 * rather than a source each.
 * @param root0 - Component props.
 * @param root0.kind - Connector slug, always `strapi` here.
 * @param root0.title - Dialog heading.
 * @param root0.onClose - Dismiss without creating anything.
 * @param root0.onAdded - Called after the source and its token are stored.
 */
function AddStrapiSourceDialog({ kind, title, onClose, onAdded }: {
  kind: string;
  title: string;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [collectionsText, setCollectionsText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [inspection, setInspection] = useState<StrapiInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [populate, setPopulate] = useState('*');
  const [pageSize, setPageSize] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typedCollections = parseStrapiCollections(collectionsText);
  const catalogue = inspection?.collections ?? null;
  const chosen = catalogue ? selected : typedCollections;
  const connectionReady = baseUrl.trim().length > 0 && token.trim().length > 0;

  const runInspect = async () => {
    setInspecting(true);
    setError(null);
    try {
      const { inspection: found, error: message } = await inspectStrapi(
        baseUrl.trim(),
        token.trim(),
        catalogue ? [] : typedCollections,
      );
      if (message) {
        setError(message);
        setInspection(null);
        return;
      }
      setInspection(found);
      // A reachable instance with a caveat — a rejected token, or collections
      // that are public so the token stays unproven — belongs in the panel's own
      // note, not the dialog's red failure strip.
      setError(found && !found.reachable ? found.error : null);
    } finally {
      setInspecting(false);
    }
  };

  const toggleCollection = (collection: string) => {
    setSelected(current => (
      current.includes(collection)
        ? current.filter(entry => entry !== collection)
        : [...current, collection]
    ));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await createSourceReturningId(kind, {
        baseUrl: baseUrl.trim().replace(/\/+$/, ''),
        collections: chosen,
        populate: populate.trim() === '' ? '*' : populate.trim(),
        pageSize,
      });
      if (created.error || created.id === null) {
        setError(created.error ?? 'Failed to create source');
        return;
      }
      const tokenError = await storeSourceToken(created.id, token.trim());
      if (tokenError) {
        setError(tokenError);
        return;
      }
      await onAdded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AddSourceDialogFrame
      title={title}
      error={error}
      submitting={submitting}
      canSubmit={connectionReady && chosen.length > 0}
      onClose={onClose}
      onSubmit={submit}
    >
      <label className="block">
        <span className="text-sm font-medium text-foreground/80">Strapi URL</span>
        <input
          type="url"
          required
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setInspection(null);
          }}
          placeholder="https://cms.partner.org"
          className={FIELD_CLASS}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          The instance root, not the /api path. Works with Strapi v4 and v5 — the version is detected from the response.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-foreground/80">API token</span>
        <input
          type="password"
          required
          autoComplete="off"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setInspection(null);
          }}
          placeholder="Strapi admin → Settings → API Tokens"
          className={FIELD_CLASS}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Read-only is enough. Stored encrypted against this source, so there is no separate Connect step.
        </span>
      </label>

      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground/80">Collections</span>
          <button
            type="button"
            onClick={runInspect}
            disabled={!connectionReady || inspecting}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {inspecting
              ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Checking…
                  </>
                )
              : (catalogue ? 'Reload collections' : 'Load collections')}
          </button>
        </div>

        {inspection?.authorized && inspection.detectedVersion
          ? (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                Connected — Strapi v
                {inspection.detectedVersion}
                , token accepted.
              </p>
            )
          : null}

        {inspection?.reachable && inspection.error
          ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {inspection.error}
              </p>
            )
          : null}

        {catalogue
          ? (
              <>
                <p className="mt-2 text-xs text-muted-foreground">
                  {catalogue.length}
                  {' '}
                  collections on this instance. Tick the ones to sync.
                </p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {catalogue.map(collection => (
                    <li key={collection}>
                      <label className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60">
                        <input
                          type="checkbox"
                          checked={selected.includes(collection)}
                          onChange={() => toggleCollection(collection)}
                        />
                        {collection}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )
          : (
              <>
                {/* Skipped when the note above already says the same thing — a
                    rejected token surfaces through both. */}
                {inspection?.enumerationNote && !inspection.error
                  ? <p className="mt-2 text-xs text-muted-foreground">{inspection.enumerationNote}</p>
                  : null}
                <textarea
                  required
                  rows={2}
                  value={collectionsText}
                  onChange={e => setCollectionsText(e.target.value)}
                  placeholder="events, venues"
                  aria-label="Collections"
                  className={FIELD_CLASS}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Plural API ids, comma separated. Load collections again to check each name against the instance.
                  {typedCollections.length > 0
                    ? ` Syncing ${typedCollections.length === 1 ? '1 collection' : `${typedCollections.length} collections`}: ${typedCollections.join(', ')}.`
                    : ''}
                </span>
              </>
            )}

        {inspection && inspection.checks.length > 0
          ? (
              <ul className="mt-2 space-y-1">
                {inspection.checks.map(check => <CollectionCheckRow key={check.collection} check={check} />)}
              </ul>
            )
          : null}
      </div>

      <label className="block">
        <span className="text-sm font-medium text-foreground/80">Populate</span>
        <input
          type="text"
          value={populate}
          onChange={e => setPopulate(e.target.value)}
          placeholder="*"
          className={FIELD_CLASS}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Relations and media to expand. “*” pulls every first-level relation; Strapi returns bare ids otherwise.
        </span>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-foreground/80">Entries per page</span>
        <input
          type="number"
          min={1}
          max={100}
          value={pageSize}
          onChange={e => setPageSize(Math.max(1, Math.min(100, Number.parseInt(e.target.value, 10) || 1)))}
          className={FIELD_CLASS}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Strapi caps a page at 100 by default. The sync walks every page until the collection is exhausted.
        </span>
      </label>
    </AddSourceDialogFrame>
  );
}

/**
 * Route each connector to the form its config schema actually needs.
 * @param root0
 * @param root0.kind
 * @param root0.connector
 * @param root0.onClose
 * @param root0.onAdded
 */
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
  const title = `Add ${connector?.name ?? kind} source`;
  if (kind === 'strapi') {
    return <AddStrapiSourceDialog kind={kind} title={title} onClose={onClose} onAdded={onAdded} />;
  }
  return <AddWebSourceDialog kind={kind} title={title} onClose={onClose} onAdded={onAdded} />;
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
