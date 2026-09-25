'use client';

import type { SwitcherProject } from './workspaceSwitch';
import { ArrowLeftRight, Check, Search, Settings2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/useSidebar';
import { usePathname } from '@/libs/I18nNavigation';
import { routing } from '@/libs/I18nRouting';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { countHiddenEmpty, filterProjects, projectAccent, workspaceSwitchHref } from './workspaceSwitch';

/**
 * Workspace context, bottom-left (ElevenLabs pattern, Chris 2026-09-15): the
 * workspace's initial-avatar in its accent, its name, the account beneath,
 * and a visible ⇄ Switch affordance. Clicking opens the workspace list
 * directly — search, the person's workspaces (name, slug, check on the current
 * one), a toggle revealing empty seed projects, and "Manage workspace" as the
 * last row. No nested submenu. Switching navigates through
 * `/w/<slug>/<same page>` — the one switch mechanism (#336). The header's
 * avatar menu opens this same popover via {@link OPEN_WORKSPACE_SWITCHER}.
 * Collapsed to the icon rail, the avatar alone is the button.
 */

export const OPEN_WORKSPACE_SWITCHER = 'vocion:open-workspace-switcher';

/** Ask the sidebar's switcher to open (used by the header avatar menu). */
export function openWorkspaceSwitcher(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OPEN_WORKSPACE_SWITCHER));
  }
}

export type WorkspaceSwitcherProps = {
  account?: { name: string } | null;
  projects: SwitcherProject[] | null;
  activeId: string | null;
  onManage?: () => void;
  /** Override navigation (stories/tests). Default: `window.location.assign`. */
  navigate?: (href: string) => void;
  /** Force the popover open (stories). */
  defaultOpen?: boolean;
  collapsed?: boolean;
};

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
  const active = projects.find(p => p.id === props.activeId) ?? projects[0] ?? null;
  const visible = useMemo(() => filterProjects(projects, { query, showEmpty, activeId: active?.id ?? null }), [projects, query, showEmpty, active]);
  const hiddenEmpty = countHiddenEmpty(projects, active?.id ?? null);

  const go = (p: SwitcherProject) => {
    if (active && p.id === active.id) {
      setOpen(false);
      return;
    }
    const href = workspaceSwitchHref({
      slug: p.slug,
      pathname,
      search: typeof window === 'undefined' ? '' : window.location.search,
      locale,
      defaultLocale: routing.defaultLocale,
    });
    (props.navigate ?? (h => window.location.assign(h)))(href);
  };

  const name = active?.name ?? (loading ? '' : t('workspace_fallback'));
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
              aria-label={name || t('switch_workspace')}
              className="mx-auto flex size-8 items-center justify-center rounded-lg outline-hidden transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              {avatar}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{name || t('switch_workspace')}</TooltipContent>
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
      <PopoverContent align="start" side={props.collapsed ? 'right' : 'top'} className="w-72 p-0" onOpenAutoFocus={keepKeyboardDownOnTouch}>
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
          {visible.map(p => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === active?.id}
              onClick={() => go(p)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-hidden transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white" style={{ background: projectAccent(p.slug) }} aria-hidden>
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">{p.name}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.slug}</span>
              </span>
              {p.id === active?.id && <Check className="size-4 shrink-0 text-foreground" aria-hidden />}
            </button>
          ))}
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
 * The live switcher: loads the account + projects once, reads the active project from the session.
 * @param root0
 * @param root0.onManage
 */
export function WorkspaceSwitcherLive({ onManage }: { onManage?: () => void }) {
  const { data: session } = useSession();
  const { state } = useSidebar();
  const [data, setData] = useState<{ projects: SwitcherProject[]; account: { name: string } | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.projects.list()
      .then((r) => {
        if (!cancelled) {
          setData({ projects: r.projects, account: r.account ? { name: r.account.name } : null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ projects: [], account: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <WorkspaceSwitcher
      account={data?.account ?? null}
      projects={data?.projects ?? null}
      activeId={session?.user?.projectId ?? null}
      onManage={onManage}
      collapsed={state === 'collapsed'}
    />
  );
}
