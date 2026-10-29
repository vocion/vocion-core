'use client';

import type { LucideIcon } from 'lucide-react';
import type { ElsewhereApp } from './nav/AppNotHereNotice';
import type { RailApp } from './nav/AppRail';
import type { PinnableItem, PinPlace } from './nav/navPins';
import type { SwitcherProject, WorkspaceSwitcherTargetPath } from './nav/workspaceSwitch';
import type { GettingStartedState } from '@/features/dashboard/GettingStartedChecklist';
import type { AppNav } from '@/features/navigation/apps';
import type { DashboardRoute } from '@/features/navigation/dashboardNav';
import type { PluginNav } from '@/features/navigation/pluginNav';
import type { SurfaceId } from '@/features/navigation/surfaces';
import { ArrowLeft, FileText, PanelsTopLeft, Settings2 } from 'lucide-react';
import { SessionContext } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { LetterTile } from '@/components/ui/letter-tile';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/useSidebar';
import { useBrandChrome } from '@/features/branding/BrandContext';
import { PoweredByVocion, VocionWordmark } from '@/features/branding/OrgLogo';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { checklistApplies, GettingStartedChecklist } from '@/features/dashboard/GettingStartedChecklist';
import { iconByName } from '@/features/dashboard/iconByName';
import { InviteTeamCard } from '@/features/dashboard/InviteTeamCard';
import { AppRail } from '@/features/dashboard/nav/AppRail';
import { applyPins, defaultPinDismissal, resolveWorkPins, withoutPins } from '@/features/dashboard/nav/navPins';
import { appsLine } from '@/features/dashboard/nav/pickerModel';
import { PinnableNav } from '@/features/dashboard/nav/PinnableNav';
import { useNavPrefs } from '@/features/dashboard/nav/useNavPrefs';
import { useWorkspaceDirectory } from '@/features/dashboard/nav/useWorkspaceDirectory';
import { placeIn, rememberPlace } from '@/features/dashboard/nav/workspaceMemory';
import { WORKSPACE_HOME } from '@/features/dashboard/nav/workspaceSwitch';
import { WorkspaceSwitcherLive } from '@/features/dashboard/nav/WorkspaceSwitcher';
import { SETUP_CHANGED_EVENT } from '@/features/dashboard/setupChanged';
import { OPEN_MANAGE_VIEW, readNavView, writeNavView } from '@/features/dashboard/useNavView';
import { appMissingHere, appOwningPath, resolveActiveApp, workspaceLanding } from '@/features/navigation/apps';
import { DASHBOARD_ROUTES, DEFAULT_WORK_PINS, manageNavGroups, manageRoutes, tabsOf, workCoreRoutes, workPinnableRoutes } from '@/features/navigation/dashboardNav';
import { PLUGIN_NAV_WORKSPACE } from '@/features/navigation/pluginNav';
import { groupEnabledSurfaces } from '@/features/navigation/surfaces';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { useWorkspaceSlug } from '@/libs/workspaceSlug';

/**
 * Dashboard left sidebar — the app rail (Vocion 5.0) and, beside it, the
 * selected app's nav. Every app's nav opens with the workspace picker (the
 * one switcher, listing every workspace). Workforce, the
 * core app, is the nav below; any other app (Software Factory, GTM) shows
 * Chat and Review — shared by every app — and then only its own sections
 * (`features/navigation/apps.ts` splits the rows by app manifest).
 *
 * Workforce's nav has two views, Linear-settings style:
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
const GETTING_STARTED_CARD = 'getting-started';
// ONE logo (founder, 2026-10-08): the Org's mark is the switcher's avatar in
// the header; the rail carries no second one. An Org with a brand
// (`services/branding`) has a small "Powered by Vocion" in the footer.

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

export const AppSidebar = ({ isAdmin = false, enabledPlugins, enabledSurfaces = [], pluginNav, workspacePages = [], needsYouCount = 0, goalsCount = 0, apps = [], elsewhere = [], gettingStarted = null, personalWorkspace = false, ...props }: React.ComponentProps<typeof Sidebar> & {
  /** Shows admin-only nav items (Adoption). Gating is enforced server-side; this only hides the link. */
  isAdmin?: boolean;
  /** Plugins the workspace turned on (`project.enabledPlugins`); a plugin-owned row (Projects) shows only while its plugin is on. */
  enabledPlugins?: readonly string[];
  /** Optional surfaces the workspace switched on — see `features/navigation/surfaces.ts` — minus the ones a plugin claimed. */
  enabledSurfaces?: SurfaceId[];
  /** Each enabled plugin's rows, folded into sections by `plugin.yaml` `nav.section` (`features/navigation/pluginNav.ts`). */
  pluginNav?: PluginNav;
  /** Tenant pages from the workspace's pages/ dir — the Pages group. */
  workspacePages?: WorkspaceNavPage[];
  /** Open items waiting on a person — shown as a badge on "Review queue" (the inbox PR supplies it). */
  needsYouCount?: number;
  /** The person's active goals here (in Personal, everywhere) — the badge on "Goals". */
  goalsCount?: number;
  /**
   * This workspace's apps (`splitNavByApp(...).apps`), core app included. The
   * other props hold only the core app's rows. Empty: no rail, the nav as it was.
   */
  apps?: AppNav[];
  /** The apps this workspace lacks, with what each owns (`appsElsewhere`): a page of one is never remembered as a place. */
  elsewhere?: readonly ElsewhereApp[];
  /**
   * Where a shared workspace stands on its first four steps
   * (`services/workspace/gettingStarted.ts`); null for a personal one. While
   * a step is left, the Getting started checklist takes the invite card's place.
   */
  gettingStarted?: GettingStartedState | null;
  /** A person's own workspace: no team invite card (there is no team to invite into it). */
  personalWorkspace?: boolean;
}) => {
  const t = useTranslations('DashboardLayout');
  const chrome = useBrandChrome();
  const { state, isMobile } = useSidebar();
  const collapsed = state === 'collapsed';
  const [view, setView] = useState<NavView>('work');
  const prefs = useNavPrefs();
  // A setup step that ran or was undone in chat (`cards/SetupCard.tsx`) can
  // add an app or a page: re-read the shell so the rail shows it now.
  const router = useRouter();
  useEffect(() => {
    const onSetupChanged = () => router.refresh();
    window.addEventListener(SETUP_CHANGED_EVENT, onSetupChanged);
    return () => window.removeEventListener(SETUP_CHANGED_EVENT, onSetupChanged);
  }, [router]);

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

  // ---- the app rail ----
  // Workspace first (founder, 2026-10-23): the rail is THIS workspace's
  // apps, picking one stays here, and the switcher lists every workspace.
  // Which app the nav shows: a page an app owns says its app; a shared page
  // (Chat, Review, a record) keeps the app the person was last in HERE,
  // remembered per workspace with the page (`nav/workspaceMemory.ts`), so a
  // refresh on a shared page stays put and one workspace's app never follows
  // the person into another.
  const pathname = usePathname();
  const slug = useWorkspaceSlug();
  const directory = useWorkspaceDirectory();
  const [lastApp, setLastApp] = useState<string | null>(() => appOwningPath(pathname, apps) ?? null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    const owner = appOwningPath(pathname, apps);
    if (owner && owner !== lastApp) {
      setLastApp(owner);
    }
  }
  useEffect(() => {
    const stored = placeIn(globalThis.localStorage, slug)?.app;
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- SSR-safe restore, the same as the view above
      setLastApp(current => current ?? stored);
    }
  }, [slug]);
  const railApps = useMemo<RailApp[]>(() => apps.map(({ sections: _sections, owns: _owns, ...app }) => app), [apps]);
  const coreAppNav = apps.find(a => a.core);
  const activeAppId = resolveActiveApp({ pathname, apps, remembered: lastApp });
  const activeApp = railApps.find(a => a.id === activeAppId);
  const activeAppNav = apps.find(a => a.id === activeAppId);
  const inCoreApp = !activeApp || activeApp.core;
  // Where the person is here, remembered for the next switch back. A page of
  // an app this workspace lacks is not a place: the shell moves off it.
  const lost = appMissingHere(pathname, apps, elsewhere) !== null;
  useEffect(() => {
    if (slug && activeAppNav && !lost) {
      rememberPlace(globalThis.localStorage, slug, { app: activeAppNav.id, path: pathname });
    }
  }, [slug, activeAppNav, pathname, lost]);
  const pickApp = (app: RailApp) => {
    setLastApp(app.id);
    if (view === 'manage') {
      pick('work');
    }
  };
  // The apps a workspace has, the core app always (even before the directory loads).
  const appsOfProject = (projectId: string) => [
    ...(coreAppNav ? [{ id: coreAppNav.id, name: coreAppNav.name, core: true, entry: coreAppNav.href }] : []),
    ...(directory?.apps ?? []).filter(a => !a.core && (directory?.workspacesByApp[a.id] ?? []).some(w => w.projectId === projectId)),
  ];
  const landingOf = (p: Pick<SwitcherProject, 'id' | 'slug'>) => workspaceLanding({ targetApps: appsOfProject(p.id), place: placeIn(globalThis.localStorage, p.slug), coreEntry: coreAppNav?.href ?? WORKSPACE_HOME });
  // A switch lands where the person left the target, or on its home app,
  // never on this page (`workspaceLanding`).
  const switchTarget: WorkspaceSwitcherTargetPath = p => landingOf(p).path;
  // Under each workspace: only what it adds beyond the core app ("Finance",
  // "Software Factory"), and nothing at all for one with only the core app
  // (an empty line, so the picker's lead-and-agents fallback stays out too).
  // Where it opens is not said; the row just goes there.
  const rowLine = (p: SwitcherProject) => appsLine(appsOfProject(p.id)) ?? '';
  // ONE control for where you are: the Org and the workspace together, one
  // list of every workspace, never a second switcher above it.
  const picker = (
    <WorkspaceSwitcherLive
      directory={directory}
      rowLine={directory ? rowLine : undefined}
      onManage={() => pick('manage')}
      targetPath={switchTarget}
    />
  );

  // Sidebar labels come from the registry's i18n keys (typed against en.json);
  // the English title is the fallback for a route that has none yet.
  const label = useCallback((r: Pick<DashboardRoute, 'i18nKey' | 'title'>) => (r.i18nKey ? t(r.i18nKey) : r.title), [t]);

  // ---- the three WORK groups ----
  // WORKSPACE: Chat and Review are the surface and always show; Briefings,
  // Artifacts, Search and Projects show while pinned (Briefings starts
  // pinned) and otherwise sit one row down under "More" (Chris, 2026-09-18).
  const toWorkItem = useCallback((r: DashboardRoute): PinnableItem => ({
    title: label(r),
    url: r.url,
    icon: r.icon,
    origin: 'work',
    badge: r.url === '/dashboard/inbox' ? needsYouCount : r.url === '/dashboard/goals' ? goalsCount : undefined,
    ...(r.pinnable ? {} : { pinnable: false as const }),
  }), [label, needsYouCount, goalsCount]);
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
  // Defaults: the registry's (Briefings, Scorecard), a plugin's Workspace rows,
  // and what an enabled plugin's manifest declares (`nav.pinByDefault`) —
  // including a pinnable route its app also lists. A person's own pins and
  // unpins win (`resolveWorkPins`).
  const workDefaults = useMemo(() => [...new Set([...DEFAULT_WORK_PINS, ...pluginWorkspace.map(i => i.url), ...(pluginNav?.pinnedByDefault ?? [])])], [pluginWorkspace, pluginNav]);
  const workPins = useMemo(() => resolveWorkPins({ pins: prefs.pins, dismissed: prefs.dismissed, defaults: workDefaults }), [prefs.pins, prefs.dismissed, workDefaults]);
  // The pinned work rows, in the order the main list draws them — the rows it can reorder.
  const workPinnedShown = applyPins(workOptional, workPins);
  const workShown = workCore.length + workPinnedShown.length;
  // Unpinning a default records the choice; everything else is a plain toggle.
  // A default can also be in the stored pins — reordering the work rows stores
  // their whole order — and unpinning it then takes it out of both, or it
  // would come straight back as a default.
  const toggleWorkPin = (url: string) => {
    if (workDefaults.includes(url) && workPins.includes(url)) {
      prefs.dismiss(defaultPinDismissal(url));
      if (prefs.pins.includes(url)) {
        prefs.togglePin(url);
      }
      return;
    }
    prefs.togglePin(url);
  };
  // A move among them is made in the work order (defaults included) and stored whole.
  const moveWorkPin = (url: string, target: string, place: PinPlace) => prefs.movePin(url, target, place, workPins);

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
  const pinnedOrder = pinned.map(i => i.url);
  const unpinnedPages = withoutPins(pageItems, prefs.pins);
  const pagesPrimaryFirst = useMemo(
    () => [...unpinnedPages].sort((a, b) => Number(secondaryUrls.has(a.url)) - Number(secondaryUrls.has(b.url))),
    [unpinnedPages, secondaryUrls],
  );
  const primaryPageCount = pagesPrimaryFirst.filter(i => !secondaryUrls.has(i.url)).length;

  // NO ONE-ROW SECTIONS (founder, 2026-10-08): a section that would hold one
  // row — Pages with only the Wiki, Pinned with one pin, a surface heading
  // with one item — is a row in the main list instead, before More.
  const pagesFolded = pagesPrimaryFirst.length === 1 && primaryPageCount === 1;
  const folded: PinnableItem[] = [
    ...(pinned.length === 1 ? pinned : []),
    ...(pagesFolded ? pagesPrimaryFirst : []),
    ...appSections.filter(section => section.items.length === 1).map(section => ({ ...section.items[0]!, origin: 'work' as const, pinnable: false as const })),
  ];
  // The other apps this workspace has (Finance beside the Workforce). On a
  // phone there is no rail, so they are rows under More. On the desktop the
  // rail's icon alone hid them (Chris, 2026-10-20: "is there Finance specific
  // nav missing?"), so they are also rows here, above More.
  const desktopApps: PinnableItem[] = isMobile ? [] : apps.filter(a => a.id !== activeAppId && !a.core).map(a => ({ title: a.name, url: a.href, icon: iconByName(a.icon), origin: 'work' as const, pinnable: false as const }));
  const mobileApps = isMobile ? railApps.filter(a => a.id !== activeAppId).map(a => ({ title: a.name, url: a.href, icon: iconByName(a.icon), origin: 'work' as const, pinnable: false as const })) : [];
  const mainItems = [...workCore, ...workPinnedShown, ...folded, ...desktopApps, ...withoutPins(workOptional, workPins), ...mobileApps];
  const mainShown = workShown + folded.length + desktopApps.length;
  const mainPins = useMemo(() => [...new Set([...workPins, ...prefs.pins])], [workPins, prefs.pins]);
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

  const moveLabels = { moveUpLabel: t('move_up'), moveDownLabel: t('move_down') };
  const pinLabels = { moreLabel: t('more_pages'), pinLabel: t('pin'), unpinLabel: t('unpin'), ...moveLabels };

  const manageRow = (
    <div className="px-2 pb-1 group-data-[collapsible=icon]:px-0">
      <ManageWorkspaceRow label={t('manage_workspace')} collapsed={collapsed} onOpen={() => pick('manage')} />
    </div>
  );

  // A non-core app's nav: Chat and Review (every app shares them), then its
  // own sections. The rail shows only this workspace's apps, so the app is
  // always one it has.
  const appWork = (
    <>
      {activeAppNav && (
        <>
          <AppSidebarNav items={workCore.map(i => ({ title: i.title, url: i.url, icon: i.icon, badge: i.badge }))} />
          {activeAppNav.sections.map(section => (
            <AppSidebarNav
              key={`app:${section.label}`}
              label={section.label}
              items={section.items.map(i => ({ title: i.title, url: i.url, icon: pluginIcon(i.url, i.icon), ...(i.secondary ? { secondary: true } : {}) }))}
              moreLabel={t('more')}
            />
          ))}
        </>
      )}
      <div className="mt-auto">{manageRow}</div>
    </>
  );

  const headerApp = view === 'manage' ? railApps.find(a => a.core) : activeApp;
  const nav = (
    <>
      {/* The header is the one switcher: the Org's mark, then the
          workspace (founder, 2026-10-08: one logo, no "Workforce" row). An
          app other than the core one still names itself under it, so the
          nav says which app it is. */}
      <SidebarHeader className="pt-4 pb-1 group-data-[collapsible=icon]:px-0">
        <div className="px-0 group-data-[collapsible=icon]:px-0">{picker}</div>
        {headerApp && !headerApp.core && (
          <div data-testid="app-header" className="flex items-center gap-2 px-2 pt-1.5 group-data-[collapsible=icon]:hidden">
            <LetterTile name={headerApp.name} icon={iconByName(headerApp.icon)} tint={headerApp.tint} size="sm" />
            <span className="truncate text-[13px] font-semibold text-foreground" title={headerApp.name}>{headerApp.shortName ?? headerApp.name}</span>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {view === 'work' && !inCoreApp
          ? appWork
          : view === 'work'
            ? (
                <>
                  {/* The main list — no section label: Chat, Review, the
                      pinned work rows, any one-row section folded in (a lone
                      Wiki is a row here, not a "Pages" section of one), then
                      More, and on a phone the apps (there is no rail). */}
                  <PinnableNav
                    items={mainItems}
                    pins={mainPins}
                    onTogglePin={toggleWorkPin}
                    onMovePin={moveWorkPin}
                    order={workPinnedShown.map(i => i.url)}
                    max={mainShown}
                    moreLabel={t('more')}
                    pinLabel={t('pin')}
                    unpinLabel={t('unpin')}
                    {...moveLabels}
                  />

                  {/* PINNED — this person's pins, in pin order, draggable. */}
                  {pinned.length > 1 && (
                    <PinnableNav
                      label={t('pinned')}
                      items={pinned}
                      pins={prefs.pins}
                      onTogglePin={prefs.togglePin}
                      onMovePin={prefs.movePin}
                      order={pinnedOrder}
                      max={99}
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
                  {!pagesFolded && (
                    <PinnableNav
                      label={t('pages')}
                      items={pagesPrimaryFirst}
                      pins={prefs.pins}
                      onTogglePin={prefs.togglePin}
                      max={Math.min(PAGES_MAX, primaryPageCount)}
                      {...pinLabels}
                    />
                  )}

                  {/* Named sections no app owns: the workspace's surfaces and
                      plugin sections that belong to no app manifest, one group
                      per heading. An app's own sections are in that app. */}
                  {appSections.filter(section => section.items.length > 1).map(section => (
                    <AppSidebarNav key={`app:${section.label}`} label={section.label} items={section.items} moreLabel={t('more')} />
                  ))}

                  {/* Bottom cluster: the Getting started checklist while a
                      shared workspace has a first step left — it replaces the
                      invite card, which is one of its steps — otherwise the
                      invite card (both dismissible, remembered), and the door
                      to the workspace's configuration. */}
                  <div className="mt-auto">
                    {checklistApplies(gettingStarted)
                      ? !prefs.dismissed.includes(GETTING_STARTED_CARD) && <GettingStartedChecklist initial={gettingStarted} onDismiss={() => prefs.dismiss(GETTING_STARTED_CARD)} />
                      : !gettingStarted && !personalWorkspace && !prefs.dismissed.includes(INVITE_CARD) && <InviteTeamCard onDismiss={() => prefs.dismiss(INVITE_CARD)} />}
                    {/* The visible door to MANAGE — everything configurational is
                        behind it, so it is a row in the nav, not only a line in a
                        popover. Icon rail: the gear alone, with a tooltip. */}
                    {manageRow}
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
                    <PinnableNav label={t('pinned')} items={pinned} pins={prefs.pins} onTogglePin={prefs.togglePin} onMovePin={prefs.movePin} order={pinnedOrder} max={99} {...pinLabels} />
                  )}
                  {manageSections.map(manageGroup)}
                  <AppSidebarNav items={[{ title: t('docs'), url: 'https://www.vocion.ai/docs', icon: FileText }]} />
                </>
              )}
      </SidebarContent>
    </>
  );

  return (
    <Sidebar {...props}>
      {railApps.length > 0 && !isMobile
        ? (
            <div className="flex min-h-0 flex-1">
              <AppRail
                apps={railApps}
                activeId={view === 'manage' ? coreAppNav?.id : activeAppId}
                onPick={pickApp}
                label={t('apps')}
                addLabel={t('add_app')}
                addHref="/dashboard/apps"
              />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">{nav}</div>
            </div>
          )
        : nav}

      {/* The footer: who is signed in, then one quiet line for the brand that
          does not lead the install (`libs/branding/chrome.ts`, never both):
          Vocion's wordmark where Vocion leads (Cloud), "Powered by Vocion"
          where the Org does (removed only by an extension that
          white-labels, `branding.whiteLabel`). A sibling of the scrolling nav
          above, never on top of it: the nav scrolls, the footer stays. */}
      <SidebarFooter data-testid="sidebar-footer" className="shrink-0 border-t border-sidebar-border/60 px-3 pt-2 pb-3 group-data-[collapsible=icon]:hidden">
        <SidebarUser />
        {chrome.footer === 'vocion-wordmark' && <VocionWordmark className="px-2 pt-1" />}
        {chrome.footer === 'powered-by' && <PoweredByVocion />}
      </SidebarFooter>
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

/**
 * Who is signed in, at the foot of the nav: initials, then the name. Display
 * only: the account menu (the avatar in the top bar) is where the person's
 * own pages open, so the footer adds no second door. Reads the session's
 * context, so a story with no session shows nothing rather than throwing.
 */
function SidebarUser() {
  const session = use(SessionContext);
  const user = session?.data?.user;
  if (!user) {
    return null;
  }
  const name = user.name || user.email || '';
  const initials = (user.name ?? '').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || (user.email?.[0] ?? '?').toUpperCase();
  return (
    <div data-testid="sidebar-user" className="flex min-w-0 items-center gap-2 px-1 py-1 text-[13px] text-sidebar-foreground">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-soft text-[11px] font-medium text-muted-foreground" aria-hidden>{initials}</span>
      <span className="truncate">{name}</span>
    </div>
  );
}
