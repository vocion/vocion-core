'use client';

import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Compass,
  Database,
  FileText,
  GitBranch,
  LineChart,
  MessageSquare,
  Network,
  Newspaper,
  Plug,
  Radar,
  ScrollText,
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
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { AppSidebarNavGroup } from '@/features/dashboard/AppSidebarNavGroup';
import { WorkspaceMenu } from '@/features/dashboard/WorkspaceMenu';
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
 * @param props.isAdmin
 * @param props
 */

const NAV_VIEW_KEY = 'vocion:nav:view';
type NavView = 'work' | 'manage';

export const AppSidebar = ({ isAdmin = false, ...props }: React.ComponentProps<typeof Sidebar> & {
  /** Shows admin-only nav items (Adoption). Gating is enforced server-side; this only hides the link. */
  isAdmin?: boolean;
}) => {
  const t = useTranslations('DashboardLayout');
  const [view, setView] = useState<NavView>('work');

  // Restore the persisted view after mount (SSR renders the default).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NAV_VIEW_KEY);
      if (stored === 'manage') {
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

  return (
    <Sidebar {...props}>
      <SidebarHeader className="pt-5">
        <div className="flex justify-start px-2 pb-2">
          <VocionLogo size="sm" />
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
                    { title: 'Briefings', url: '/dashboard/briefings', icon: Newspaper },
                    { title: t('review'), url: '/dashboard/review', icon: CheckSquare },
                    { title: 'Discovery', url: '/dashboard/discovery', icon: Radar },
                    { title: 'Activity', url: '/dashboard/activity', icon: Activity },
                    { title: t('search'), url: '/dashboard/search', icon: BookOpen },
                  ]}
                />
                {/* Bottom cluster: which workspace you're in + the door to
                    its configuration. Both are context, not daily nav. */}
                <div className="mt-auto px-2 pb-1">
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
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px] font-medium text-sidebar-foreground/80 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  >
                    <ArrowLeft className="size-4" aria-hidden />
                    Back to work
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

                {/* What the team knows. */}
                <AppSidebarNav
                  label="Knowledge"
                  items={[
                    { title: t('sources'), url: '/dashboard/sources', icon: Plug },
                    { title: t('objects'), url: '/dashboard/objects', icon: Database },
                    { title: t('playbooks'), url: '/dashboard/playbooks', icon: ScrollText },
                    { title: t('learnings'), url: '/dashboard/learnings', icon: Sparkles },
                  ]}
                />

                {/* How capabilities are made and proven. */}
                <AppSidebarNav
                  label="Build"
                  items={[
                    { title: t('skills'), url: '/dashboard/skills', icon: Zap },
                    { title: 'Tools', url: '/dashboard/tools', icon: Wrench },
                    { title: t('evals'), url: '/dashboard/evals', icon: TestTube },
                  ]}
                />

                {/* See what happened. */}
                <AppSidebarNav
                  label={t('observability_section_label')}
                  items={[
                    { title: t('logs'), url: '/dashboard/logs', icon: Activity },
                    { title: t('observability'), url: '/dashboard/observability', icon: LineChart },
                  ]}
                />

                {/* The account itself. Adoption is admin-gated server-side too. */}
                <AppSidebarNavGroup
                  label={t('organization_section_label')}
                  items={[
                    ...(isAdmin ? [{ title: t('adoption'), url: '/dashboard/adoption', icon: BarChart3 }] : []),
                    { title: 'Members', url: '/dashboard/members', icon: UserPlus },
                    { title: 'System', url: '/dashboard/admin', icon: ShieldCheck },
                    { title: t('docs'), url: 'https://www.vocion.ai/docs', icon: FileText },
                  ]}
                />

                <div className="mt-auto px-2 pb-1">
                  <WorkspaceMenu isAdmin={isAdmin} onManage={() => pick('manage')} />
                </div>
              </>
            )}
      </SidebarContent>

      <SidebarFooter className="px-4 pb-3 text-[11px] text-muted-foreground/70">
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
