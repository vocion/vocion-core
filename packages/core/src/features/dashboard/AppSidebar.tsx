'use client';

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
  Inbox,
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
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { AppSidebarNavGroup } from '@/features/dashboard/AppSidebarNavGroup';
import { readNavView, writeNavView } from '@/features/dashboard/useNavView';
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
 * Nav sweep 2026-07-24: every route has a real page (no dead links, no
 * stubs). Active-state styling via `--sidebar-accent`.
 *
 * Airy pass (B-034b §3): the sidebar collapses to a 56px icon rail (the shell
 * passes `collapsible="icon"`; the rail toggle + ⌘B persist it in the sidebar
 * cookie), rows are 13px with tooltips, the © line moved to the account menu,
 * and "Needs you" carries a live count when the shell has one.
 * @param props.isAdmin
 * @param props
 */

type NavView = 'work' | 'manage';

/** Workspace-defined pages (libs/workspace/pages.ts), grouped for the nav. */
export type WorkspaceNavPage = {
  title: string;
  url: string;
  section: string;
};

export const AppSidebar = ({ isAdmin = false, enabledSurfaces = [], workspacePages = [], needsYouCount = 0, ...props }: React.ComponentProps<typeof Sidebar> & {
  /** Shows admin-only nav items (Adoption). Gating is enforced server-side; this only hides the link. */
  isAdmin?: boolean;
  /** Open items waiting on a person — shown as a badge on "Needs you" (the inbox PR supplies it). */
  needsYouCount?: number;
  /** Optional surfaces the workspace switched on — see `features/navigation/surfaces.ts`. */
  enabledSurfaces?: SurfaceId[];
  /** Tenant pages from the workspace's pages/ dir — rendered as their own WORK sections. */
  workspacePages?: WorkspaceNavPage[];
}) => {
  const t = useTranslations('DashboardLayout');
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const [view, setView] = useState<NavView>('work');

  // Restore the persisted view after mount (SSR renders the default).
  // localStorage cannot be read while rendering on the server, so a lazy
  // useState initializer would hydrate with a mismatched value — the setState
  // here is the intended hydration pattern, not a cascading render.
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

  return (
    <Sidebar {...props}>
      <SidebarHeader className="pt-5">
        <div className="flex justify-start px-2 pb-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <VocionLogo size="sm" isTextHidden={collapsed} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {view === 'work'
          ? (
              // WORK — the daily surface; the only door to config is the
              // quiet Manage entry at the bottom.
              <>
                <AppSidebarNav
                  label={t('main_section_label')}
                  items={[
                    { title: t('chat'), url: '/dashboard/chat', icon: MessageSquare },
                    { title: t('needs_you'), url: '/dashboard/inbox', icon: Inbox, badge: needsYouCount },
                    { title: 'Briefings', url: '/dashboard/briefings', icon: Newspaper },
                    { title: t('review'), url: '/dashboard/review', icon: CheckSquare },
                    { title: 'Activity', url: '/dashboard/activity', icon: Activity },
                    { title: t('search'), url: '/dashboard/search', icon: BookOpen },
                  ]}
                />
                {/* Workspace-enabled surfaces (workspace.yaml `surfaces:`).
                    Renders nothing when none are on. */}
                <SurfaceNav enabled={enabledSurfaces} />
                {[...new Set(workspacePages.map(p => p.section))].map(section => (
                  <AppSidebarNav
                    key={section}
                    label={section}
                    items={workspacePages
                      .filter(p => p.section === section)
                      .map(p => ({ title: p.title, url: p.url, icon: PanelsTopLeft }))}
                  />
                ))}
                {/* Bottom cluster: which workspace you're in + the door to
                    its configuration. Both are context, not daily nav. */}
                <div className="mt-auto px-2 pb-1 group-data-[collapsible=icon]:hidden">
                  <WorkspaceMenu isAdmin={isAdmin} onManage={() => pick('manage')} />
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
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                  >
                    <ArrowLeft className="size-4 shrink-0" aria-hidden />
                    <span className="group-data-[collapsible=icon]:hidden">{t('back_to_work')}</span>
                  </button>
                </div>
                {/* MANAGE — who works for you + the shapes their work takes. */}
                <AppSidebarNav
                  label="Team"
                  items={[
                    { title: t('teams'), url: '/dashboard/teams', icon: Network },
                    { title: t('agents'), url: '/dashboard/agents', icon: Users },
                    { title: 'Missions', url: '/dashboard/missions', icon: Compass },
                    { title: t('workflows'), url: '/dashboard/workflows', icon: GitBranch },
                    { title: 'Automation', url: '/dashboard/automation', icon: CalendarClock },
                  ]}
                />

                {/* What the team knows. Playbooks folded into Skills. */}
                <AppSidebarNav
                  label="Knowledge"
                  items={[
                    { title: t('sources'), url: '/dashboard/connectors', icon: Plug },
                    { title: t('objects'), url: '/dashboard/objects', icon: Database },
                    { title: t('learnings'), url: '/dashboard/learnings', icon: Sparkles },
                  ]}
                />

                {/* How capabilities are made and proven. */}
                <AppSidebarNav
                  label="Build"
                  items={[
                    { title: t('skills'), url: '/dashboard/skills', icon: Zap },
                    { title: 'Tools', url: '/dashboard/tools', icon: Wrench },
                    { title: 'Vision models', url: '/dashboard/models', icon: Cpu },
                    { title: t('evals'), url: '/dashboard/evals', icon: TestTube },
                  ]}
                />

                {/* See what happened. Logs folded into Activity. */}
                <AppSidebarNav
                  label={t('observability_section_label')}
                  items={[
                    { title: t('observability'), url: '/dashboard/observability', icon: LineChart },
                  ]}
                />

                {/* The account itself. Adoption is admin-gated server-side too. */}
                <AppSidebarNavGroup
                  label={t('organization_section_label')}
                  items={[
                    ...(isAdmin ? [{ title: t('adoption'), url: '/dashboard/adoption', icon: BarChart3 }] : []),
                    { title: 'Members', url: '/dashboard/members', icon: UserPlus },
                    ...(isAdmin ? [{ title: 'API tokens', url: '/dashboard/api-tokens', icon: KeyRound }] : []),
                    { title: 'System', url: '/dashboard/admin', icon: ShieldCheck },
                    { title: t('docs'), url: 'https://www.vocion.ai/docs', icon: FileText },
                  ]}
                />

                <div className="mt-auto px-2 pb-1 group-data-[collapsible=icon]:hidden">
                  <WorkspaceMenu isAdmin={isAdmin} onManage={() => pick('manage')} />
                </div>
              </>
            )}
      </SidebarContent>

      {/* The © / attribution line lives in the account menu now (B-034b §3). */}
      <SidebarRail />
    </Sidebar>
  );
};
