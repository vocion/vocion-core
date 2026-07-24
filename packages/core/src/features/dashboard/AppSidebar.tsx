'use client';

import {
  Activity,
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
  Play,
  Plug,
  ScrollText,
  Settings2,
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
import { ProjectSwitcher } from '@/features/dashboard/ProjectSwitcher';
import { VocionLogo } from '@/templates/VocionLogo';

/**
 * Dashboard left sidebar — two VIEWS behind a segmented toggle:
 *
 *   USE (default)  — living in the app day to day: chat with the team,
 *                    read briefs, approve its work, see activity, search.
 *   CONFIGURE      — shaping the app: the team roster + its work shapes,
 *                    knowledge, build primitives, observability, and the
 *                    organization itself.
 *
 * The choice persists per browser (localStorage). Nav-item sweep 2026-07-24:
 * every route below has a real page (no dead links, no stubs) — the split is
 * about focus, not pruning. Active-state styling via `--sidebar-accent`.
 * @param props.isAdmin
 * @param props
 */

const NAV_VIEW_KEY = 'vocion:nav:view';
type NavView = 'use' | 'configure';

export const AppSidebar = ({ isAdmin = false, ...props }: React.ComponentProps<typeof Sidebar> & {
  /** Shows admin-only nav items (Adoption). Gating is enforced server-side; this only hides the link. */
  isAdmin?: boolean;
}) => {
  const t = useTranslations('DashboardLayout');
  const [view, setView] = useState<NavView>('use');

  // Restore the persisted view after mount (SSR renders the default).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NAV_VIEW_KEY);
      if (stored === 'configure') {
        setView('configure');
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

        {/* ProjectSwitcher renders only when there's more than one workspace. */}
        <ProjectSwitcher />

        {/* Use ⇄ Configure — the two jobs this nav serves. */}
        <div className="mx-2 mt-2 grid grid-cols-2 gap-0.5 rounded-lg bg-sidebar-accent/50 p-0.5">
          {([['use', 'Use', Play], ['configure', 'Configure', Settings2]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => pick(key)}
              aria-pressed={view === key}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                view === key
                  ? 'bg-sidebar text-sidebar-foreground shadow-sm'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {view === 'use'
          ? (
              // USE — the daily surface, nothing else competing for attention.
              <AppSidebarNav
                label={t('main_section_label')}
                items={[
                  { title: t('chat'), url: '/dashboard/chat', icon: MessageSquare },
                  { title: 'Briefings', url: '/dashboard/briefings', icon: Newspaper },
                  { title: t('review'), url: '/dashboard/review', icon: CheckSquare },
                  { title: 'Activity', url: '/dashboard/activity', icon: Activity },
                  { title: t('search'), url: '/dashboard/search', icon: BookOpen },
                ]}
              />
            )
          : (
              <>
                {/* CONFIGURE — who works for you + the shapes their work takes. */}
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
