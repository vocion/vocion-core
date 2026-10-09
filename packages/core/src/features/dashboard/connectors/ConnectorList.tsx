'use client';

import type { FailedAttempt } from '../LastAttemptLine';
import type { CatalogEntry, ConnectionProblem, ConnectionRow, Source } from './connectorRows';
import type { RowMenuItem } from '@/components/patterns';
import type { GrantSummary } from '@/libs/connect/provider';
import type { ConnectorCategory } from '@/libs/sources/types';
import type { RecommendedConnector } from '@/services/connect/connectionsOverview';
import {
  Check,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  KeyRound,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  Unplug,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { firstSentence, IntegrationLogo, ListRows, RowMenu } from '@/components/patterns';
import { HowItsAuthored } from '@/components/ui/how-its-authored';
import { Link } from '@/libs/I18nNavigation';
import { CONNECTOR_CATEGORIES } from '@/libs/sources/types';
import { cn } from '@/utils/Helpers';
import { LastAttemptLine } from '../LastAttemptLine';
import { connectorIcon } from './connectorIcon';
import { categoriesIn, describeSourceConfig, filterCatalog, instanceLabel, relativeTime } from './connectorRows';

/**
 * The Connectors page (founder, 2026-10-09: "clear, concise, simple, easy to
 * use"). Three short parts and nothing else:
 *
 * 1. **Connected** — one row per connection: logo and name, a status in words,
 *    who uses it, when it last synced, and at most one fix on the row
 *    (Reconnect, Connect or Try again). Everything else is behind ⋯ (Manage,
 *    Pause, Disconnect); the row itself opens Manage in place, where the
 *    technical detail waits behind Details.
 * 2. **Recommended for this workspace** — at most three, each with one reason,
 *    the same reason chat gives.
 * 3. **All connectors** — a search box and categories over one compact list,
 *    folded away until it is asked for.
 *
 * Nothing on it counts what the next line already shows, and there is one way
 * to start each thing.
 */

const SECTION_HEADING = 'mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase';
const PILL = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50 sm:min-h-8';

export type ConnectorListProps = {
  connections: ConnectionRow[];
  catalog: CatalogEntry[];
  /** From the server, best first; connectors connected since are dropped here. */
  recommended: RecommendedConnector[];
  /** Per connector slug: the agents and apps that read it. */
  usedBy: Record<string, string[]>;
  /** Only an admin is offered anything to connect or change. */
  isAdmin: boolean;
  /** The connection a Sync now from this tab is running on, if any. */
  syncingId: number | null;
  /** The newest failed connect attempt per connector slug. */
  lastAttempts?: Record<string, FailedAttempt>;
  /** IANA zone for dates; the browser's by default. */
  timeZone?: string;
  /** Now, for the relative times (tests). */
  now?: number;
  onConnectNew: (slug: string) => void;
  onSync: (source: Source) => void;
  onTest: (source: Source) => void;
  onEdit: (source: Source) => void;
  /** Store or replace the credential a connection uses. */
  onConnect: (source: Source) => void;
  onPause: (source: Source, paused: boolean) => void;
  onDisconnect: (source: Source) => void;
};

export function ConnectorList(props: ConnectorListProps) {
  const t = useTranslations('Connectors');
  const connectedSlugs = new Set(props.connections.map(r => r.tile.slug));
  const recommended = props.isAdmin ? props.recommended.filter(r => !connectedSlugs.has(r.slug)).slice(0, 3) : [];
  const tileOf = new Map(props.catalog.map(e => [e.tile.slug, e.tile]));

  return (
    <div className="flex flex-col gap-8" data-testid="connector-list">
      {props.connections.length > 0 && (
        <section aria-labelledby="connected-heading" data-testid="connected-section">
          <h2 id="connected-heading" className={SECTION_HEADING}>{t('connected_heading')}</h2>
          <ListRows>
            {props.connections.map(row => (
              <ConnectionItem key={row.source.id} row={row} rows={props.connections} {...props} />
            ))}
          </ListRows>
        </section>
      )}

      {!props.isAdmin && (
        <p className="text-sm text-muted-foreground" data-testid="member-note">
          {props.connections.length === 0 ? `${t('empty_member')} ` : ''}
          {t('member_note')}
        </p>
      )}

      {recommended.length > 0 && (
        <section aria-labelledby="recommended-heading" data-testid="recommended-section">
          <h2 id="recommended-heading" className={SECTION_HEADING}>{t('recommended_heading')}</h2>
          <ListRows>
            {recommended.map((r) => {
              const tile = tileOf.get(r.slug);
              return (
                <div key={r.slug} className="flex min-h-14 items-center gap-3 py-2" data-recommended={r.slug}>
                  <IntegrationLogo brand={tile?.brand} name={r.name} icon={connectorIcon(tile?.icon ?? 'Plug')} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="truncate text-[13px] text-muted-foreground">{r.why}</div>
                  </div>
                  <button type="button" onClick={() => props.onConnectNew(r.slug)} aria-label={t('connect_named', { name: r.name })} className={PILL}>
                    {t('connect')}
                  </button>
                </div>
              );
            })}
          </ListRows>
        </section>
      )}

      {props.isAdmin && (
        <Catalog
          entries={props.catalog}
          openByDefault={props.connections.length === 0 && recommended.length === 0}
          lastAttempts={props.lastAttempts}
          timeZone={props.timeZone}
          onConnectNew={props.onConnectNew}
        />
      )}
    </div>
  );
}

/**
 * One connection: the row, and — when opened — its Manage panel.
 * @param props - The row and the page's handlers.
 * @param props.row - The connection.
 * @param props.rows - Every connection, to tell siblings of one connector apart.
 */
function ConnectionItem(props: ConnectorListProps & { row: ConnectionRow; rows: ConnectionRow[] }) {
  const t = useTranslations('Connectors');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { row } = props;
  const { source, tile } = row;
  const instance = instanceLabel(row, props.rows);
  const usedBy = props.usedBy[tile.slug] ?? [];
  const panelId = `connection-${source.id}`;
  const busy = row.syncing || props.syncingId === source.id;

  const meta = [
    usedBy.length > 0 ? t('used_by', { names: usedBy.join(', ') }) : null,
    // A sync time only where it says something: when there is one, or on a
    // working connection that has not run yet.
    busy ? t('syncing') : tile.syncless ? null : source.lastSyncedAt ? t('synced', { when: relativeTime(source.lastSyncedAt, locale, props.now) }) : row.status === 'working' ? t('never_synced') : null,
  ].filter(Boolean).join(' · ');

  const fixLabel = row.fix === 'reconnect' ? t('fix_reconnect') : row.fix === 'connect' ? t('fix_connect') : row.fix === 'retry' ? t('fix_retry') : null;
  const fix = () => (row.fix === 'retry' ? props.onSync(source) : props.onConnect(source));

  const menu: RowMenuItem[] = [
    { label: t('menu_manage'), icon: Settings2, onClick: () => setOpen(true) },
  ];
  if (props.isAdmin) {
    menu.push(row.status === 'paused'
      ? { label: t('menu_resume'), icon: Play, onClick: () => props.onPause(source, false) }
      : { label: t('menu_pause'), icon: Pause, onClick: () => props.onPause(source, true) });
    menu.push({ label: t('menu_disconnect'), icon: Unplug, onClick: () => props.onDisconnect(source) });
  }

  return (
    <div data-connection={source.slug} data-connector-row={tile.slug} data-status={row.status}>
      <div className="flex min-h-16 items-center gap-2 py-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 pr-1 text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <IntegrationLogo brand={tile.brand} name={tile.name} icon={connectorIcon(tile.icon)} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {tile.name}
              {instance && <span className="font-normal text-muted-foreground">{` · ${instance}`}</span>}
            </span>
            <StatusLine row={row} />
            {meta && <span className="block truncate text-[13px] text-muted-foreground">{meta}</span>}
          </span>
        </button>
        {props.isAdmin && fixLabel && (
          <button type="button" onClick={fix} disabled={row.fix === 'retry' && busy} aria-label={`${fixLabel} ${tile.name}`} className={PILL}>
            {row.fix === 'retry' ? <RefreshCw className="size-3" aria-hidden /> : <KeyRound className="size-3" aria-hidden />}
            {fixLabel}
          </button>
        )}
        <RowMenu items={menu} label={t('more_for', { name: tile.name })} />
      </div>
      {props.lastAttempts?.[tile.slug] && row.status === 'attention' && (
        <div className="pb-2 pl-11">
          <LastAttemptLine attempt={props.lastAttempts[tile.slug]!} timeZone={props.timeZone} />
        </div>
      )}
      {open && <ManagePanel id={panelId} {...props} busy={busy} />}
    </div>
  );
}

/**
 * The status in words: Working, Paused, or Needs attention with its reason.
 * @param props
 * @param props.row - The connection.
 */
function StatusLine({ row }: { row: ConnectionRow }) {
  const t = useTranslations('Connectors');
  // Each key spelled out, so the translation check can see it is used.
  const problemWords: Record<ConnectionProblem, string> = {
    'revoked': t('problem_revoked'),
    'expired': t('problem_expired'),
    'not-connected': t('problem_not_connected'),
    'missing-permissions': t('problem_permissions'),
    'sync-failed': t('problem_sync_failed'),
    'sync-stopped': t('problem_sync_stopped'),
    'items-not-saved': t('problem_items_not_saved'),
  };
  if (row.status === 'paused') {
    return (
      <span className="flex items-center gap-1 text-[13px] text-muted-foreground" data-testid="connection-status">
        <Pause className="size-3.5 shrink-0" aria-hidden />
        {t('status_paused')}
      </span>
    );
  }
  if (row.status === 'attention') {
    return (
      <span className="flex min-w-0 items-start gap-1 text-[13px] text-amber-700 dark:text-amber-400" data-testid="connection-status">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{t('status_attention', { reason: problemWords[row.problem!] })}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[13px] text-emerald-700 dark:text-emerald-400" data-testid="connection-status">
      {row.syncing ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />}
      {t('status_working')}
    </span>
  );
}

/**
 * What Manage opens to: the connection's few actions, the facts a person
 * asks about, and — behind Details — what an admin needs to debug it.
 * @param props - The row, its handlers and whether a sync is running.
 * @param props.id - The panel's id, for the row's aria-controls.
 * @param props.busy - A sync is running.
 */
function ManagePanel(props: ConnectorListProps & { row: ConnectionRow; id: string; busy: boolean }) {
  const t = useTranslations('Connectors');
  const { row } = props;
  const { source } = row;
  const needsCredential = source.authKind !== 'none' && !source.credentialConnected;
  const paused = row.status === 'paused';
  return (
    <div id={props.id} className="mb-3 ml-11 flex flex-col gap-3 text-sm" data-testid="manage-panel">
      {source.grant?.account && <p className="text-[13px] text-muted-foreground">{t('connected_as', { account: source.grant.account })}</p>}
      {props.isAdmin && (
        <div className="flex flex-wrap gap-2">
          {source.syncless
            ? (
                <button type="button" onClick={() => props.onTest(source)} disabled={!source.inspectable || needsCredential} className={PILL}>
                  <Plug className="size-3" aria-hidden />
                  {t('manage_test')}
                </button>
              )
            : (
                <button type="button" onClick={() => props.onSync(source)} disabled={props.busy || paused || needsCredential} className={PILL}>
                  {props.busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />}
                  {props.busy ? t('syncing') : t('manage_sync')}
                </button>
              )}
          <button type="button" onClick={() => props.onEdit(source)} className={PILL}>
            <Pencil className="size-3" aria-hidden />
            {t('manage_settings')}
          </button>
          {source.authKind !== 'none' && row.fix !== 'reconnect' && row.fix !== 'connect' && (
            <button type="button" onClick={() => props.onConnect(source)} className={PILL}>
              <KeyRound className="size-3" aria-hidden />
              {t('fix_reconnect')}
            </button>
          )}
        </div>
      )}
      <HowItsAuthored label={t('details')}>
        <SourceDetail source={source} row={row} />
      </HowItsAuthored>
    </div>
  );
}

/**
 * The catalog: a search box and categories over one compact list, folded
 * away until it is asked for (or open from the start when the page has
 * nothing else on it).
 * @param props - The entries and what to do with them.
 * @param props.entries - Every connector this viewer may see.
 * @param props.openByDefault - Show the whole list without being asked.
 * @param props.lastAttempts - The newest failed connect attempt per connector.
 * @param props.timeZone - For the attempt's date.
 * @param props.onConnectNew - Start connecting one.
 */
function Catalog(props: {
  entries: CatalogEntry[];
  openByDefault: boolean;
  lastAttempts?: Record<string, FailedAttempt>;
  timeZone?: string;
  onConnectNew: (slug: string) => void;
}) {
  const t = useTranslations('Connectors');
  const categoryWords: Record<ConnectorCategory, string> = {
    'mail-calendar': t('category_mail_calendar'),
    'docs-files': t('category_docs_files'),
    'chat-meetings': t('category_chat_meetings'),
    'sales-marketing': t('category_sales_marketing'),
    'engineering': t('category_engineering'),
    'finance-people': t('category_finance_people'),
    'data-analytics': t('category_data_analytics'),
    'other': t('category_other'),
  };
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | null>(null);
  const [browsing, setBrowsing] = useState(props.openByDefault);
  const categories = useMemo(() => categoriesIn(props.entries, CONNECTOR_CATEGORIES), [props.entries]);
  const matches = useMemo(() => filterCatalog(props.entries, query, category), [props.entries, query, category]);
  const showing = browsing || query.trim() !== '' || category !== null;

  return (
    <section aria-labelledby="catalog-heading" data-testid="catalog-section">
      <h2 id="catalog-heading" className={SECTION_HEADING}>{t('all_heading')}</h2>
      <div className="flex flex-col gap-2">
        <label className="relative block">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search_placeholder')}
            aria-label={t('search_label')}
            className="h-10 w-full rounded-md border border-input bg-background pr-3 pl-9 text-base sm:max-w-sm sm:text-sm"
          />
        </label>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label={t('categories_label')}>
          {categories.map(c => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(cur => (cur === c ? null : c))}
              className={cn(
                'min-h-8 shrink-0 rounded-full border px-3 text-xs whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                category === c ? 'border-foreground bg-foreground text-background' : 'border-rule text-muted-foreground hover:text-foreground',
              )}
            >
              {categoryWords[c]}
            </button>
          ))}
        </div>
      </div>

      {showing
        ? (
            matches.length === 0
              ? <p className="py-6 text-center text-sm text-muted-foreground">{t('no_match', { query })}</p>
              : (
                  <ListRows className="mt-1">
                    {matches.map(entry => (
                      <CatalogRow key={entry.tile.slug} entry={entry} attempt={props.lastAttempts?.[entry.tile.slug]} timeZone={props.timeZone} onConnect={() => props.onConnectNew(entry.tile.slug)} />
                    ))}
                  </ListRows>
                )
          )
        : (
            <button type="button" onClick={() => setBrowsing(true)} className="mt-2 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {t('browse_all')}
            </button>
          )}
    </section>
  );
}

/**
 * One connector in the catalog: its mark, name, one sentence, and Connect —
 * or why it cannot be.
 * @param props
 * @param props.entry - The connector.
 * @param props.attempt - Its newest failed connect attempt.
 * @param props.timeZone - For the attempt's date.
 * @param props.onConnect - Start connecting it.
 */
function CatalogRow({ entry, attempt, timeZone, onConnect }: { entry: CatalogEntry; attempt?: FailedAttempt; timeZone?: string; onConnect: () => void }) {
  const t = useTranslations('Connectors');
  const { tile } = entry;
  // Several sites, buckets or repositories are several connections; one
  // account-wide login (Apollo) is one.
  const canAddAnother = entry.connected && !tile.syncless;
  return (
    <div className="flex min-h-14 flex-col gap-1 py-2" data-catalog={tile.slug}>
      <div className="flex items-center gap-3">
        <IntegrationLogo brand={tile.brand} name={tile.name} icon={connectorIcon(tile.icon)} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{tile.name}</div>
          <div className="line-clamp-1 text-[13px] text-muted-foreground">{firstSentence(tile.description)}</div>
        </div>
        {entry.unavailable
          ? <span className="shrink-0 text-xs text-muted-foreground" data-testid="unavailable">{t('unavailable')}</span>
          : entry.connected && !canAddAnother
            ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5" aria-hidden />
                  {t('connected_tag')}
                </span>
              )
            : (
                <button type="button" onClick={onConnect} aria-label={canAddAnother ? t('add_another_named', { name: tile.name }) : t('connect_named', { name: tile.name })} className={PILL}>
                  {canAddAnother ? t('add_another') : t('connect')}
                </button>
              )}
      </div>
      {attempt && <div className="pl-11"><LastAttemptLine attempt={attempt} timeZone={timeZone} /></div>}
    </div>
  );
}

/**
 * What Details opens to, for an admin debugging a connection: the size, the
 * last run in full with the vendor's own error, the account a grant is on,
 * and — for a connector that declares them — the scopes it has and lacks.
 * Technical words live here and nowhere else on the page.
 * @param props
 * @param props.source - The connection.
 * @param props.row - Its row.
 */
function SourceDetail({ source, row }: { source: Source; row: ConnectionRow }) {
  const t = useTranslations('Connectors');
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);
  const sync = source.sync;
  const counts = sync ? Object.entries(sync.counts).filter(([, v]) => v > 0) : [];
  const scopes = row.tile.requiredScopes ?? [];
  const missing = new Set(row.missingScopes);
  const skipped = sync?.status === 'completed' && (sync.counts.skipped ?? 0) > 0 && ((sync.counts.created ?? 0) + (sync.counts.updated ?? 0) + (sync.counts.unchanged ?? 0)) === 0
    ? sync.skipped?.[0]?.message ?? null
    : null;
  return (
    <div className="grid gap-4 rounded-lg border border-rule p-3 text-[13px] sm:grid-cols-2" data-testid={`connector-detail-${source.slug}`}>
      <dl className="space-y-1">
        <Fact label={t('detail_name')} value={source.slug} mono />
        <Fact label={t('detail_reads')} value={describeSourceConfig(source.config)} />
        <Fact label={t('detail_documents')} value={source.documentCount.toLocaleString()} />
        {typeof source.chunkCount === 'number' && <Fact label={t('detail_chunks')} value={source.chunkCount.toLocaleString()} />}
        <Fact label={t('detail_added')} value={fmt(source.createdAt) ?? '—'} />
        {source.credentialUpdatedAt && <Fact label={t('detail_credential_stored')} value={fmt(source.credentialUpdatedAt)!} />}
        <div className="pt-1">
          <Link href={`/dashboard/connectors/${source.slug}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
            {t('detail_configuration')}
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>
      </dl>
      <dl className="space-y-1">
        {sync
          ? (
              <>
                <Fact label={t('detail_last_run')} value={`${sync.status} · ${fmt(sync.startedAt)}${sync.completedAt ? ` → ${fmt(sync.completedAt)}` : ''}`} />
                {counts.length > 0 && <Fact label={t('detail_counts')} value={counts.map(([k, v]) => `${k} ${v}`).join(' · ')} mono />}
                {sync.error && (
                  <div className="text-destructive">
                    <dt className="inline">{`${t('detail_error')}: `}</dt>
                    <dd className="inline break-words">{sync.error}</dd>
                  </div>
                )}
                {skipped && <p className="text-amber-700 dark:text-amber-400" data-testid="sync-skipped-line">{t('detail_kept_none', { reason: skipped })}</p>}
              </>
            )
          : <p className="text-muted-foreground">{t('never_synced')}</p>}
      </dl>
      {source.grant && <GrantDetail source={source} grant={source.grant} />}
      {scopes.length + row.missingScopes.length > 0 && (
        <div className="sm:col-span-2" data-testid="connector-scopes">
          <div className="text-muted-foreground">{t('detail_scopes')}</div>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
            {[...scopes, ...row.missingScopes.filter(s => !scopes.includes(s))].map(scope => (
              <li key={scope} className={cn('flex items-center gap-1.5', missing.has(scope) ? 'text-destructive' : 'text-foreground/85')}>
                {missing.has(scope) ? <CircleAlert className="size-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                {scope}
                {missing.has(scope) && <span className="font-sans text-[11px]">{t('detail_missing')}</span>}
              </li>
            ))}
          </ul>
          {missing.size > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('detail_scopes_fix')}</p>}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="inline text-muted-foreground">{`${label}: `}</dt>
      <dd className={cn('inline break-words', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}

/**
 * Whose account the grant is on and what it granted — the installation's
 * organization and repositories, the Slack workspace, the Atlassian site —
 * read against the source's own list where the source has one. A repository
 * the source lists that the installation never covered is named here.
 * @param props
 * @param props.source - The connection.
 * @param props.grant - What the vendor granted.
 */
function GrantDetail({ source, grant }: { source: Source; grant: GrantSummary }) {
  const t = useTranslations('Connectors');
  const granted = grant.granted;
  const listed = Array.isArray(source.config.repos)
    ? (source.config.repos as unknown[]).filter((r): r is string => typeof r === 'string' && r.length > 0)
    : [];
  const grantedSet = new Set((granted?.items ?? []).map(name => name.toLowerCase()));
  const listedSet = new Set(listed.map(name => name.toLowerCase()));
  const rows: Array<{ name: string; state: 'read' | 'not-granted' | 'not-listed' }> = granted
    ? [
        ...listed.map(name => ({ name, state: grantedSet.has(name.toLowerCase()) ? 'read' as const : 'not-granted' as const })),
        ...granted.items.filter(name => !listedSet.has(name.toLowerCase())).map(name => ({ name, state: listed.length > 0 ? 'not-listed' as const : 'read' as const })),
      ]
    : [];
  const missing = rows.filter(r => r.state === 'not-granted').length;
  return (
    <div className="sm:col-span-2" data-testid="connector-grant">
      <Fact label={t('detail_account')} value={grant.account ?? '—'} />
      {granted && (
        <div className="mt-1">
          <div className="text-muted-foreground">{granted.label}</div>
          {rows.length === 0
            ? <span className="text-muted-foreground">{t('detail_none_granted')}</span>
            : (
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
                  {rows.map(r => (
                    <li key={r.name} className="flex items-center gap-1.5" data-grant-state={r.state}>
                      {r.state === 'not-granted'
                        ? <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
                        : <Check className={cn('size-3.5 shrink-0', r.state === 'not-listed' ? 'text-muted-foreground/60' : 'text-emerald-600 dark:text-emerald-500')} aria-hidden />}
                      <span className={r.state === 'not-listed' ? 'text-muted-foreground' : ''}>{r.name}</span>
                      {r.state === 'not-granted' && <span className="font-sans text-destructive">{t('detail_not_granted')}</span>}
                      {r.state === 'not-listed' && <span className="font-sans text-muted-foreground">{t('detail_not_listed')}</span>}
                    </li>
                  ))}
                </ul>
              )}
          {granted.note && <p className="mt-1 text-xs text-muted-foreground">{granted.note}</p>}
          {missing > 0 && <p className="mt-1 text-xs text-destructive">{t('detail_not_granted_fix', { count: missing })}</p>}
        </div>
      )}
    </div>
  );
}
