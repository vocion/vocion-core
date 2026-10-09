'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PageWorkspace } from './workspacesPage';
import type { SwitcherAccount } from './workspaceSwitch';
import type { OrgsMode } from '@/services/OrgPolicy';
import { Check, Plus, Search } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { routing } from '@/libs/I18nRouting';
import { client } from '@/libs/Orpc';
import { relativeLabel } from '@/libs/timeAgo';
import { cn } from '@/utils/Helpers';
import { arrangeWorkspaces, rowLine } from './workspacesPage';
import { crossAccountSlug, projectAccent, WORKSPACE_HOME, workspaceSwitchHref } from './workspaceSwitch';

/**
 * ALL WORKSPACES — the switcher's "All workspaces →" (founder, 2026-10-09:
 * "This isn't a great UI": big cards saying "No agents yet", a subtitle that
 * said "in this Org" over every Org, placeholders first, no search, no way to
 * make one, no sense of what was used, no marker for where you are).
 *
 * Calm and useful, phone first: search at the top (`/` focuses it), "New
 * workspace" as the one primary action, Personal first, then one quiet group
 * per Org on a multi-Org install (`workspacesPage.ts` holds the order).
 * Compact rows: the workspace's mark, its name, one line — "Atlas · 7 agents ·
 * active 2h ago" — a count when something waits on the person there, and a
 * check on the current one. Arrow keys move through the rows, Enter opens.
 * Archived ones sit behind "Show archived". A row opens its workspace's chat
 * through the one switch route, as the picker does; any drawer closes on the
 * navigation (`components/ui/drawerClose.ts`).
 */

type Overview = {
  workspaces: PageWorkspace[];
  accounts: SwitcherAccount[];
  marks: Record<string, { light: string; dark?: string }>;
  account: SwitcherAccount | null;
  activeId: string | null;
  orgsMode: OrgsMode;
};

/** The rows' links, in page order: what the arrow keys walk. */
const ROW = '[data-workspace-row]';

/**
 * Up and Down move through the rows (from the search box too); Home and End
 * jump to either end. Enter on a row is the link's own.
 * @param e - The key, anywhere on the list.
 */
function moveThroughRows(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
    return;
  }
  if (e.target instanceof HTMLInputElement && (e.key === 'Home' || e.key === 'End')) {
    return;
  }
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ROW));
  if (rows.length === 0) {
    return;
  }
  e.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home'
    ? 0
    : e.key === 'End'
      ? rows.length - 1
      : at === -1
        ? (e.key === 'ArrowDown' ? 0 : rows.length - 1)
        : Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
  rows[next]?.focus();
}

/**
 * One workspace.
 * @param props - The row's inputs.
 * @param props.w - The workspace.
 * @param props.href - Where it opens.
 * @param props.line - Its one quiet line.
 * @param props.waiting - What waits on the person there.
 * @param props.current - Whether it is the one open now.
 * @param props.currentLabel - "Current", for a screen reader.
 * @param props.waitingLabel - "3 waiting on you".
 */
function WorkspaceRow(props: { w: PageWorkspace; href: string; line: string; waiting: number; current: boolean; currentLabel: string; waitingLabel: string }) {
  const { w } = props;
  return (
    <a
      href={props.href}
      data-workspace-row
      data-testid="workspace-row"
      data-workspace={w.slug}
      aria-current={props.current ? 'true' : undefined}
      className={cn(
        'group flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-hidden transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40',
        props.current && 'bg-surface-soft',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg text-[13px] font-semibold text-white" style={{ background: projectAccent(w.slug) }} aria-hidden>
        {w.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[14px] font-medium', w.placeholder ? 'text-muted-foreground' : 'text-foreground')}>{w.name}</span>
        <span className="block truncate text-[12.5px] text-muted-foreground" data-testid="workspace-row-line">{props.line}</span>
      </span>
      {props.waiting > 0 && (
        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-amber px-1.5 text-[11px] font-semibold text-white tabular-nums" aria-label={props.waitingLabel} title={props.waitingLabel} data-testid="workspace-row-waiting">
          {props.waiting}
        </span>
      )}
      {props.current && (
        <span className="shrink-0 text-foreground" data-testid="workspace-row-current">
          <Check className="size-4" aria-hidden />
          <span className="sr-only">{props.currentLabel}</span>
        </span>
      )}
    </a>
  );
}

/**
 * A quiet group heading: the Org's mark when it has one, then its name.
 * @param props - The heading's inputs.
 * @param props.label - What it says.
 * @param props.mark - The Org's mark.
 * @param props.mark.light
 * @param props.mark.dark
 */
function GroupHeading(props: { label: string; mark?: { light: string; dark?: string } }) {
  return (
    <h2 className="flex items-center gap-2 px-2 pt-5 pb-1 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase" data-testid="workspace-group">
      {props.mark && (
        <span className="grid size-4 place-items-center" aria-hidden>
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={props.mark.light} alt="" className={cn('max-h-4 max-w-4 object-contain', props.mark.dark && 'dark:hidden')} />
          {props.mark.dark && (
            // eslint-disable-next-line next/no-img-element
            <img src={props.mark.dark} alt="" className="hidden max-h-4 max-w-4 object-contain dark:block" />
          )}
        </span>
      )}
      {props.label}
    </h2>
  );
}

/**
 * Make a workspace: a name, then it opens on its lead.
 * @param props - The dialog's inputs.
 * @param props.open - Whether it shows.
 * @param props.onOpenChange - Open or close it.
 * @param props.orgName - The Org it lands in, said on a multi-Org install.
 * @param props.onCreated - Called with the new workspace's slug.
 */
function NewWorkspaceDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; orgName: string | null; onCreated: (slug: string) => void }) {
  const t = useTranslations('WorkspacesPage');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim() || busy) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const made = await client.projects.create({ name });
      props.onCreated(made.slug);
    } catch (error) {
      setProblem(t('new_failed', { reason: error instanceof Error ? error.message : String(error) }));
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('new_title')}</DialogTitle>
          <DialogDescription>
            {props.orgName ? `${t('new_in_org', { org: props.orgName })} · ` : ''}
            {t('new_description')}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <Input aria-label={t('new_name')} placeholder={t('new_name')} value={name} onChange={e => setName(e.target.value)} maxLength={80} data-testid="new-workspace-name" />
          {problem && <p className="text-[13px] text-destructive" role="alert">{problem}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>{t('new_cancel')}</Button>
            <Button type="submit" disabled={!name.trim() || busy} data-testid="new-workspace-create">{t('new_create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The page's body: search, the groups, archived behind a link.
 * @param props - Seams for stories and tests.
 * @param props.initial - Data to show instead of reading it.
 * @param props.initial.overview
 * @param props.initial.waiting
 * @param props.now - The clock.
 * @param props.navigate - Where a created workspace is opened.
 */
export function WorkspacesList(props: { initial?: { overview: Overview; waiting: Record<string, number> }; now?: number; navigate?: (href: string) => void } = {}) {
  const t = useTranslations('WorkspacesPage');
  const locale = useLocale();
  const { data: session } = useSession();
  const [overview, setOverview] = useState<Overview | null>(props.initial?.overview ?? null);
  const [waiting, setWaiting] = useState<Record<string, number>>(props.initial?.waiting ?? {});
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.initial) {
      return;
    }
    let cancelled = false;
    client.projects.overview()
      .then((o) => {
        if (!cancelled) {
          setOverview(o as Overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOverview({ workspaces: [], accounts: [], marks: {}, account: null, activeId: null, orgsMode: 'single' });
        }
      });
    // What waits on the person in each: the one cross-workspace count.
    client.inbox.mineCount()
      .then((c) => {
        if (!cancelled) {
          setWaiting(Object.fromEntries(c.workspaces.filter(w => w.yours > 0).map(w => [w.id, w.yours])));
        }
      })
      .catch(() => { /* a badge that cannot be counted is left off, not guessed */ });
    return () => {
      cancelled = true;
    };
  }, [props.initial]);

  // `/` focuses the search, unless the person is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const multiOrg = overview?.orgsMode === 'multi';
  const arranged = useMemo(
    () => (overview ? arrangeWorkspaces(overview.workspaces, { accounts: overview.accounts, multiOrg, query }) : null),
    [overview, multiOrg, query],
  );
  // Read once per mount: "active 2h ago" need not tick.
  const [now] = useState(() => props.now ?? Date.now());
  const activeId = overview?.activeId ?? session?.user?.projectId ?? null;

  const hrefFor = useCallback((w: PageWorkspace) => workspaceSwitchHref({
    slug: w.slug,
    pathname: WORKSPACE_HOME,
    locale,
    defaultLocale: routing.defaultLocale,
    accountSlug: crossAccountSlug(w, overview?.account?.id, overview?.accounts ?? []),
  }), [locale, overview]);

  const row = (w: PageWorkspace) => (
    <WorkspaceRow
      key={w.id}
      w={w}
      href={hrefFor(w)}
      line={rowLine(w, {
        agents: t('agents', { count: w.agentCount }),
        active: w.lastActiveAt ? t('active', { ago: relativeLabel(new Date(w.lastActiveAt), now) }) : null,
        empty: t('empty'),
      })}
      waiting={waiting[w.id] ?? 0}
      waitingLabel={t('waiting', { count: waiting[w.id] ?? 0 })}
      current={w.id === activeId}
      currentLabel={t('current')}
    />
  );

  const canCreate = session?.user?.role === 'admin';
  const shown = arranged ? arranged.personal.length + arranged.groups.reduce((n, g) => n + g.workspaces.length, 0) : 0;

  return (
    <div className="flex flex-col" data-testid="workspaces-page">
      <div className="flex items-center gap-2 pb-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/70 bg-background px-3 focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                document.querySelector<HTMLElement>(ROW)?.focus();
              }
            }}
            placeholder={t('search')}
            aria-label={t('search')}
            aria-keyshortcuts="/"
            data-testid="workspaces-search"
            className="h-full w-full min-w-0 bg-transparent text-[14px] outline-hidden placeholder:text-muted-foreground/60"
          />
          <kbd className="hidden shrink-0 rounded border border-border/70 px-1.5 font-mono text-[11px] text-muted-foreground sm:inline" aria-hidden>/</kbd>
        </label>
        {canCreate && (
          <Button onClick={() => setCreating(true)} className="h-10 shrink-0" data-testid="new-workspace">
            <Plus className="size-4" aria-hidden />
            <span className="max-sm:sr-only">{t('new_workspace')}</span>
          </Button>
        )}
      </div>

      {!arranged
        ? <p className="px-2 py-6 text-[13px] text-muted-foreground">{t('loading')}</p>
        : (
            // Arrow keys over the rows; each row stays a native link, so Tab and Enter are the browser's.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div onKeyDown={moveThroughRows} data-testid="workspaces-list">
              {shown === 0 && (
                <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">{query ? t('no_match') : t('none')}</p>
              )}
              {arranged.personal.length > 0 && <div className="flex flex-col pt-1">{arranged.personal.map(row)}</div>}
              {arranged.groups.map(g => (
                <section key={g.account?.id ?? 'all'} aria-label={g.account?.name}>
                  {g.account ? <GroupHeading label={g.account.name} mark={overview?.marks[g.account.id]} /> : arranged.personal.length > 0 && <div className="mt-3 border-t border-border/60" aria-hidden />}
                  <div className="flex flex-col pt-1">{g.workspaces.map(row)}</div>
                </section>
              ))}
              {arranged.archived.length > 0 && (
                <div className="pt-6">
                  {showArchived && (
                    <section aria-label={t('archived')} data-testid="workspaces-archived">
                      <GroupHeading label={t('archived')} />
                      <div className="flex flex-col pt-1 opacity-80">{arranged.archived.map(row)}</div>
                    </section>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowArchived(s => !s)}
                    className="mt-2 min-h-10 px-2 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    data-testid="workspaces-show-archived"
                  >
                    {showArchived ? t('hide_archived') : t('show_archived', { count: arranged.archived.length })}
                  </button>
                </div>
              )}
            </div>
          )}

      <NewWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        orgName={multiOrg ? overview?.account?.name ?? null : null}
        onCreated={slug => (props.navigate ?? (h => window.location.assign(h)))(workspaceSwitchHref({ slug, pathname: WORKSPACE_HOME, locale, defaultLocale: routing.defaultLocale }))}
      />
    </div>
  );
}
