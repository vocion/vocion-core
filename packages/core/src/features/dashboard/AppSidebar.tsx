'use client';

import type { LucideIcon } from 'lucide-react';
import type { PinnableItem } from './nav/navPins';
import type { DashboardRoute } from '@/features/navigation/dashboardNav';
import type { PluginNav } from '@/features/navigation/pluginNav';
import type { SurfaceId } from '@/features/navigation/surfaces';
import { ArrowLeft, FileText, PanelsTopLeft, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/useSidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { iconByName } from '@/features/dashboard/iconByName';
import { InviteTeamCard } from '@/features/dashboard/InviteTeamCard';
import { applyPins, defaultPinDismissal, resolveWorkPins, withoutPins } from '@/features/dashboard/nav/navPins';
import { PinnableNav } from '@/features/dashboard/nav/PinnableNav';
import { useNavPrefs } from '@/features/dashboard/nav/useNavPrefs';
import { WorkspaceSwitcherLive } from '@/features/dashboard/nav/WorkspaceSwitcher';
import { OPEN_MANAGE_VIEW, readNavView, writeNavView } from '@/features/dashboard/useNavView';
import { DASHBOARD_ROUTES, DEFAULT_WORK_PINS, manageNavGroups, manageRoutes, tabsOf, workCoreRoutes, workPinnableRoutes } from '@/features/navigation/dashboardNav';
import { PLUGIN_NAV_WORKSPACE } from '@/features/navigation/pluginNav';
import { groupEnabledSurfaces } from '@/features/navigation/surfaces';
import { VOCION_PRIMARY_MARK } from '@/templates/VocionLogo';

/**
 * Dashboard left sidebar — two views, Linear-settings style:
 *
 *   WORK (default) — Workspace (the daily driver: Chat, Review queue, Briefings,
 *                    Search), Pinned (this person's pins, in pin order), Pages
 *                    (the workspace's own pages, 7 then "More pages ›"),
 *                    the enabled surfaces,
 *                    the invite card, a quiet "Manage workspace" row, and the
 *                    workspace row.
 *   MANAGE         — the configuration sections (Team · Knowledge · Build ·
 *                    Insights · Organization), every row pinnable, with
 *                    "Back to work" at top.
 *
 * Both views are DERIVED from `features/navigation/dashboardNav.ts` — groups,
 * order, labels, icons and admin gating live there, once, shared with the ⌘K
 * palette and the breadcrumb (nav sweep, Chris 2026-09-15: "team report and
 * activity don't look like they belong in the main workspace nav"). Reports
 * and the Developers page moved to MANAGE; nothing configurational is left in
 * WORK.
 *
 * Three doors into MANAGE (Chris, 2026-09-15: "we lost nav access to
 * workspace settings"): the visible row in the work nav (the primary one —
 * a gear with a tooltip in the icon rail), the workspace popover's
 * "Workspace settings" row, and the header avatar menu's item, which fires
 * {@link OPEN_MANAGE_VIEW}. Everything configurational lives behind it, so
 * one entry point buried in a popover that reads as a *switcher* was one
 * entry point too few.
 *
 * The view persists per browser; pins and dismissed prompts persist per
 * (org, user) on the server with localStorage as the fast path. Airy pass
 * (B-034b §3 + ElevenLabs reference, 2026-09-15): 56px icon rail, 13px rows,
 * inactive labels dark grey, hover lighter than the active pill, one pin
 * gesture and no settings page.
 * @param props.isAdmin
 * @param props
 */

type NavView = 'work' | 'manage';
const PAGES_MAX = 7;
const INVITE_CARD = 'invite-card';
// The sidebar shows the MARK + wordmark as text (ElevenLabs pattern): never the
// lockup SVG (its descriptor is unreadable at 24px) and never the tagline —
// both stay on sign-in, where `VocionLogo` renders them.
const BRAND_MARK = process.env.NEXT_PUBLIC_BRAND_MARK || VOCION_PRIMARY_MARK;
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'Vocion';

/** Workspace-defined pages (libs/workspace/pages.ts), grouped for the nav. */
export type WorkspaceNavPage = {
  /** Sits under "More" however few pages there are (`nav.secondary`). */
  secondary?: boolean;
  title: string;
  url: string;
  section: string;
};

/**
 * A plugin row's icon: the core registry's component when the row is a core
 * route, else the named lucide icon, else a generic shape — never a crash.
 * @param url
 * @param name
 */
function pluginIcon(url: string, name: string): LucideIcon {
  return DASHBOARD_ROUTES.find(r => r.url === url)?.icon ?? iconByName(name);
}

export const AppSidebar = ({ isAdmin = false, enabledPlugins, enabledSurfaces = [], pluginNav, workspacePages = [], needsYouCount = 0, ...props }: React.ComponentProps<typeof Sidebar> & {
  /** Shows admin-only nav items (Adoption). Gating is enforced server-side; this only hides the link. */
  isAdmin?: boolean;
  /** Plugins the workspace turned on (`project.enabledPlugins`); a plugin-owned row (Data rooms) shows only while its plugin is on. */
  enabledPlugins?: readonly string[];
  /** Optional surfaces the workspace switched on — see `features/navigation/surfaces.ts` — minus the ones a plugin claimed. */
  enabledSurfaces?: SurfaceId[];
  /** Each enabled plugin's rows, folded into sections by `plugin.yaml` `nav.section` (`features/navigation/pluginNav.ts`). */
  pluginNav?: PluginNav;
  /** Tenant pages from the workspace's pages/ dir — the Pages group. */
  workspacePages?: WorkspaceNavPage[];
  /** Open items waiting on a person — shown as a badge on "Review queue" (the inbox PR supplies it). */
  needsYouCount?: number;
}) => {
  const t = useTranslations('DashboardLayout');
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const [view, setView] = useState<NavView>('work');
  const prefs = useNavPrefs();

  // The header's avatar menu asks for the manage view by event — it is a
  // sidebar mode, not a route, so there is nothing to navigate to.
  useEffect(() => {
    const onOpen = () => setView('manage');
    window.addEventListener(OPEN_MANAGE_VIEW, onOpen);
    return () => window.removeEventListener(OPEN_MANAGE_VIEW, onOpen);
  }, []);

  // Restore the persisted view after mount (SSR renders the default).
  useEffect(() => {
    if (readNavView(globalThis.localStorage) === 'manage') {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- pre-existing SSR-safe restore; hydration must render the default first
      setView('manage');
    }
  }, []);

  const pick = (v: NavView) => {
    setView(v);
    writeNavView(globalThis.localStorage, v);
  };

  // Sidebar labels come from the registry's i18n keys (typed against en.json);
  // the English title is the fallback for a route that has none yet.
  const label = useCallback((r: Pick<DashboardRoute, 'i18nKey' | 'title'>) => (r.i18nKey ? t(r.i18nKey) : r.title), [t]);

  // ---- the three WORK groups ----
  // WORKSPACE: Chat and Review are the surface and always show; Briefings,
  // Artifacts, Search and Data rooms show while pinned (Briefings starts
  // pinned) and otherwise sit one row down under "More" (Chris, 2026-09-18).
  const toWorkItem = useCallback((r: DashboardRoute): PinnableItem => ({
    title: label(r),
    url: r.url,
    icon: r.icon,
    origin: 'work',
    badge: r.url === '/dashboard/inbox' ? needsYouCount : undefined,
    ...(r.pinnable ? {} : { pinnable: false as const }),
  }), [label, needsYouCount]);
  const viewer = useMemo(() => ({ isAdmin, enabledPlugins }), [isAdmin, enabledPlugins]);
  const workCore = useMemo(() => workCoreRoutes(viewer).map(toWorkItem), [toWorkItem, viewer]);
  // A plugin's Workspace rows join the pinnable WORK rows, pinned by default —
  // turning a plugin on puts its door beside Chat and Review, not under More.
  // A core route a plugin owns is rendered from the plugin's list, once.
  const pluginWorkspace = useMemo(() => (pluginNav?.sections.find(s => s.label === PLUGIN_NAV_WORKSPACE)?.items ?? []).filter(i => !i.secondary), [pluginNav]);
  // A route a plugin only OFFERS (secondary) is never a pinned door: it joins
  // the Pages group's "More pages ›" like a forensic page would.
  const pluginSecondary = useMemo(() => (pluginNav?.sections.find(s => s.label === PLUGIN_NAV_WORKSPACE)?.items ?? []).filter(i => i.secondary), [pluginNav]);
  // Named-app sections: a plugin's `nav.section: GTM` rows and the workspace's
  // own surfaces under the same heading render as ONE group, never two "GTM"s.
  const appSections = useMemo(() => {
    const out = new Map<string, Array<{ title: string; url: string; icon: LucideIcon; secondary?: boolean }>>();
    for (const s of groupEnabledSurfaces(enabledSurfaces)) {
      out.set(s.label, s.items.map(i => ({ title: i.label, url: i.url, icon: pluginIcon(i.url, i.icon) })));
    }
    for (const s of pluginNav?.sections.filter(x => x.label !== PLUGIN_NAV_WORKSPACE) ?? []) {
      out.set(s.label, [...(out.get(s.label) ?? []), ...s.items.map(i => ({ title: i.title, url: i.url, icon: pluginIcon(i.url, i.icon), ...(i.secondary ? { secondary: true } : {}) }))]);
    }
    return [...out.entries()].map(([label, items]) => ({ label, items }));
  }, [enabledSurfaces, pluginNav]);
  const claimedRoutes = useMemo(() => new Set(pluginNav?.claimedRoutes ?? []), [pluginNav]);
  const workOptional = useMemo<PinnableItem[]>(() => [
    ...workPinnableRoutes(viewer).filter(r => !claimedRoutes.has(r.url)).map(toWorkItem),
    ...pluginWorkspace.map(i => ({ title: i.title, url: i.url, icon: pluginIcon(i.url, i.icon), origin: 'work' as const })),
  ], [toWorkItem, viewer, claimedRoutes, pluginWorkspace]);
  const workDefaults = useMemo(() => [...DEFAULT_WORK_PINS, ...pluginWorkspace.map(i => i.url)], [pluginWorkspace]);
  const workPins = resolveWorkPins({ pins: prefs.pins, dismissed: prefs.dismissed, defaults: workDefaults });
  const workspaceItems = [...workCore, ...applyPins(workOptional, workPins), ...withoutPins(workOptional, workPins)];
  const workShown = workCore.length + applyPins(workOptional, workPins).length;
  // Unpinning a default records the choice; everything else is a plain toggle.
  const toggleWorkPin = (url: string) => {
    if (workDefaults.includes(url) && workPins.includes(url) && !prefs.pins.includes(url)) {
      prefs.dismiss(defaultPinDismissal(url));
      return;
    }
    prefs.togglePin(url);
  };

  // Tenant pages only. Artifacts used to join this group as "saved canvases";
  // they are a WORK row of their own now (registry), with their own log.
  const pageItems = useMemo<PinnableItem[]>(
    () => [
      ...workspacePages.map(p => ({ title: p.title, url: p.url, icon: PanelsTopLeft, origin: 'page' as const })),
      ...pluginSecondary.map(i => ({ title: i.title, url: i.url, icon: pluginIcon(i.url, i.icon), origin: 'page' as const })),
    ],
    [workspacePages, pluginSecondary],
  );

  // Forensic pages sort last and the cut is made just above them, so they end
  // up under "More" whatever the page count — while ordinary overflow still
  // applies to everything before them.
  const secondaryUrls = useMemo(
    () => new Set([...workspacePages.filter(p => p.secondary).map(p => p.url), ...pluginSecondary.map(i => i.url)]),
    [workspacePages, pluginSecondary],
  );

  // Every MANAGE destination — pages and their tabs — so a pin to either resolves.
  const manageItems = useMemo<PinnableItem[]>(
    () => manageRoutes(viewer).map(r => ({ title: label(r), url: r.url, icon: r.icon, origin: 'manage' as const })),
    [viewer, label],
  );

  // The MANAGE sections: top-level rows, each combined page carrying its
  // other tabs (shown beneath it while open; a pinned tab moves up to Pinned).
  const manageSections = useMemo(() => manageNavGroups(viewer).map(({ group, routes }) => ({
    label: label(group),
    items: routes.map((r): PinnableItem => ({
      title: label(r),
      url: r.url,
      icon: r.icon,
      origin: 'manage',
      tabs: tabsOf(r.url).filter(tab => tab.tabOf).map(tab => ({ title: label(tab), url: tab.url, icon: tab.icon, origin: 'manage' as const })),
    })),
  })), [viewer, label]);

  const pinnable = useMemo(() => [...pageItems, ...manageItems], [pageItems, manageItems]);
  const pinned = applyPins(pinnable, prefs.pins);
  const unpinnedPages = withoutPins(pageItems, prefs.pins);
  const pagesPrimaryFirst = useMemo(
    () => [...unpinnedPages].sort((a, b) => Number(secondaryUrls.has(a.url)) - Number(secondaryUrls.has(b.url))),
    [unpinnedPages, secondaryUrls],
  );
  const primaryPageCount = pagesPrimaryFirst.filter(i => !secondaryUrls.has(i.url)).length;
  const manageGroup = (section: { label: string; items: PinnableItem[] }) => (
    <PinnableNav
      key={section.label}
      label={section.label}
      items={withoutPins(section.items, prefs.pins).map(i => ({ ...i, tabs: i.tabs ? withoutPins(i.tabs, prefs.pins) : undefined }))}
      pins={prefs.pins}
      onTogglePin={prefs.togglePin}
      max={99}
      moreLabel={t('more_pages')}
      pinLabel={t('pin')}
      unpinLabel={t('unpin')}
    />
  );

  const pinLabels = { moreLabel: t('more_pages'), pinLabel: t('pin'), unpinLabel: t('unpin') };

  return (
    <Sidebar {...props}>
      <SidebarHeader className="pt-5">
        {/* Brand block — mark + wordmark, nothing else. */}
        <div className="flex items-center gap-2 px-2 pb-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={BRAND_MARK} alt="" className="h-5 w-auto shrink-0" aria-hidden />
          {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">{BRAND_NAME}</span>}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {view === 'work'
          ? (
              <>
                {/* WORKSPACE — the permanent Vocion pages. */}
                <PinnableNav
                  label={t('main_section_label')}
                  items={workspaceItems}
                  pins={workPins}
                  onTogglePin={toggleWorkPin}
                  max={workShown}
                  moreLabel={t('more')}
                  pinLabel={t('pin')}
                  unpinLabel={t('unpin')}
                />

                {/* PINNED — this person's pins, in pin order, draggable. */}
                {pinned.length > 0 && (
                  <PinnableNav
                    label={t('pinned')}
                    items={pinned}
                    pins={prefs.pins}
                    onTogglePin={prefs.togglePin}
                    onMovePin={prefs.movePin}
                    max={99}
                    reorderable
                    {...pinLabels}
                  />
                )}

                {/* PAGES — the workspace's own pages. A page that declared
                    itself `nav.secondary` sits under "More" however few pages
                    there are: a factory log, a cost ledger and a decisions
                    archive are forensic, and hiding them behind a COUNT meant
                    a six-page workspace showed all six with equal weight.
                    They are sorted last and the cut is made just above them,
                    so ordinary overflow still applies to everything else. */}
                <PinnableNav
                  label={t('pages')}
                  items={pagesPrimaryFirst}
                  pins={prefs.pins}
                  onTogglePin={prefs.togglePin}
                  max={Math.min(PAGES_MAX, primaryPageCount)}
                  {...pinLabels}
                />

                {/* Named apps: the workspace's surfaces (workspace.yaml `surfaces:`) and
                    the plugins that belong to the app (plugin.yaml `nav.section: GTM`),
                    one group per heading. Renders nothing when none are on. */}
                {appSections.map(section => (
                  <AppSidebarNav key={`app:${section.label}`} label={section.label} items={section.items} moreLabel={t('more')} />
                ))}

                {/* Bottom cluster: invite card (dismissible, remembered),
                    which workspace you're in + the door to its configuration. */}
                <div className="mt-auto">
                  {!prefs.dismissed.includes(INVITE_CARD) && <InviteTeamCard onDismiss={() => prefs.dismiss(INVITE_CARD)} />}
                  {/* The visible door to MANAGE — everything configurational is
                      behind it, so it is a row in the nav, not only a line in a
                      popover. Icon rail: the gear alone, with a tooltip. */}
                  <div className="px-2 pb-1 group-data-[collapsible=icon]:px-0">
                    <ManageWorkspaceRow label={t('manage_workspace')} collapsed={collapsed} onOpen={() => pick('manage')} />
                  </div>
                  {/* Workspace context: avatar · name · account · ⇄ Switch. */}
                  <div className="px-2 pb-2 group-data-[collapsible=icon]:px-0">
                    <WorkspaceSwitcherLive onManage={() => pick('manage')} />
                  </div>
                </div>
              </>
            )
          : (
              <>
                <div className="px-2 pt-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => pick('work')}
                        aria-label={t('back_to_work')}
                        className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-sidebar-foreground transition-colors group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-surface-hover hover:text-foreground"
                      >
                        <ArrowLeft className="size-4 shrink-0" aria-hidden />
                        <span className="group-data-[collapsible=icon]:hidden">{t('back_to_work')}</span>
                      </button>
                    </TooltipTrigger>
                    {/* The label is hidden in the icon rail; the way out must
                        not be. */}
                    <TooltipContent side="right" collisionPadding={8} hidden={!collapsed}>{t('back_to_work')}</TooltipContent>
                  </Tooltip>
                </div>
                {/* MANAGE — who works for you + the shapes their work takes.
                    Every row is pinnable into the WORK view's Pinned group. */}
                {pinned.length > 0 && (
                  <PinnableNav label={t('pinned')} items={pinned} pins={prefs.pins} onTogglePin={prefs.togglePin} onMovePin={prefs.movePin} max={99} reorderable {...pinLabels} />
                )}
                {manageSections.map(manageGroup)}
                <AppSidebarNav items={[{ title: t('docs'), url: 'https://www.vocion.ai/docs', icon: FileText }]} />

                <div className="mt-auto px-2 pb-2 group-data-[collapsible=icon]:px-0">
                  <WorkspaceSwitcherLive onManage={() => pick('manage')} />
                </div>
              </>
            )}
      </SidebarContent>

      {/* The © / attribution line lives in the account menu now (B-034b §3). */}
      <SidebarRail />
    </Sidebar>
  );
};

/**
 * The work view's door to MANAGE — a quiet row, one click in.
 *
 * Deliberately not a nav link: the manage view is a sidebar mode, so there is
 * no URL to point at. Collapsed to the icon rail it is the gear alone and the
 * tooltip carries the label, the same contract every other rail row keeps.
 * @param props
 * @param props.label - Translated label.
 * @param props.collapsed - True in the icon rail, where the tooltip is the label.
 * @param props.onOpen - Switch the sidebar to the manage view.
 */
function ManageWorkspaceRow({ label, collapsed, onOpen }: { label: string; collapsed: boolean; onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="manage-workspace-row"
          onClick={onOpen}
          aria-label={label}
          className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-sidebar-foreground transition-colors group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-surface-hover hover:text-foreground"
        >
          <Settings2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate group-data-[collapsible=icon]:hidden">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" collisionPadding={8} hidden={!collapsed}>{label}</TooltipContent>
    </Tooltip>
  );
}
