'use client';

import type { AppSidebarNavItem } from '@/features/dashboard/AppSidebarNav';
import type { SurfaceId } from '@/features/navigation/surfaces';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Compass,
  Cpu,
  Database,
  FileText,
  GitBranch,
  KeyRound,
  LineChart,
  MessageSquare,
  Network,
  Newspaper,
  PanelsTopLeft,
  Plug,
  ShieldCheck,
  Sparkles,
  TestTube,
  UserPlus,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { AppSidebarNavGroup } from '@/features/dashboard/AppSidebarNavGroup';
import { usePinnedNav } from '@/features/dashboard/usePinnedNav';
import { WorkspaceMenu } from '@/features/dashboard/WorkspaceMenu';
import { SurfaceNav } from '@/features/navigation/SurfaceNav';
import { VocionLogo } from '@/templates/VocionLogo';

/**
 * Dashboard left sidebar — two views, Linear-settings style:
 *
 *   WORK (default) — the daily surface only: chat, briefings, review,
 *                    activity, search. Pure navigation, no chrome.
 *   MANAGE         — entered via the quiet "Manage workspace" item at the
 *                    BOTTOM of the work view; swaps the sidebar into the
 *                    configuration sections with "Back to work" at top.
 *
 * The view persists per browser (reloading mid-manage keeps you managing).
 * Collapses to an icon rail (⌘B / the trigger) with tooltips; the active
 * item is highlighted from the pathname; any item can be pinned to a
 * "Pinned" group at the top that survives the work/manage switch.
 * @param props.isAdmin
 * @param props
 */

const NAV_VIEW_KEY = 'vocion:nav:view';
type NavView = 'work' | 'manage';

/** Workspace-defined pages (libs/workspace/pages.ts), grouped for the nav. */
export type WorkspaceNavPage = {
  title: string;
  url: string;
  section: string;
};

export const AppSidebar = ({ isAdmin = false, enabledSurfaces = [], workspacePages = [], ...props }: React.ComponentProps<typeof Sidebar> & {
  /** Shows admin-only nav items (Adoption). Gating is enforced server-side; this only hides the link. */
  isAdmin?: boolean;
  /** Optional surfaces the workspace switched on — see `features/navigation/surfaces.ts`. */
  enabledSurfaces?: SurfaceId[];
  /** Tenant pages from the workspace's pages/ dir — rendered as their own WORK sections. */
  workspacePages?: WorkspaceNavPage[];
}) => {
  const t = useTranslations('DashboardLayout');
  const [view, setView] = useState<NavView>('work');
  const { pinned, togglePin, isPinned } = usePinnedNav();
  const { state: sidebarState } = useSidebar();
  const collapsed = sidebarState === 'collapsed';

  // Restore the persisted view after mount (SSR renders the default).
  // localStorage cannot be read while rendering on the server, so a lazy
  // useState initializer would hydrate with a mismatched value — the setState
  // here is the intended hydration pattern, not a cascading render.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NAV_VIEW_KEY);
      if (stored === 'manage') {
        // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- pre-existing SSR-safe restore; hydration must render the default first
        setView('manage');
      }
    } catch { /* private mode */ }
  }, []);

  const pick = (v: NavView) => {
    setView(v);
    try {
      localStorage.setItem(NAV_VIEW_KEY, v);
    } catch { /* ignore */ }
  };

  const workItems: AppSidebarNavItem[] = [
    { title: t('chat'), url: '/dashboard/chat', icon: MessageSquare },
    { title: 'Briefings', url: '/dashboard/briefings', icon: Newspaper },
    { title: t('review'), url: '/dashboard/review', icon: CheckSquare },
    { title: 'Activity', url: '/dashboard/activity', icon: Activity },
    { title: t('search'), url: '/dashboard/search', icon: BookOpen },
  ];
  const teamItems: AppSidebarNavItem[] = [
    { title: t('teams'), url: '/dashboard/teams', icon: Network },
    { title: t('agents'), url: '/dashboard/agents', icon: Users },
    { title: 'Missions', url: '/dashboard/missions', icon: Compass },
    { title: t('workflows'), url: '/dashboard/workflows', icon: GitBranch },
    { title: 'Automation', url: '/dashboard/automation', icon: CalendarClock },
  ];
  const knowledgeItems: AppSidebarNavItem[] = [
    { title: t('sources'), url: '/dashboard/connectors', icon: Plug },
    { title: t('objects'), url: '/dashboard/objects', icon: Database },
    { title: t('learnings'), url: '/dashboard/learnings', icon: Sparkles },
  ];
  const buildItems: AppSidebarNavItem[] = [
    { title: t('skills'), url: '/dashboard/skills', icon: Zap },
    { title: 'Tools', url: '/dashboard/tools', icon: Wrench },
    { title: 'Vision models', url: '/dashboard/models', icon: Cpu },
    { title: t('evals'), url: '/dashboard/evals', icon: TestTube },
  ];
  const observeItems: AppSidebarNavItem[] = [
    { title: t('observability'), url: '/dashboard/observability', icon: LineChart },
  ];
  const orgItems: AppSidebarNavItem[] = [
    ...(isAdmin ? [{ title: t('adoption'), url: '/dashboard/adoption', icon: BarChart3 }] : []),
    { title: 'Members', url: '/dashboard/members', icon: UserPlus },
    ...(isAdmin ? [{ title: 'API tokens', url: '/dashboard/api-tokens', icon: KeyRound }] : []),
    { title: 'System', url: '/dashboard/admin', icon: ShieldCheck },
    { title: t('docs'), url: 'https://www.vocion.ai/docs', icon: FileText },
  ];
  const pageItems: AppSidebarNavItem[] = workspacePages.map(p => ({ title: p.title, url: p.url, icon: PanelsTopLeft }));
  const everyItem = [...workItems, ...teamItems, ...knowledgeItems, ...buildItems, ...observeItems, ...orgItems, ...pageItems];
  // Pinned keeps the user's order; items whose route no longer exists drop out silently.
  const pinnedItems = pinned.map(url => everyItem.find(i => i.url === url)).filter((i): i is AppSidebarNavItem => Boolean(i));
  const pinProps = { onTogglePin: togglePin, isPinned };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="pt-4">
        <div className="flex justify-start px-2 pb-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <VocionLogo size="sm" isTextHidden={collapsed} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {pinnedItems.length > 0 && (
          <AppSidebarNav label="Pinned" items={pinnedItems} {...pinProps} />
        )}
        {view === 'work'
          ? (
              // WORK — the daily surface; the only door to config is the
              // quiet Manage entry at the bottom.
              <>
                <AppSidebarNav label={t('main_section_label')} items={workItems} {...pinProps} />
                {/* Workspace-enabled surfaces (workspace.yaml `surfaces:`).
                    Renders nothing when none are on. */}
                <SurfaceNav enabled={enabledSurfaces} />
                {[...new Set(workspacePages.map(p => p.section))].map(section => (
                  <AppSidebarNav
                    key={section}
                    label={section}
                    items={pageItems.filter(p => workspacePages.find(w => w.url === p.url)?.section === section)}
                    {...pinProps}
                  />
                ))}
              </>
            )
          : (
              <>
                <div className="px-2 pt-1 group-data-[collapsible=icon]:px-0">
                  <button
                    type="button"
                    onClick={() => pick('work')}
                    title="Back to work"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px] font-medium text-sidebar-foreground/80 transition group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  >
                    <ArrowLeft className="size-4 shrink-0" aria-hidden />
                    <span className="group-data-[collapsible=icon]:hidden">Back to work</span>
                  </button>
                </div>
                {/* MANAGE — who works for you + the shapes their work takes. */}
                <AppSidebarNav label="Team" items={teamItems} {...pinProps} />
                {/* What the team knows. Playbooks folded into Skills. */}
                <AppSidebarNav label="Knowledge" items={knowledgeItems} {...pinProps} />
                {/* How capabilities are made and proven. */}
                <AppSidebarNav label="Build" items={buildItems} {...pinProps} />
                {/* See what happened. Logs folded into Activity. */}
                <AppSidebarNav label={t('observability_section_label')} items={observeItems} {...pinProps} />
                {/* The account itself. Adoption is admin-gated server-side too. */}
                <AppSidebarNavGroup label={t('organization_section_label')} items={orgItems} />
              </>
            )}
        {/* Bottom cluster: which workspace you're in + the door to its
            configuration. Both are context, not daily nav. */}
        <div className="mt-auto px-2 pb-1 group-data-[collapsible=icon]:px-0">
          <WorkspaceMenu isAdmin={isAdmin} onManage={() => pick('manage')} />
        </div>
      </SidebarContent>

      <SidebarFooter className="px-4 pb-3 text-[11px] text-muted-foreground/70 group-data-[collapsible=icon]:hidden">
        <div>
          ©
          {' '}
          {new Date().getFullYear()}
          {' '}
          {/* Deployments override via NEXT_PUBLIC_BRAND_ATTRIBUTION
              (same pattern as the NEXT_PUBLIC_BRAND_* logo vars). */}
          {process.env.NEXT_PUBLIC_BRAND_ATTRIBUTION || 'Vocion · Apache 2.0'}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};
