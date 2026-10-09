'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import type { PickerDetail } from './pickerModel';
import type { WorkspaceDirectory } from './useWorkspaceDirectory';
import type { SwitcherAccount, SwitcherProject, WorkspaceSwitcherTargetPath } from './workspaceSwitch';
import type { Tint } from '@/libs/tints';
import type { OrgsMode } from '@/services/OrgPolicy';
import { ArrowLeftRight, ArrowRight, Check, ChevronLeft, ChevronRight, Search, Settings2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { DRAWER_CLOSE_ATTR } from '@/components/ui/drawerClose';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/useSidebar';
import { useOrgBrand } from '@/features/branding/BrandContext';
import { Link, usePathname } from '@/libs/I18nNavigation';
import { routing } from '@/libs/I18nRouting';
import { client } from '@/libs/Orpc';
import { relativeLabel } from '@/libs/timeAgo';
import { TINT_BG } from '@/libs/tints';
import { cn } from '@/utils/Helpers';
import { orderForPicker, pickerLine, pickerOrgs } from './pickerModel';
import { ALL_WORKSPACES_HREF, crossAccountSlug, filterProjects, projectAccent, WORKSPACE_HOME, workspaceSwitchHref } from './workspaceSwitch';

/**
 * Workspace context, at the head of the selected app's nav (Vocion 5.0 —
 * it was bottom-left before the app rail; ElevenLabs pattern, Chris 2026-09-15): the
 * workspace's initial-avatar in its accent, its name, the account beneath,
 * and a visible ⇄ Switch affordance. Clicking opens the workspace list
 * directly — search, the person's workspaces (name, slug, check on the current
 * one), a toggle revealing empty seed projects, and "Manage workspace" as the
 * last row. No nested submenu. Switching navigates through
 * `/w/<slug>/<same page>` — the one switch mechanism (#336).
 *
 * ONE CONTROL FOR WHERE YOU ARE. Orgs (what people call a `tenant_account`)
 * show only on a multi-Org deployment, which an extension turns on
 * (`services/OrgPolicy.ts`). There the picker has two levels, iOS style
 * (founder, 2026-10-09): Personal, then one row per Org; an Org with one
 * workspace opens it from its row, one with several slides to its
 * workspaces ("‹ Orgs" back, ← and Esc too). Search reaches every Org at
 * once, flat. A switch into another Org's workspace is also how a person
 * switches Org: tenancy follows the picked workspace (vocion-core#128). The
 * chip names the workspace alone, with the Org's square mark; the Org's name
 * is said only in the picker (never "S.. › Squatch"). A single-Org install
 * (the default) never names an Org and has no Org level. This is the one
 * place to switch; a surface outside the sidebar can still open this popover
 * via {@link OPEN_WORKSPACE_SWITCHER}. Collapsed to the icon rail, the avatar
 * alone is the button. Arrow keys move through the list, from the search box
 * too. Every switch lands on the target's home (`workspaceSwitchPath`).
 *
 * It is also every app's workspace picker — one switcher, not one per app
 * (principle 6): the sidebar hands it only the workspaces that have the
 * selected app, a `placeholder` for when the current workspace is not one of
 * them, and `targetPath` to say which page the switch lands on.
 */

export const OPEN_WORKSPACE_SWITCHER = 'vocion:open-workspace-switcher';

/** Ask the sidebar's switcher to open from anywhere else on the page. */
export function openWorkspaceSwitcher(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OPEN_WORKSPACE_SWITCHER));
  }
}

export type WorkspaceSwitcherProps = {
  /** The Org this session is in — the eyebrow under the workspace name, on a multi-Org deployment. */
  account?: { id?: string; name: string } | null;
  /** Every Org the person belongs to. On a multi-Org deployment, two or more group the list by Org. */
  accounts?: SwitcherAccount[];
  /** The deployment's `VOCION_ORGS`. Default `single`: no Org named, no grouping. */
  orgsMode?: OrgsMode;
  /** Lead, last activity and what waits on the person, per workspace id (`projects.overview`, `inbox.mineCount`). */
  details?: Record<string, PickerDetail>;
  /** Each Org's square mark, by account id, for its level-1 row. */
  marks?: Record<string, { light: string; dark?: string }>;
  projects: SwitcherProject[] | null;
  activeId: string | null;
  onManage?: () => void;
  /** Override navigation (stories/tests). Default: `window.location.assign`. */
  navigate?: (href: string) => void;
  /** Force the popover open (stories). */
  defaultOpen?: boolean;
  collapsed?: boolean;
  /**
   * Shown in place of a name when `activeId` is not in `projects` — an app
   * picker the current workspace is not listed in. Without it the first
   * workspace stands in for the active one, as it always has.
   */
  placeholder?: string;
  /** The page a switch to `p` lands on. Default: the workspace's home, Chat. */
  targetPath?: WorkspaceSwitcherTargetPath;
  /** Which way the list opens. Default: up, as it did from the bottom of the sidebar. */
  side?: 'top' | 'bottom';
  /** The app this picker belongs to: the chip wears its tint (front doors, `libs/tints.ts`). */
  tint?: Tint;
  /**
   * The Org's square MARK, when its brand has one: the chip's avatar on every
   * install, Cloud included (one brand per region, `libs/branding/chrome.ts`).
   * Never the wordmark, unreadable at this size; without a mark, the
   * workspace's initial.
   */
  logo?: { light: string; dark?: string } | null;
};

/**
 * One row in a switcher list: an initial in its accent, a name, a mono
 * sub-line, a check on the current one. Exported so a list an extension adds
 * beside this one (`nav.aboveWorkspaceSwitcher`) has the same shape
 * (principle 6).
 * @param props - The row's inputs.
 * @param props.name - What the row is called.
 * @param props.sub - The line under it (a slug, or why it is unavailable).
 * @param props.accentKey - What the accent is derived from (a slug).
 * @param props.selected - Whether it is the current one.
 * @param props.disabled - Whether it can be picked.
 * @param props.onPick - Called when the row is clicked.
 * @param props.suffix
 * @param props.waiting
 * @param props.mark
 * @param props.drills
 * @param props.onKeyDown
 * @param props.testId
 */
export function SwitcherRow(props: {
  name: string;
  sub?: string | null;
  accentKey: string;
  selected: boolean;
  disabled?: boolean;
  onPick: () => void;
  /** After the name, muted: the Org in flat search results ("Factory · Northwind"). */
  suffix?: string | null;
  /** A count of what waits on the person there. */
  waiting?: number;
  /** An image in place of the initial: an Org's square mark. */
  mark?: { light: string; dark?: string } | null;
  /** The row drills into a level rather than opening a workspace. */
  drills?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      // Picking another workspace leaves this page, drawer and all
      // (`components/ui/drawerClose.ts`); re-picking the current one only
      // closes the list, and drilling into an Org stays.
      {...{ [DRAWER_CLOSE_ATTR]: props.selected || props.drills ? 'false' : '' }}
      role="option"
      aria-selected={props.selected}
      aria-disabled={props.disabled || undefined}
      disabled={props.disabled}
      onClick={props.onPick}
      onKeyDown={props.onKeyDown}
      data-testid={props.testId}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-hidden transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60 max-md:min-h-11"
    >
      {props.mark
        ? (
            <span className="grid size-6 shrink-0 place-items-center" aria-hidden>
              {/* eslint-disable-next-line next/no-img-element */}
              <img src={props.mark.light} alt="" className={cn('max-h-6 max-w-6 object-contain', props.mark.dark && 'dark:hidden')} draggable={false} />
              {props.mark.dark && (
                // eslint-disable-next-line next/no-img-element
                <img src={props.mark.dark} alt="" className="hidden max-h-6 max-w-6 object-contain dark:block" draggable={false} />
              )}
            </span>
          )
        : (
            <span className="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white" style={{ background: projectAccent(props.accentKey) }} aria-hidden>
              {props.name.charAt(0).toUpperCase()}
            </span>
          )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {props.name}
          {props.suffix && <span className="font-normal text-muted-foreground">{` · ${props.suffix}`}</span>}
        </span>
        {props.sub && <span className="block truncate text-[11.5px] text-muted-foreground" data-testid="switcher-row-sub">{props.sub}</span>}
      </span>
      {(props.waiting ?? 0) > 0 && (
        <span className="inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-brand-amber px-1 text-[10.5px] font-semibold text-white tabular-nums" data-testid="switcher-row-waiting">
          {props.waiting}
        </span>
      )}
      {props.selected && <Check className="size-4 shrink-0 text-foreground" aria-hidden />}
      {props.drills && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </button>
  );
}

/**
 * One workspace row.
 * @param props - The row's inputs.
 * @param props.project - The workspace this row switches to.
 * @param props.selected - Whether it is the active workspace.
 * @param props.onPick - Called with the workspace when the row is clicked.
 * @param props.line
 * @param props.waiting
 * @param props.suffix
 */
function WorkspaceOption(props: { project: SwitcherProject; selected: boolean; onPick: (p: SwitcherProject) => void; line?: string | null; waiting?: number; suffix?: string | null }) {
  const p = props.project;
  // Never the slug (founder, 2026-10-09): what it is, "Atlas · 7 agents · active 2h ago".
  return <SwitcherRow name={p.name} sub={props.line} suffix={props.suffix} waiting={props.waiting} accentKey={p.slug} selected={props.selected} onPick={() => props.onPick(p)} testId="switcher-workspace" />;
}

/**
 * Radix's open-autofocus handler: let it focus on a pointer device, refuse on touch.
 * @param e
 */
export function keepKeyboardDownOnTouch(e: Event): void {
  if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
    e.preventDefault();
  }
}

/**
 * Arrow keys move through the picker's rows, from the search box too; Home
 * and End jump to either end. Tab still walks the same rows.
 * @param e - The key, anywhere inside the picker.
 */
function moveThroughOptions(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
    return;
  }
  const inSearch = e.target instanceof HTMLInputElement;
  if (inSearch && (e.key === 'Home' || e.key === 'End')) {
    return;
  }
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])'));
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

export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  const t = useTranslations('DashboardLayout');
  const pathname = usePathname();
  const locale = useLocale();
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const [query, setQuery] = useState('');
  // Level 2: the Org drilled into, and which way the last move went (for the slide).
  const [orgLevel, setOrgLevel] = useState<string | null>(null);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_WORKSPACE_SWITCHER, onOpen);
    return () => window.removeEventListener(OPEN_WORKSPACE_SWITCHER, onOpen);
  }, []);

  const loading = props.projects === null;
  const projects = useMemo(() => props.projects ?? [], [props.projects]);
  const active = projects.find(p => p.id === props.activeId) ?? (props.placeholder === undefined ? projects[0] ?? null : null);
  const visible = useMemo(() => filterProjects(projects, { query, activeId: active?.id ?? null }), [projects, query, active]);
  const live = useMemo(() => filterProjects(projects, { activeId: active?.id ?? null }), [projects, active]);
  const accounts = props.accounts ?? [];
  const details = props.details ?? {};
  // Two levels only where there is more than one Org to pick between.
  const levelled = props.orgsMode === 'multi' && accounts.length > 1;
  const level1 = useMemo(() => pickerOrgs(live, accounts, details, props.account?.id), [live, accounts, details, props.account?.id]);
  const drilled = levelled && orgLevel ? level1.orgs.find(o => o.account.id === orgLevel) ?? null : null;
  const searching = query.trim() !== '';
  const orgName = new Map(accounts.map(a => [a.id, a.name]));

  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // A picker opens where a person starts: at the Orgs, with nothing typed.
      setOrgLevel(null);
      setQuery('');
    }
  };
  const drillInto = (accountId: string) => {
    setDirection('in');
    setOrgLevel(accountId);
  };
  const back = () => {
    setDirection('out');
    setOrgLevel(null);
  };

  const go = (p: SwitcherProject) => {
    if (active && p.id === active.id) {
      openChange(false);
      return;
    }
    // The target's home, never this page or its query (`workspaceSwitchPath`).
    const target = props.targetPath ? props.targetPath(p, pathname) : WORKSPACE_HOME;
    const href = workspaceSwitchHref({
      slug: p.slug,
      pathname: target,
      locale,
      defaultLocale: routing.defaultLocale,
      accountSlug: crossAccountSlug(p, props.account?.id, accounts),
    });
    (props.navigate ?? (h => window.location.assign(h)))(href);
  };

  const line = (p: SwitcherProject) => pickerLine(p, details[p.id], {
    agents: n => t('picker_agents', { count: n }),
    active: iso => t('picker_active', { ago: relativeLabel(new Date(iso), now) }),
  });
  const option = (p: SwitcherProject, suffix?: string | null) => (
    <WorkspaceOption key={p.id} project={p} selected={p.id === active?.id} onPick={go} line={line(p)} waiting={details[p.id]?.waiting} suffix={suffix} />
  );

  // The chip says the workspace, with its Org's square mark when the Org has
  // one (founder, 2026-10-09: never "S.. › Squatch"); the Org's name is said
  // in the picker, not here.
  const name = active?.name ?? (loading ? '' : props.placeholder ?? t('workspace_fallback'));
  const railLabel = name;
  const initial = (name || 'W').charAt(0).toUpperCase();
  const accent = active ? projectAccent(active.slug) : 'oklch(0.7 0 0)';

  const avatar = props.logo && !loading
    ? (
        <span className="grid size-7 shrink-0 place-items-center" aria-hidden data-testid="workspace-switcher-logo">
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={props.logo.light} alt="" className={cn('max-h-7 max-w-7 object-contain', props.logo.dark && 'dark:hidden')} draggable={false} />
          {props.logo.dark && (
            // eslint-disable-next-line next/no-img-element
            <img src={props.logo.dark} alt="" className="hidden max-h-7 max-w-7 object-contain dark:block" draggable={false} />
          )}
        </span>
      )
    : (
        <span
          className={cn('grid size-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold text-white', loading && 'animate-pulse bg-muted text-transparent')}
          style={loading ? undefined : { background: accent }}
          aria-hidden
        >
          {initial}
        </span>
      );

  const trigger = props.collapsed
    ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger
              aria-label={railLabel || t('switch_workspace')}
              className="mx-auto flex size-8 items-center justify-center rounded-lg outline-hidden transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              {avatar}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{railLabel || t('switch_workspace')}</TooltipContent>
        </Tooltip>
      )
    : (
        <PopoverTrigger
          aria-label={t('switch_workspace')}
          data-tint={props.tint}
          className={cn(
            'group/ws flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            props.tint ? [TINT_BG[props.tint], 'hover:brightness-[0.98] dark:hover:brightness-110'] : 'hover:bg-surface-hover data-[state=open]:bg-surface-hover',
          )}
        >
          {avatar}
          <span className="min-w-0 flex-1" data-testid="workspace-switcher-where">
            {loading
              ? <span className="block h-3.5 w-28 animate-pulse rounded bg-muted" />
              : <span className="block truncate text-[13px] leading-tight font-medium text-foreground">{name}</span>}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors group-hover/ws:bg-background group-hover/ws:text-foreground">
            <ArrowLeftRight className="size-3.5" aria-hidden />
            {t('switch')}
          </span>
        </PopoverTrigger>
      );

  // ← goes back a level (outside the search box, where it moves the caret).
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowLeft' && drilled && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      back();
      return;
    }
    moveThroughOptions(e);
  };
  // → or Enter on an Org drills in; the row's own click handles Enter too.
  const orgKey = (accountId: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      drillInto(accountId);
    }
  };
  const slide = direction === 'in' ? 'slide-in-from-right-6' : 'slide-in-from-left-6';

  let body: ReactNode;
  if (searching) {
    // Search reaches every Org at once, flat, each row saying its Org.
    body = visible.length === 0
      ? <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">{t('no_workspaces_match')}</div>
      : visible.map(p => option(p, levelled && p.kind !== 'personal' ? orgName.get(p.accountId ?? '') : null));
  } else if (levelled && drilled) {
    body = (
      <div key={drilled.account.id} role="group" aria-label={drilled.account.name} className={cn('animate-in fade-in-0 duration-200 motion-reduce:animate-none', slide)} data-testid="switcher-level-workspaces">
        <div className="sticky top-0 z-10 flex items-center gap-1 bg-popover pb-1">
          <button type="button" onClick={back} className="inline-flex min-h-8 items-center gap-0.5 rounded-md px-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground max-md:min-h-11" data-testid="switcher-back">
            <ChevronLeft className="size-4" aria-hidden />
            {t('picker_orgs')}
          </button>
          <span className="min-w-0 flex-1 truncate pr-6 text-center text-[13px] font-semibold text-foreground" data-testid="switcher-level-title">{drilled.account.name}</span>
        </div>
        {drilled.workspaces.map(p => option(p))}
      </div>
    );
  } else if (levelled) {
    body = (
      <div key="orgs" className={cn('animate-in fade-in-0 duration-200 motion-reduce:animate-none', orgLevel === null && direction === 'out' && slide)} data-testid="switcher-level-orgs">
        {level1.personal.map(p => option(p))}
        {level1.orgs.map(o => (
          <SwitcherRow
            key={o.account.id}
            name={o.account.name}
            sub={o.only ? o.only.name : t('picker_workspaces', { count: o.workspaces.length })}
            accentKey={o.account.slug}
            mark={props.marks?.[o.account.id] ?? null}
            selected={o.current}
            waiting={o.waiting}
            drills={!o.only}
            onPick={() => (o.only ? go(o.only) : drillInto(o.account.id))}
            onKeyDown={o.only ? undefined : orgKey(o.account.id)}
            testId="switcher-org"
          />
        ))}
      </div>
    );
  } else {
    // One Org: no level 1. Personal first, then the rest by recent use.
    const personal = visible.filter(p => p.kind === 'personal');
    body = visible.length === 0
      ? <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">{t('no_workspaces_match')}</div>
      : [...personal, ...orderForPicker(visible.filter(p => p.kind !== 'personal'), details)].map(p => option(p));
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      {trigger}
      {/* On a touch device the popover must not hand focus to the search box:
          that raises the keyboard over the list a person opened to TAP
          (Chris, 2026-09-24). A pointer keeps keyboard-first. Esc on level 2
          goes back to the Orgs; on level 1 it closes. */}
      <PopoverContent
        align="start"
        side={props.collapsed ? 'right' : (props.side ?? 'top')}
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        onOpenAutoFocus={keepKeyboardDownOnTouch}
        onKeyDown={onListKey}
        onEscapeKeyDown={(e) => {
          if (drilled && !searching) {
            e.preventDefault();
            back();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search_workspaces')}
            aria-label={t('search_workspaces')}
            className="h-7 w-full bg-transparent text-[13px] outline-hidden placeholder:text-muted-foreground/60"
          />
        </div>
        <div role="listbox" aria-label={t('switch_workspace')} className="max-h-80 overflow-x-hidden overflow-y-auto p-1">
          {body}
        </div>
        {/* One compact row: every workspace on its own page, and settings. */}
        <div className="flex items-center gap-1 border-t border-border/70 p-1" data-testid="workspace-switcher-footer">
          <Link
            href={ALL_WORKSPACES_HREF}
            onClick={() => openChange(false)}
            className="flex min-h-9 flex-1 items-center gap-1.5 rounded-lg px-2 text-[13px] text-foreground transition-colors hover:bg-surface-hover max-md:min-h-11"
            data-testid="workspace-switcher-all"
          >
            {t('all_workspaces')}
            <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
          </Link>
          {props.onManage && (
            <button
              type="button"
              onClick={() => {
                openChange(false);
                props.onManage?.();
              }}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-foreground transition-colors hover:bg-surface-hover max-md:min-h-11"
              data-testid="workspace-switcher-settings"
            >
              <Settings2 className="size-4 text-muted-foreground" aria-hidden />
              {t('workspace_settings_short')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The live switcher: the directory the sidebar loaded, the active project from the session.
 * @param props - The switcher's inputs.
 * @param props.directory - What `useWorkspaceDirectory` loaded; null while loading.
 * @param props.only - Project ids to list (an app's workspaces); omitted lists every one.
 * @param props.onManage - The "Workspace settings" row's action.
 * @param props.placeholder - Shown when the current workspace is not in the list.
 * @param props.targetPath - The page a switch lands on.
 * @param props.tint - The selected app's tint, worn by the chip.
 */
export function WorkspaceSwitcherLive(props: {
  directory: WorkspaceDirectory | null;
  only?: readonly string[];
  onManage?: () => void;
  placeholder?: string;
  targetPath?: WorkspaceSwitcherTargetPath;
  tint?: Tint;
}) {
  const { data: session } = useSession();
  const { state } = useSidebar();
  const brand = useOrgBrand();
  const data = props.directory;
  const only = props.only;
  const projects = useMemo(() => {
    if (!data) {
      return null;
    }
    return only ? data.projects.filter(p => only.includes(p.id)) : data.projects;
  }, [data, only]);
  // What each row says beyond its name, read once the directory is in: the
  // lead, last activity and Org marks (`projects.overview`), and what waits
  // on the person (`inbox.mineCount`, the one count). A failed read leaves
  // the rows on their names.
  const [details, setDetails] = useState<Record<string, PickerDetail>>({});
  const [marks, setMarks] = useState<Record<string, { light: string; dark?: string }>>({});
  const loaded = data !== null;
  useEffect(() => {
    if (!loaded) {
      return;
    }
    let cancelled = false;
    Promise.all([
      // Through a resolved promise, so a client without the route (an older
      // server, a story's stub) fails into the catch rather than the effect.
      Promise.resolve().then(() => client.projects.overview()).catch(() => null),
      Promise.resolve().then(() => client.inbox.mineCount()).catch(() => null),
    ]).then(([overview, counts]) => {
      if (cancelled) {
        return;
      }
      const waiting = new Map((counts?.workspaces ?? []).map(w => [w.id, w.yours]));
      setDetails(Object.fromEntries((overview?.workspaces ?? []).map(w => [w.id, { leadName: w.leadName, lastActiveAt: w.lastActiveAt, waiting: waiting.get(w.id) ?? 0 }])));
      setMarks(overview?.marks ?? {});
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  return (
    <WorkspaceSwitcher
      account={data?.account ?? null}
      accounts={data?.accounts ?? []}
      orgsMode={data?.orgsMode}
      details={details}
      marks={marks}
      projects={projects}
      activeId={session?.user?.projectId ?? null}
      onManage={props.onManage}
      collapsed={state === 'collapsed'}
      placeholder={props.placeholder}
      targetPath={props.targetPath}
      side="bottom"
      tint={props.tint}
      logo={brand?.mark.light ? { light: brand.mark.light, dark: brand.mark.dark } : null}
    />
  );
}
