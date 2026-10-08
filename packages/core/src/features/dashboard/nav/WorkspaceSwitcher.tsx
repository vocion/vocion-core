'use client';

import type { WorkspaceDirectory } from './useWorkspaceDirectory';
import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import { ArrowLeftRight, Check, Search, Settings2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/useSidebar';
import { usePathname } from '@/libs/I18nNavigation';
import { routing } from '@/libs/I18nRouting';
import { cn } from '@/utils/Helpers';
import { countHiddenEmpty, crossAccountSlug, filterProjects, groupByAccount, isPersonalProject, projectAccent, slugLine, workspaceSwitchHref } from './workspaceSwitch';

/**
 * Workspace context, at the head of the selected app's nav (Vocion 5.0 —
 * it was bottom-left before the app rail; ElevenLabs pattern, Chris 2026-09-15): the
 * workspace's initial-avatar in its accent, its name, the account beneath,
 * and a visible ⇄ Switch affordance. Clicking opens the workspace list
 * directly — search, the person's workspaces (name, slug, check on the current
 * one), a toggle revealing empty seed projects, and "Manage workspace" as the
 * last row. No nested submenu. Switching navigates through
 * `/w/<slug>/<same page>` — the one switch mechanism (#336). A person in more
 * than one account sees the list grouped under each account's name, and a
 * switch into another account is also how they switch account: tenancy
 * follows the picked workspace (vocion-core#128). The header's
 * avatar menu opens this same popover via {@link OPEN_WORKSPACE_SWITCHER}.
 * Collapsed to the icon rail, the avatar alone is the button.
 *
 * It is also every app's workspace picker — one switcher, not one per app
 * (principle 6): the sidebar hands it only the workspaces that have the
 * selected app, a `placeholder` for when the current workspace is not one of
 * them, and `targetPath` to say which page the switch lands on. In a picker
 * nothing is hidden for having no agents yet (`keepEmpty`): every workspace
 * listed has the app, and one that just installed it is the one being looked
 * for.
 *
 * The person's own workspace reads "Personal", with no slug under it: its
 * slug is a hash of their id, an address rather than a name.
 */

export const OPEN_WORKSPACE_SWITCHER = 'vocion:open-workspace-switcher';

/** Ask the sidebar's switcher to open (used by the header avatar menu). */
export function openWorkspaceSwitcher(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OPEN_WORKSPACE_SWITCHER));
  }
}

export type WorkspaceSwitcherProps = {
  /** The account this session is in — the eyebrow under the workspace name. */
  account?: { id?: string; name: string } | null;
  /** Every account the person belongs to. Two or more groups the list by account. */
  accounts?: SwitcherAccount[];
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
  targetPath?: (p: SwitcherProject, pathname: string) => string;
  /** Which way the list opens. Default: up, as it did from the bottom of the sidebar. */
  side?: 'top' | 'bottom';
  /** An app's picker: list every workspace handed over, none hidden for having no agents. */
  keepEmpty?: boolean;
};

/**
 * One row in the switcher list.
 * @param props - The row's inputs.
 * @param props.project - The workspace this row switches to.
 * @param props.selected - Whether it is the active workspace.
 * @param props.onPick - Called with the workspace when the row is clicked.
 * @param props.name - What the row is called ("Personal" for the person's own).
 */
function WorkspaceOption(props: { project: SwitcherProject; selected: boolean; onPick: (p: SwitcherProject) => void; name: string }) {
  const p = props.project;
  const slug = slugLine(p);
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      onClick={() => props.onPick(p)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-hidden transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white" style={{ background: projectAccent(p.slug) }} aria-hidden>
        {props.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{props.name}</span>
        {slug && <span className="block truncate font-mono text-[11px] text-muted-foreground">{slug}</span>}
      </span>
      {props.selected && <Check className="size-4 shrink-0 text-foreground" aria-hidden />}
    </button>
  );
}

/**
 * Radix's open-autofocus handler: let it focus on a pointer device, refuse on touch.
 * @param e
 */
function keepKeyboardDownOnTouch(e: Event): void {
  if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
    e.preventDefault();
  }
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
  const projects = props.projects ?? [];
  const active = projects.find(p => p.id === props.activeId) ?? (props.placeholder === undefined ? projects[0] ?? null : null);
  const keepEmpty = props.keepEmpty ?? false;
  // The person's own workspace is "Personal" (in their language), whatever its
  // row holds; the search matches the name shown.
  const personalName = t('personal_workspace');
  const nameOf = useCallback((p: SwitcherProject) => (isPersonalProject(p) ? personalName : p.name), [personalName]);
  const visible = useMemo(() => filterProjects(projects, { query, showEmpty, activeId: active?.id ?? null, keepEmpty, nameOf }), [projects, query, showEmpty, active, keepEmpty, nameOf]);
  const hiddenEmpty = countHiddenEmpty(projects, active?.id ?? null, keepEmpty);
  const accounts = props.accounts ?? [];
  const groups = accounts.length > 1 ? groupByAccount(visible, accounts) : null;
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

  const name = active ? nameOf(active) : (loading ? '' : props.placeholder ?? t('workspace_fallback'));
  // The collapsed rail shows no account line, so with two accounts the label
  // names it: two "Support" workspaces on two accounts must not read the same.
  const railLabel = name && accounts.length > 1 && props.account?.name ? `${name} · ${props.account.name}` : name;
  const initial = (name || 'W').charAt(0).toUpperCase();
  const accent = active ? projectAccent(active.slug) : 'oklch(0.7 0 0)';

  const avatar = (
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
          className="group/ws flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-hidden transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-surface-hover"
        >
          {avatar}
          <span className="min-w-0 flex-1">
            {loading
              ? <span className="block h-3.5 w-28 animate-pulse rounded bg-muted" />
              : <span className="block truncate text-[13px] leading-tight font-medium text-foreground">{name}</span>}
            {props.account?.name && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{props.account.name}</span>}
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
      <PopoverContent align="start" side={props.collapsed ? 'right' : (props.side ?? 'top')} className="w-72 p-0" onOpenAutoFocus={keepKeyboardDownOnTouch}>
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
                <div key={g.account.id} role="group" aria-labelledby={`${headingIdPrefix}-${g.account.id}`}>
                  <div id={`${headingIdPrefix}-${g.account.id}`} className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{g.account.name}</div>
                  {g.projects.map(p => <WorkspaceOption key={p.id} project={p} name={nameOf(p)} selected={p.id === active?.id} onPick={go} />)}
                </div>
              ))
            : visible.map(p => <WorkspaceOption key={p.id} project={p} name={nameOf(p)} selected={p.id === active?.id} onPick={go} />)}
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
 * The live switcher: the directory the sidebar loaded, the active project from the session.
 * @param props - The switcher's inputs.
 * @param props.directory - What `useWorkspaceDirectory` loaded; null while loading.
 * @param props.only - Project ids to list (an app's workspaces); omitted lists every one.
 * @param props.onManage - The "Workspace settings" row's action.
 * @param props.placeholder - Shown when the current workspace is not in the list.
 * @param props.targetPath - The page a switch lands on.
 */
export function WorkspaceSwitcherLive(props: {
  directory: WorkspaceDirectory | null;
  only?: readonly string[];
  onManage?: () => void;
  placeholder?: string;
  targetPath?: WorkspaceSwitcherProps['targetPath'];
}) {
  const { data: session } = useSession();
  const { state } = useSidebar();
  const data = props.directory;
  const only = props.only;
  const projects = useMemo(() => {
    if (!data) {
      return null;
    }
    return only ? data.projects.filter(p => only.includes(p.id)) : data.projects;
  }, [data, only]);

  // An app's picker (`only`) lists the workspaces that have the app — all of them.
  return (
    <WorkspaceSwitcher
      account={data?.account ?? null}
      accounts={data?.accounts ?? []}
      projects={projects}
      activeId={session?.user?.projectId ?? null}
      onManage={props.onManage}
      collapsed={state === 'collapsed'}
      placeholder={props.placeholder}
      targetPath={props.targetPath}
      keepEmpty={only !== undefined}
      side="bottom"
    />
  );
}
