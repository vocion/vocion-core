'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import type { WorkspaceDirectory } from './useWorkspaceDirectory';
import type { SwitcherAccount, SwitcherProject, WorkspaceSwitcherTargetPath } from './workspaceSwitch';
import type { Tint } from '@/libs/tints';
import type { OrgsMode } from '@/services/OrgPolicy';
import { ArrowLeftRight, Check, Search, Settings2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/useSidebar';
import { useOrgBrand } from '@/features/branding/BrandContext';
import { navSlotComponents } from '@/libs/clientExtensions';
import { usePathname } from '@/libs/I18nNavigation';
import { routing } from '@/libs/I18nRouting';
import { TINT_BG } from '@/libs/tints';
import { cn } from '@/utils/Helpers';
import { accountLine, countHiddenEmpty, crossAccountSlug, filterProjects, groupByAccount, projectAccent, workspaceSwitchHref } from './workspaceSwitch';

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
 * (`services/OrgPolicy.ts`). There the chip reads "Noco › Support" (just the
 * workspace when it shares the Org's name), and the one list groups the
 * workspaces under each Org's name; a switch into another Org's workspace is
 * also how a person switches Org: tenancy follows the picked workspace
 * (vocion-core#128). An extension that has more to say about an Org draws
 * that Org's group header (`nav.workspacePicker.org`), inside this picker.
 * It used to draw a second switcher above this one, and the founder's phone
 * showed "Noco · Org ⇄ Switch" over "Noco ⇄ Switch" (2026-10-08). A
 * single-Org install (the default) never names an Org. The header's avatar
 * menu opens this same popover via {@link OPEN_WORKSPACE_SWITCHER}. Collapsed
 * to the icon rail, the avatar alone is the button. Arrow keys move through
 * the list, from the search box too.
 *
 * It is also every app's workspace picker — one switcher, not one per app
 * (principle 6): the sidebar hands it only the workspaces that have the
 * selected app, a `placeholder` for when the current workspace is not one of
 * them, and `targetPath` to say which page the switch lands on.
 */

export const OPEN_WORKSPACE_SWITCHER = 'vocion:open-workspace-switcher';

/** Ask the sidebar's switcher to open (used by the header avatar menu). */
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
  /**
   * Draws one Org's group header in the list, when an extension has one
   * (`nav.workspacePicker.org`). Default: the Org's name.
   */
  renderOrgHeader?: (org: SwitcherAccount, ctx: { current: boolean; close: () => void }) => ReactNode;
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
  /** The page a switch to `p` lands on. Default: the page the person is on. */
  targetPath?: WorkspaceSwitcherTargetPath;
  /** Which way the list opens. Default: up, as it did from the bottom of the sidebar. */
  side?: 'top' | 'bottom';
  /** The app this picker belongs to: the chip wears its tint (front doors, `libs/tints.ts`). */
  tint?: Tint;
  /**
   * The Org's own mark, when it has a brand: the chip's avatar, the one logo
   * in the sidebar (founder, 2026-10-08). Without one, the workspace's initial.
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
 */
export function SwitcherRow(props: { name: string; sub?: string | null; accentKey: string; selected: boolean; disabled?: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      aria-disabled={props.disabled || undefined}
      disabled={props.disabled}
      onClick={props.onPick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-hidden transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white" style={{ background: projectAccent(props.accentKey) }} aria-hidden>
        {props.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{props.name}</span>
        {props.sub && <span className="block truncate font-mono text-[11px] text-muted-foreground">{props.sub}</span>}
      </span>
      {props.selected && <Check className="size-4 shrink-0 text-foreground" aria-hidden />}
    </button>
  );
}

/**
 * One workspace row.
 * @param props - The row's inputs.
 * @param props.project - The workspace this row switches to.
 * @param props.selected - Whether it is the active workspace.
 * @param props.onPick - Called with the workspace when the row is clicked.
 */
function WorkspaceOption(props: { project: SwitcherProject; selected: boolean; onPick: (p: SwitcherProject) => void }) {
  const p = props.project;
  return <SwitcherRow name={p.name} sub={p.slug} accentKey={p.slug} selected={props.selected} onPick={() => props.onPick(p)} />;
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
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_WORKSPACE_SWITCHER, onOpen);
    return () => window.removeEventListener(OPEN_WORKSPACE_SWITCHER, onOpen);
  }, []);

  const loading = props.projects === null;
  const projects = useMemo(() => props.projects ?? [], [props.projects]);
  const active = projects.find(p => p.id === props.activeId) ?? (props.placeholder === undefined ? projects[0] ?? null : null);
  const visible = useMemo(() => filterProjects(projects, { query, showEmpty, activeId: active?.id ?? null }), [projects, query, showEmpty, active]);
  const hiddenEmpty = countHiddenEmpty(projects, active?.id ?? null);
  const accounts = props.accounts ?? [];
  const multiOrg = props.orgsMode === 'multi';
  const groups = multiOrg && accounts.length > 1 ? groupByAccount(visible, accounts) : null;
  const orgName = multiOrg ? props.account?.name : undefined;
  const headingIdPrefix = useId();

  const go = (p: SwitcherProject) => {
    if (active && p.id === active.id) {
      setOpen(false);
      return;
    }
    const target = props.targetPath ? props.targetPath(p, pathname) : pathname;
    const href = workspaceSwitchHref({
      slug: p.slug,
      pathname: target,
      // The query belongs to the page: kept when the switch stays on it, dropped when an app's
      // picker lands somewhere else (a filter on one page means nothing on another).
      search: typeof window === 'undefined' || target !== pathname ? '' : window.location.search,
      locale,
      defaultLocale: routing.defaultLocale,
      accountSlug: crossAccountSlug(p, props.account?.id, accounts),
    });
    (props.navigate ?? (h => window.location.assign(h)))(href);
  };

  const name = active?.name ?? (loading ? '' : props.placeholder ?? t('workspace_fallback'));
  // "Org › Workspace", one line. The Org shows only when it says something
  // the workspace's name does not ("Northwind › Northwind" reads as a glitch).
  const orgLine = loading ? null : accountLine(name, orgName);
  const railLabel = name && orgLine ? `${orgLine} › ${name}` : name;
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
              : (
                  <span className="block truncate text-[13px] leading-tight">
                    {orgLine && (
                      <>
                        <span className="text-muted-foreground">{orgLine}</span>
                        <span className="mx-1 text-muted-foreground/60" aria-hidden>›</span>
                      </>
                    )}
                    <span className="font-medium text-foreground">{name}</span>
                  </span>
                )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors group-hover/ws:bg-background group-hover/ws:text-foreground">
            <ArrowLeftRight className="size-3.5" aria-hidden />
            {t('switch')}
          </span>
        </PopoverTrigger>
      );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      {/* On a touch device the popover must not hand focus to the search box:
          that raises the keyboard over the list a person opened to TAP
          (Chris, 2026-09-24). A pointer keeps keyboard-first. */}
      <PopoverContent align="start" side={props.collapsed ? 'right' : (props.side ?? 'top')} className="w-72 p-0" onOpenAutoFocus={keepKeyboardDownOnTouch} onKeyDown={moveThroughOptions}>
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
        <div role="listbox" aria-label={t('switch_workspace')} className="max-h-72 overflow-y-auto p-1">
          {visible.length === 0 && (
            <div className="px-2 py-6 text-center text-[12px] text-muted-foreground">{t('no_workspaces_match')}</div>
          )}
          {groups
            ? groups.map(g => (
                <div key={g.account.id} role="group" aria-labelledby={`${headingIdPrefix}-${g.account.id}`} data-testid="workspace-switcher-org">
                  <div id={`${headingIdPrefix}-${g.account.id}`}>
                    {props.renderOrgHeader?.(g.account, { current: g.account.id === props.account?.id, close: () => setOpen(false) })
                      ?? <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{g.account.name}</div>}
                  </div>
                  {g.projects.map(p => <WorkspaceOption key={p.id} project={p} selected={p.id === active?.id} onPick={go} />)}
                </div>
              ))
            : visible.map(p => <WorkspaceOption key={p.id} project={p} selected={p.id === active?.id} onPick={go} />)}
        </div>
        {(hiddenEmpty > 0 || showEmpty) && (
          <label className="flex cursor-pointer items-center gap-2 border-t border-border/70 px-3 py-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} className="size-3.5 accent-foreground" />
            {t('show_empty_projects', { count: hiddenEmpty })}
          </label>
        )}
        {props.onManage && (
          <div className="border-t border-border/70 p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                props.onManage?.();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-surface-hover"
            >
              <Settings2 className="size-4 text-muted-foreground" aria-hidden />
              {t('workspace_settings')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Lands a switch on the page the person is on.
 * @param _p
 * @param pathname
 */
const keepPage: WorkspaceSwitcherTargetPath = (_p, pathname) => pathname;

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
  // An extension's Org header, inside this one picker; the first one wins.
  const OrgHeader = navSlotComponents('nav.workspacePicker.org')[0];
  const only = props.only;
  const projects = useMemo(() => {
    if (!data) {
      return null;
    }
    return only ? data.projects.filter(p => only.includes(p.id)) : data.projects;
  }, [data, only]);

  return (
    <WorkspaceSwitcher
      account={data?.account ?? null}
      accounts={data?.accounts ?? []}
      orgsMode={data?.orgsMode}
      renderOrgHeader={OrgHeader && data
        ? (org, ctx) => <OrgHeader org={org} current={ctx.current} close={ctx.close} directory={data} targetPath={props.targetPath ?? keepPage} />
        : undefined}
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
