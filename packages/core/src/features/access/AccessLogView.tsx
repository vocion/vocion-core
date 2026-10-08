'use client';

import type { ToolbarFacet, ToolbarTab } from '@/components/patterns';
import { Bot, Download, Eye, FileOutput, Search, ShieldCheck } from 'lucide-react';
import { useCallback } from 'react';
import { Column, ListEmpty, ListRow, ListRows, ListToolbar, Subline } from '@/components/patterns';
import { Link, usePathname, useRouter } from '@/libs/I18nNavigation';

/**
 * The Access log list — one row per read of a record in this workspace, newest
 * first. The List archetype against a server read: every control writes the
 * URL (`?action=`, `?who=`, `?days=`) and the page re-reads, the way Search
 * does, so a filtered view survives a reload and can be pasted to a colleague.
 *
 * A row is a door to the record that was read. Beside it, two narrowings: who
 * else read this record, and what else this reader read — the two questions
 * an access log is opened to answer.
 */

export type AccessLogRowData = {
  key: string;
  /** ISO timestamp. */
  at: string;
  action: 'view' | 'download' | 'export' | 'search';
  /** What was read, in words: its title when we hold it, else what kind and which. */
  record: string;
  recordHref: string | null;
  /** `?kind=&record=` for "who else read this"; null for a search. */
  recordFilter: { kind: string; id: string } | null;
  /** Who: a person's name, an agent's name, a token, or "Anyone with the link". */
  actor: string;
  actorKind: 'user' | 'agent' | 'token' | 'link';
  /** The actor's own id for "what else did they read"; null for a link. */
  actorFilter: string | null;
  /** For an agent: who it was reading for, and the run. */
  forWhom: string | null;
  run: { label: string; href: string | null } | null;
  /** Where it happened: "record page", "preview", "read_object", … */
  via: string;
  /** A small fact: "12 hits", "PDF". */
  detail: string | null;
};

export type AccessLogFilters = {
  action: string;
  who: string;
  days: string;
};

const ACTION_TABS: ToolbarTab[] = [
  { key: '', label: 'All' },
  { key: 'view', label: 'Viewed' },
  { key: 'download', label: 'Downloaded' },
  { key: 'export', label: 'Exported' },
  { key: 'search', label: 'Searched' },
];

const WHO_OPTIONS = [
  { key: '', label: 'Everyone' },
  { key: 'user', label: 'People' },
  { key: 'agent', label: 'Agents' },
  { key: 'token', label: 'API tokens' },
  { key: 'link', label: 'Share links' },
] as const;

const WINDOW_OPTIONS = [
  { key: '', label: 'Last 30 days' },
  { key: '7', label: 'Last 7 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'all', label: 'Everything kept' },
] as const;

const ACTION_ICON = { view: Eye, download: Download, export: FileOutput, search: Search } as const;
const ACTION_WORD = { view: 'viewed', download: 'downloaded', export: 'exported', search: 'searched' } as const;

/** Fixed locale + UTC so the server render and the client render agree. */
const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${WHEN.format(d)} UTC`;
}

export function AccessLogView(props: {
  rows: readonly AccessLogRowData[];
  filters: AccessLogFilters;
  /** A narrowing set by a row link (`?actor=` / `?record=`), said in words, with the URL that clears it. */
  scope: { label: string; clearHref: string } | null;
  hasMore: boolean;
  moreHref: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { rows, filters, scope } = props;

  const go = useCallback((next: Partial<AccessLogFilters>) => {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    for (const [k, v] of Object.entries(merged)) {
      if (v) {
        params.set(k, v);
      } else {
        params.delete(k);
      }
    }
    params.delete('n');
    const s = params.toString();
    router.push(`${pathname}${s ? `?${s}` : ''}`);
  }, [filters, router, pathname]);

  const facets: ToolbarFacet[] = [
    { name: 'who', label: 'Who', value: filters.who, onChange: who => go({ who }), options: WHO_OPTIONS },
    { name: 'days', label: 'When', value: filters.days, onChange: days => go({ days }), options: WINDOW_OPTIONS },
  ];

  return (
    <>
      <ListToolbar
        tabs={{ items: ACTION_TABS, value: filters.action, onChange: action => go({ action }), label: 'What was done' }}
        facets={facets}
      />
      {scope && (
        <p className="flex items-center gap-2 py-2 text-[13px] text-muted-foreground">
          <span>
            Only
            {' '}
            <span className="font-medium text-foreground">{scope.label}</span>
          </span>
          <Link href={scope.clearHref} className="underline hover:text-foreground">Show everything</Link>
        </p>
      )}
      {rows.length === 0
        ? (
            <ListEmpty
              variant={scope || filters.action || filters.who ? 'inline' : 'page'}
              icon={ShieldCheck}
              title={scope || filters.action || filters.who ? 'No reads match.' : 'Nothing read yet in this window.'}
              description="Every view, download, export and search of a record in this workspace lands here — by a person, an agent, an API token or a share link."
            />
          )
        : (
            <ListRows>
              {rows.map((r) => {
                const Icon = r.actorKind === 'agent' ? Bot : ACTION_ICON[r.action];
                return (
                  <ListRow
                    key={r.key}
                    data-testid="access-log-row"
                    icon={Icon}
                    href={r.recordHref ?? undefined}
                    title={r.record}
                    subline={(
                      <Subline
                        separator="·"
                        segments={[
                          `${r.actor} ${ACTION_WORD[r.action]}`,
                          r.forWhom ? `for ${r.forWhom}` : null,
                          r.run ? r.run.label : null,
                          `via ${r.via}`,
                          r.detail,
                        ]}
                      />
                    )}
                    columnsAside={(
                      <>
                        <Column kind="date" className="w-36">{whenLabel(r.at)}</Column>
                      </>
                    )}
                    actions={(
                      <>
                        {r.recordFilter && (
                          <Link href={`${pathname}?kind=${encodeURIComponent(r.recordFilter.kind)}&record=${encodeURIComponent(r.recordFilter.id)}`} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground">
                            Who else read this
                          </Link>
                        )}
                        {r.actorFilter && (
                          <Link href={`${pathname}?actor=${encodeURIComponent(r.actorFilter)}`} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground">
                            {r.actorKind === 'agent' ? 'What else this agent read' : 'What else they read'}
                          </Link>
                        )}
                      </>
                    )}
                  />
                );
              })}
            </ListRows>
          )}
      {props.hasMore && props.moreHref && (
        <div className="flex justify-center py-4">
          <Link href={props.moreHref} className="text-sm text-muted-foreground underline hover:text-foreground">Show more</Link>
        </div>
      )}
    </>
  );
}
