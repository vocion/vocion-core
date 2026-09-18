'use client';

import type { LucideIcon } from 'lucide-react';
import type { RefObject } from 'react';
import type { ConnectorRow, Source } from './connectorRows';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Contact,
  Database,
  ExternalLink,
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
  NotebookText,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  SquareKanban,
  Trash2,
  Video,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ListRows } from '@/components/patterns';
import { Link } from '@/libs/I18nNavigation';
import { describeSourceConfig, filterConnectorRows, formatRelative } from './connectorRows';

/**
 * The connectors page as one flat list (Chris, 2026-09-18, Claude's list as
 * the reference): icon, name, one line, and Connect — for every connector
 * the build knows. A connected connector sits at the top with its summary
 * on the row and opens in place to what Vocion is responsible for and the
 * reference is not: the last run and its errors, the size in documents and
 * chunks, a running sync's progress, the scopes it needs and which are
 * missing, and Reconnect / Sync now / Edit / Delete.
 *
 * Hairlines, not cards; one primary action per row (`docs/design/patterns.md`).
 */

/** How many rows render before "Show more" — the search is what makes a long list usable. */
const PAGE_SIZE = 25;

/**
 * The Lucide icons connectors name in their `icon` field (`libs/sources/*.ts`),
 * listed rather than looked up off the whole namespace, which would pull every
 * icon into the client bundle. A missing name gets the plug.
 */
const ICONS: Record<string, LucideIcon> = {
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
  NotebookText,
  Pencil,
  SquareKanban,
  Video,
};

function ConnectorIcon({ name }: { name: string }) {
  const Icon = ICONS[name] ?? Plug;
  return <Icon className="size-4" aria-hidden="true" />;
}

export type ConnectorListProps = {
  rows: ConnectorRow[];
  /** The configured row a Sync now this tab started is running on, if any. */
  syncingId: number | null;
  /** Focus target for the page's Add connector button. */
  searchRef?: RefObject<HTMLInputElement | null>;
  /** Start connecting a connector nobody has set up (or another instance of one). */
  onConnectNew: (slug: string) => void;
  onSync: (source: Source) => void;
  onTest: (source: Source) => void;
  onEdit: (source: Source) => void;
  onDelete: (source: Source) => void;
  /** Store or replace the credential a configured row uses — Connect, or Reconnect after a revoke or a scope change. */
  onConnect: (source: Source) => void;
};

export function ConnectorList(props: ConnectorListProps) {
  const { rows, searchRef } = props;
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const matches = useMemo(() => filterConnectorRows(rows, query), [rows, query]);
  const visible = matches.slice(0, visibleCount);
  const hiddenCount = matches.length - visible.length;
  const connectedCount = rows.filter(r => r.state !== 'not-connected').length;

  // A new query starts a fresh page — otherwise a search run after "Show more"
  // keeps the taller list for a two-result match.
  const changeQuery = (next: string) => {
    setQuery(next);
    setVisibleCount(PAGE_SIZE);
  };
  const toggle = (slug: string) => setOpen(o => ({ ...o, [slug]: !o[slug] }));

  return (
    <div className="flex flex-col gap-3" data-testid="connector-list">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block min-w-0 flex-1 sm:max-w-sm">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={e => changeQuery(e.target.value)}
            placeholder="Search connectors — name or what it ingests"
            aria-label="Search connectors"
            className="w-full rounded-md border border-input bg-background py-2 pr-3 pl-9 text-sm"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {matches.length === rows.length
            ? `${rows.length} connectors`
            : `${matches.length} of ${rows.length} connectors`}
          {connectedCount > 0 && matches.length === rows.length ? ` · ${connectedCount} connected` : ''}
        </p>
      </div>

      <ListRows>
        {visible.map(row => (row.state === 'not-connected'
          ? (
              <AvailableRow key={row.tile.slug} row={row} onConnect={() => props.onConnectNew(row.tile.slug)} />
            )
          : (
              <ConnectedRow
                key={row.tile.slug}
                row={row}
                open={Boolean(open[row.tile.slug])}
                onToggle={() => toggle(row.tile.slug)}
                syncingId={props.syncingId}
                onConnectNew={() => props.onConnectNew(row.tile.slug)}
                onSync={props.onSync}
                onTest={props.onTest}
                onEdit={props.onEdit}
                onDelete={props.onDelete}
                onConnect={props.onConnect}
              />
            )))}
      </ListRows>

      {matches.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No connector matches “
          {query}
          ”.
        </p>
      )}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
          className="rounded-lg border border-dashed py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Show
          {' '}
          {Math.min(hiddenCount, PAGE_SIZE)}
          {' '}
          more (
          {hiddenCount}
          {' '}
          hidden)
        </button>
      )}
    </div>
  );
}

/**
 * A connector nobody has connected: the whole row is the Connect action.
 * @param root0
 * @param root0.row
 * @param root0.onConnect
 */
function AvailableRow({ row, onConnect }: { row: ConnectorRow; onConnect: () => void }) {
  return (
    <button
      type="button"
      onClick={onConnect}
      aria-label={`Connect ${row.tile.name}`}
      className="group flex min-h-12 w-full items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-soft text-muted-foreground">
        <ConnectorIcon name={row.tile.icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{row.tile.name}</span>
        <span className="block truncate text-[13px] text-muted-foreground">{row.tile.description}</span>
      </span>
      {row.tile.authKind !== 'none' && (
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{row.tile.authKind === 'oauth' ? 'OAuth' : 'API key'}</span>
      )}
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:border-foreground/30 group-hover:text-foreground">
        <Plus className="size-3" aria-hidden />
        Connect
      </span>
    </button>
  );
}

/**
 * The state chip on a connected row.
 * @param root0
 * @param root0.row
 */
function StateChip({ row }: { row: ConnectorRow }) {
  if (row.state === 'syncing') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Syncing now
      </span>
    );
  }
  if (row.state === 'attention') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-500">
        <AlertTriangle className="size-3.5" aria-hidden />
        Needs attention
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-3.5" aria-hidden />
      Connected
    </span>
  );
}

function ConnectedRow(props: {
  row: ConnectorRow;
  open: boolean;
  onToggle: () => void;
  syncingId: number | null;
  onConnectNew: () => void;
  onSync: (source: Source) => void;
  onTest: (source: Source) => void;
  onEdit: (source: Source) => void;
  onDelete: (source: Source) => void;
  onConnect: (source: Source) => void;
}) {
  const { row } = props;
  const Chevron = props.open ? ChevronDown : ChevronRight;
  const last = row.lastSyncedAt ? formatRelative(new Date(row.lastSyncedAt)) : 'never';
  const summary = [
    row.sources.length > 1 ? `${row.sources.length} connections` : null,
    `${row.documents.toLocaleString()} document${row.documents === 1 ? '' : 's'}`,
    row.chunks > 0 ? `${row.chunks.toLocaleString()} chunks` : null,
    `last sync ${last}`,
  ].filter(Boolean).join(' · ');
  const detailId = `connector-detail-${row.tile.slug}`;

  return (
    <div className="py-1" data-connector-row={row.tile.slug} data-state={row.state}>
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.open}
        aria-controls={detailId}
        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-soft text-foreground">
          <ConnectorIcon name={row.tile.icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.tile.name}</span>
          <span className="block truncate text-[13px] text-muted-foreground">{summary}</span>
        </span>
        <StateChip row={row} />
      </button>

      {/* The connector's configured rows — each with its own line and actions,
          visible without opening the row: what is running, what failed, and
          the one button that fixes it. */}
      <ul className="ml-9 flex flex-col gap-1.5 pr-2 pb-1">
        {row.sources.map(source => (
          <li key={source.id} className="flex flex-col gap-1 rounded-lg px-2 py-1.5 sm:flex-row sm:items-start sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/dashboard/connectors/${source.slug}`} className="truncate font-medium hover:underline">{source.slug}</Link>
                {source.objectType ? <span className="rounded border px-1.5 font-mono text-[10px] text-muted-foreground">{source.objectType}</span> : null}
                {source.authKind !== 'none' ? <CredentialState source={source} /> : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{describeSourceConfig(source.config)}</p>
              <SyncRunLine sync={source.sync} />
            </div>
            <SourceActions source={source} syncing={props.syncingId === source.id} onSync={props.onSync} onTest={props.onTest} onEdit={props.onEdit} onDelete={props.onDelete} onConnect={props.onConnect} />
          </li>
        ))}
      </ul>

      {props.open && (
        <div id={detailId} className="mr-2 mb-2 ml-9 flex flex-col gap-4 border-t border-border/70 pt-3 text-sm" data-testid="connector-detail">
          {row.attention && (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-500">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {row.attention}
            </p>
          )}
          {row.sources.map(source => <SourceDetail key={source.id} source={source} row={row} onConnect={props.onConnect} />)}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={props.onConnectNew}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="size-3" aria-hidden />
              Add another
              {' '}
              {row.tile.name}
              {' '}
              connection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CredentialState({ source }: { source: Source }) {
  if (source.credentialBroken) {
    const word = source.credentialBroken === 'revoked' ? 'revoked' : source.credentialBroken === 'expired' ? 'expired' : 'missing';
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
        <AlertTriangle className="size-3.5" aria-hidden />
        Credential
        {' '}
        {word}
      </span>
    );
  }
  if (!source.credentialConnected) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
        <KeyRound className="size-3.5" aria-hidden />
        Needs credentials
      </span>
    );
  }
  return null;
}

/**
 * One line about the latest run — busy, failed, or finished with documents it
 * could not save. The only place a run started elsewhere shows, and the only
 * place a failure survives a reload.
 * @param props
 * @param props.sync
 */
function SyncRunLine({ sync }: { sync: Source['sync'] }) {
  if (!sync) {
    return null;
  }
  if (sync.status === 'running') {
    const done = (sync.counts.created ?? 0) + (sync.counts.updated ?? 0) + (sync.counts.unchanged ?? 0);
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Syncing now — started
        {' '}
        {formatRelative(new Date(sync.startedAt))}
        {done > 0 ? ` · ${done.toLocaleString()} documents so far` : ''}
      </p>
    );
  }
  if (sync.status === 'abandoned') {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        A sync started
        {' '}
        {formatRelative(new Date(sync.startedAt))}
        {' '}
        never finished — its process stopped. Sync now will take over.
      </p>
    );
  }
  if (sync.status === 'superseded') {
    return <p className="mt-1 text-xs text-muted-foreground">A sync stopped when the settings changed; a fresh one runs with the new settings.</p>;
  }
  if (sync.status === 'failed') {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Last sync failed:
        {' '}
        {sync.error ?? 'no reason was recorded'}
      </p>
    );
  }
  const errorCount = sync.counts.errors ?? 0;
  if (errorCount > 0) {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Last sync could not save
        {' '}
        {errorCount}
        {' '}
        document
        {errorCount === 1 ? '' : 's'}
        .
      </p>
    );
  }
  return null;
}

function SourceActions(props: {
  source: Source;
  syncing: boolean;
  onSync: (source: Source) => void;
  onTest: (source: Source) => void;
  onEdit: (source: Source) => void;
  onDelete: (source: Source) => void;
  onConnect: (source: Source) => void;
}) {
  const { source } = props;
  const needsCreds = source.authKind !== 'none' && !source.credentialConnected;
  const runningElsewhere = source.sync?.status === 'running';
  const busy = props.syncing || runningElsewhere;
  const pill = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/50 disabled:opacity-50';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {/* Connect is the call to action while nothing is stored; once a credential
          exists, Edit changes it with everything else. */}
      {needsCreds && (
        <button type="button" onClick={() => props.onConnect(source)} className={pill}>
          <KeyRound className="size-3" aria-hidden />
          Connect
        </button>
      )}
      <button type="button" onClick={() => props.onEdit(source)} title="Edit this connector's settings" className={pill}>
        <Pencil className="size-3" aria-hidden />
        Edit
      </button>
      <button type="button" onClick={() => props.onDelete(source)} title="Delete this connector and everything ingested from it" className={`${pill} text-destructive hover:bg-destructive/5`}>
        <Trash2 className="size-3" aria-hidden />
        Delete
      </button>
      {source.syncless
        ? (
            <button type="button" onClick={() => props.onTest(source)} disabled={needsCreds || !source.inspectable} title={needsCreds ? 'Connect credentials first' : undefined} className={pill}>
              <Plug className="size-3" aria-hidden />
              Test connection
            </button>
          )
        : (
            <button
              type="button"
              onClick={() => props.onSync(source)}
              disabled={busy || needsCreds}
              title={needsCreds ? 'Connect credentials first' : (runningElsewhere ? 'This connector is already syncing. Wait for it to finish, then try again.' : undefined)}
              className={pill}
            >
              {busy
                ? (
                    <>
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                      Syncing…
                    </>
                  )
                : (
                    <>
                      <RefreshCw className="size-3" aria-hidden />
                      Sync now
                    </>
                  )}
            </button>
          )}
    </div>
  );
}

/**
 * What the row opens to: the last run in full, the size, and — for a
 * connector that declares scopes — which ones the token has and lacks, with
 * Reconnect right there.
 * @param props
 * @param props.source
 * @param props.row
 * @param props.onConnect
 */
function SourceDetail({ source, row, onConnect }: { source: Source; row: ConnectorRow; onConnect: (source: Source) => void }) {
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);
  const sync = source.sync;
  const counts = sync ? Object.entries(sync.counts).filter(([, v]) => v > 0) : [];
  const scopes = row.tile.requiredScopes ?? [];
  const missing = new Set(row.missingScopes);
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid={`connector-detail-${source.slug}`}>
      <dl className="space-y-1 text-[13px]">
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Size</div>
        <div>
          <dt className="inline text-muted-foreground">Documents: </dt>
          <dd className="inline tabular-nums">{source.documentCount.toLocaleString()}</dd>
        </div>
        {typeof source.chunkCount === 'number' && (
          <div>
            <dt className="inline text-muted-foreground">Chunks in retrieval: </dt>
            <dd className="inline tabular-nums">{source.chunkCount.toLocaleString()}</dd>
          </div>
        )}
        <div>
          <dt className="inline text-muted-foreground">Added: </dt>
          <dd className="inline">{fmt(source.createdAt) ?? '—'}</dd>
        </div>
        {source.credentialUpdatedAt && (
          <div>
            <dt className="inline text-muted-foreground">Credential stored: </dt>
            <dd className="inline">{fmt(source.credentialUpdatedAt)}</dd>
          </div>
        )}
        <div className="pt-1">
          <Link href={`/dashboard/connectors/${source.slug}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
            Configuration and checkpoint
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>
      </dl>
      <dl className="space-y-1 text-[13px]">
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Last run</div>
        {sync
          ? (
              <>
                <div>
                  <dt className="inline text-muted-foreground">Status: </dt>
                  <dd className="inline">{sync.status}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Started: </dt>
                  <dd className="inline">
                    {fmt(sync.startedAt)}
                    {sync.completedAt ? ` · finished ${fmt(sync.completedAt)}` : ' · still running'}
                  </dd>
                </div>
                {counts.length > 0 && (
                  <div>
                    <dt className="inline text-muted-foreground">Counts: </dt>
                    <dd className="inline font-mono text-xs">{counts.map(([k, v]) => `${k} ${v}`).join(' · ')}</dd>
                  </div>
                )}
                {sync.error && (
                  <div className="text-destructive">
                    <dt className="inline">Error: </dt>
                    <dd className="inline break-words">{sync.error}</dd>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">One run is kept per connection; the previous run is replaced when the next one starts.</p>
              </>
            )
          : <p className="text-muted-foreground">Never synced.</p>}
      </dl>
      {scopes.length > 0 && (
        <div className="sm:col-span-2" data-testid="connector-scopes">
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Scopes this connector needs</div>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
            {scopes.map(scope => (
              <li key={scope} className={`flex items-center gap-1.5 ${missing.has(scope) ? 'text-destructive' : 'text-foreground/85'}`}>
                {missing.has(scope) ? <CircleAlert className="size-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                {scope}
                {missing.has(scope) ? <span className="font-sans text-[11px]">missing</span> : null}
              </li>
            ))}
            {row.missingScopes.filter(s => !scopes.includes(s)).map(scope => (
              <li key={scope} className="flex items-center gap-1.5 text-destructive">
                <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                {scope}
                <span className="font-sans text-[11px]">missing</span>
              </li>
            ))}
          </ul>
          {missing.size > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Add the missing scopes to the app in the provider's developer console, save, then Reconnect here — a token already minted does not pick them up.
            </p>
          )}
          <button
            type="button"
            onClick={() => onConnect(source)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/50"
          >
            <KeyRound className="size-3" aria-hidden />
            Reconnect
          </button>
        </div>
      )}
    </div>
  );
}
