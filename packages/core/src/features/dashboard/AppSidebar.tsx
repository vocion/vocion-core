'use client';

import type { PinnableItem } from './nav/navPins';
import type { SurfaceId } from '@/features/navigation/surfaces';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Code2,
  Compass,
  Cpu,
  Database,
  FileText,
  GitBranch,
  Inbox,
  KeyRound,
  LayoutGrid,
  LineChart,
  MessageSquare,
  Network,
  Newspaper,
  PanelsTopLeft,
  Plug,
  ShieldCheck,
  Sparkles,
  TestTube,
  TrendingUp,
  UserPlus,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { InviteTeamCard } from '@/features/dashboard/InviteTeamCard';
import { applyPins, withoutPins } from '@/features/dashboard/nav/navPins';
import { PinnableNav } from '@/features/dashboard/nav/PinnableNav';
import { useNavPrefs } from '@/features/dashboard/nav/useNavPrefs';
import { WorkspaceSwitcherLive } from '@/features/dashboard/nav/WorkspaceSwitcher';
import { readNavView, writeNavView } from '@/features/dashboard/useNavView';
import { SurfaceNav } from '@/features/navigation/SurfaceNav';
import { client } from '@/libs/Orpc';
import { VOCION_PRIMARY_MARK } from '@/templates/VocionLogo';

/**
 * Dashboard left sidebar — two views, Linear-settings style:
 *
 *   WORK (default) — Workspace (the permanent Vocion pages), Pinned (this
 *                    person's pins, in pin order), Pages (the workspace's own
 *                    pages: tenant pages and saved canvases, 7 then "More
 *                    pages ›"), the invite card, and the workspace row.
 *   MANAGE         — entered via the quiet "Manage workspace" item at the
 *                    BOTTOM of the work view; the configuration sections,
 *                    every row pinnable, with "Back to work" at top.
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
  title: string;
  url: string;
  section: string;
};

type Canvas = { id: number; title: string };

/**
 * Saved canvases arrive with R3's PR (#333: `client.artifacts.canvases.list`).
 * Feature-detected so this build stands alone; when the procedure exists the
 * canvases join the Pages group at `/dashboard/chat/<id>?grid=open`.
 */
async function listCanvases(): Promise<Canvas[]> {
  const maybe = (client as unknown as { artifacts?: { canvases?: { list?: () => Promise<unknown> } } }).artifacts?.canvases?.list;
  if (typeof maybe !== 'function') {
    return [];
  }
  try {
    const rows = await maybe();
    const list = Array.isArray(rows) ? rows : (rows as { canvases?: unknown[] })?.canvases ?? [];
    return list
      .filter((r): r is { id: number; title: string } => typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'number')
      .map(r => ({ id: r.id, title: r.title || `Canvas ${r.id}` }));
  } catch {
    return [];
  }
}

export const AppSidebar = ({ isAdmin = false, enabledSurfaces = [], workspacePages = [], needsYouCount = 0, ...props }: React.ComponentProps<typeof Sidebar> & {
  /** Shows admin-only nav items (Adoption). Gating is enforced server-side; this only hides the link. */
  isAdmin?: boolean;
  /** Optional surfaces the workspace switched on — see `features/navigation/surfaces.ts`. */
  enabledSurfaces?: SurfaceId[];
  /** Tenant pages from the workspace's pages/ dir — the Pages group. */
  workspacePages?: WorkspaceNavPage[];
  /** Open items waiting on a person — shown as a badge on "Needs you" (the inbox PR supplies it). */
  needsYouCount?: number;
}) => {
  const t = useTranslations('DashboardLayout');
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const [view, setView] = useState<NavView>('work');
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const prefs = useNavPrefs();

  // Restore the persisted view after mount (SSR renders the default).
  useEffect(() => {
    if (readNavView(globalThis.localStorage) === 'manage') {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- pre-existing SSR-safe restore; hydration must render the default first
      setView('manage');
    }
    let cancelled = false;
    void listCanvases().then((c) => {
      if (!cancelled) {
        setCanvases(c);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = (v: NavView) => {
    setView(v);
    writeNavView(globalThis.localStorage, v);
  };

  // ---- the three WORK groups ----
  const workspaceItems = [
    { title: t('chat'), url: '/dashboard/chat', icon: MessageSquare },
    { title: t('inbox'), url: '/dashboard/inbox', icon: Inbox, badge: needsYouCount },
    { title: 'Briefings', url: '/dashboard/briefings', icon: Newspaper },
    { title: t('review'), url: '/dashboard/review', icon: CheckSquare },
    { title: 'Activity', url: '/dashboard/activity', icon: Activity },
    { title: t('search'), url: '/dashboard/search', icon: BookOpen },
    { title: t('team_report'), url: '/dashboard/team-report', icon: Network },
  ];

  const pageItems = useMemo<PinnableItem[]>(() => [
    ...workspacePages.map(p => ({ title: p.title, url: p.url, icon: PanelsTopLeft, origin: 'page' as const })),
    ...canvases.map(c => ({ title: c.title, url: `/dashboard/chat/${c.id}?grid=open`, icon: LayoutGrid, origin: 'canvas' as const })),
  ], [workspacePages, canvases]);

  const manageItems = useMemo<PinnableItem[]>(() => {
    const m = (title: string, url: string, icon: PinnableItem['icon']): PinnableItem => ({ title, url, icon, origin: 'manage' });
    return [
      m(t('teams'), '/dashboard/teams', Network),
      m(t('agents'), '/dashboard/agents', Users),
      m('Missions', '/dashboard/missions', Compass),
      m(t('workflows'), '/dashboard/workflows', GitBranch),
      m('Automation', '/dashboard/automation', CalendarClock),
      m(t('sources'), '/dashboard/connectors', Plug),
      m(t('objects'), '/dashboard/objects', Database),
      m(t('learnings'), '/dashboard/learnings', Sparkles),
      m(t('skills'), '/dashboard/skills', Zap),
      m('Tools', '/dashboard/tools', Wrench),
      m('Vision models', '/dashboard/models', Cpu),
      m(t('evals'), '/dashboard/evals', TestTube),
      m(t('observability'), '/dashboard/observability', LineChart),
      m(t('autonomy'), '/dashboard/autonomy', TrendingUp),
      ...(isAdmin ? [m(t('adoption'), '/dashboard/adoption', BarChart3)] : []),
      m('Members', '/dashboard/members', UserPlus),
      ...(isAdmin ? [m('API tokens', '/dashboard/api-tokens', KeyRound)] : []),
      m('System', '/dashboard/admin', ShieldCheck),
    ];
  }, [isAdmin, t]);

  const pinnable = useMemo(() => [...pageItems, ...manageItems], [pageItems, manageItems]);
  const pinned = applyPins(pinnable, prefs.pins);
  const unpinnedPages = withoutPins(pageItems, prefs.pins);
  const manageGroup = (label: string, urls: string[]) => (
    <PinnableNav
      key={label}
      label={label}
      items={withoutPins(manageItems.filter(i => urls.includes(i.url)), prefs.pins)}
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
                <AppSidebarNav label={t('main_section_label')} items={workspaceItems} />

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

                {/* PAGES — the workspace's own pages (tenant pages + saved
                    canvases), seven then "More pages ›". */}
                <PinnableNav
                  label={t('pages')}
                  items={unpinnedPages}
                  pins={prefs.pins}
                  onTogglePin={prefs.togglePin}
                  max={PAGES_MAX}
                  {...pinLabels}
                />

                {/* Workspace-enabled surfaces (workspace.yaml `surfaces:`).
                    Renders nothing when none are on. */}
                <SurfaceNav enabled={enabledSurfaces} />

                {/* Bottom cluster: invite card (dismissible, remembered),
                    which workspace you're in + the door to its configuration. */}
                <div className="mt-auto">
                  {!prefs.dismissed.includes(INVITE_CARD) && <InviteTeamCard onDismiss={() => prefs.dismiss(INVITE_CARD)} />}
                  {/* Developers — API tokens for admins, the in-app docs otherwise. */}
                  <AppSidebarNav className="py-0" items={[{ title: t('developers'), url: isAdmin ? '/dashboard/api-tokens' : '/dashboard/docs', icon: Code2 }]} />
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
                  <button
                    type="button"
                    onClick={() => pick('work')}
                    title={t('back_to_work')}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-surface-hover hover:text-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                  >
                    <ArrowLeft className="size-4 shrink-0" aria-hidden />
                    <span className="group-data-[collapsible=icon]:hidden">{t('back_to_work')}</span>
                  </button>
                </div>
                {/* MANAGE — who works for you + the shapes their work takes.
                    Every row is pinnable into the WORK view's Pinned group. */}
                {pinned.length > 0 && (
                  <PinnableNav label={t('pinned')} items={pinned} pins={prefs.pins} onTogglePin={prefs.togglePin} onMovePin={prefs.movePin} max={99} reorderable {...pinLabels} />
                )}
                {manageGroup('Team', ['/dashboard/teams', '/dashboard/agents', '/dashboard/missions', '/dashboard/workflows', '/dashboard/automation'])}
                {manageGroup('Knowledge', ['/dashboard/connectors', '/dashboard/objects', '/dashboard/learnings'])}
                {manageGroup('Build', ['/dashboard/skills', '/dashboard/tools', '/dashboard/models', '/dashboard/evals'])}
                {manageGroup(t('observability_section_label'), ['/dashboard/observability', '/dashboard/autonomy'])}
                {manageGroup(t('organization_section_label'), ['/dashboard/adoption', '/dashboard/members', '/dashboard/api-tokens', '/dashboard/admin'])}
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
