'use client';

import {
  Activity,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Compass,
  Database,
  FileText,
  GitBranch,
  LineChart,
  MessageSquare,
  Plug,
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
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { ProjectSwitcher } from '@/features/dashboard/ProjectSwitcher';
import { VocionLogo } from '@/templates/VocionLogo';

/**
 * Dashboard left sidebar — v0.5 IA reorg.
 *
 * Four sections, in order:
 *   1. Workspace — chat, review, search (day-to-day work)
 *   2. Capabilities — sources, objects, operations, workflows, agents,
 *      playbooks, learnings, evals (order matches the /solve marketing
 *      page so the dashboard nav reads as a guided tour of the primitives)
 *   3. Observability — logs + observability traces (promoted from
 *      Workspace; this is "look at what happened" not daily-work)
 *   4. Settings — billing, admin, docs, roadmap (settings + reference;
 *      orphan routes get a home)
 *
 * Active-state styling is driven by `--sidebar-accent` +
 * `--sidebar-accent-foreground` in styles/global.css.
 * @param props
 */
export const AppSidebar = (props: React.ComponentProps<typeof Sidebar>) => {
  const t = useTranslations('DashboardLayout');

  return (
    <Sidebar {...props}>
      <SidebarHeader className="pt-5">
        <div className="flex justify-start px-2 pb-2">
          <VocionLogo size="sm" />
        </div>

        {/* ProjectSwitcher renders only when there's more than one workspace;
            a single-workspace deployment would just repeat the "Workspace"
            section header below it, so it stays hidden. */}
        <ProjectSwitcher />
      </SidebarHeader>

      <SidebarContent>
        {/* 1. Workspace — day-to-day work surfaces. Chat / Review / Search
            are the always-there actions; Workflows + Agents are the
            higher-level "your active work" surfaces (kick off a run, talk
            to an agent), promoted here from Capabilities. */}
        <AppSidebarNav
          label={t('main_section_label')}
          items={[
            { title: t('chat'), url: '/dashboard/chat', icon: MessageSquare },
            { title: 'Missions', url: '/dashboard/missions', icon: Compass },
            { title: t('workflows'), url: '/dashboard/workflows', icon: GitBranch },
            { title: 'Automation', url: '/dashboard/automation', icon: CalendarClock },
            { title: t('agents'), url: '/dashboard/agents', icon: Users },
            { title: t('review'), url: '/dashboard/review', icon: CheckSquare },
            { title: t('search'), url: '/dashboard/search', icon: BookOpen },
          ]}
        />

        {/* 2. Capabilities — the authored primitives. Order mirrors the
            /solve marketing page for "what you build with": data in
            (sources, objects) → typed callable (skills) → memory layer
            (playbooks, learnings, evals). Workflows + Agents moved up
            to Workspace since they're things you USE, not author. */}
        <AppSidebarNav
          label={t('capabilities_section_label')}
          items={[
            { title: t('sources'), url: '/dashboard/sources', icon: Plug },
            { title: t('objects'), url: '/dashboard/objects', icon: Database },
            { title: t('skills'), url: '/dashboard/skills', icon: Zap },
            { title: 'Tools', url: '/dashboard/tools', icon: Wrench },
            { title: t('playbooks'), url: '/dashboard/playbooks', icon: ScrollText },
            { title: t('learnings'), url: '/dashboard/learnings', icon: Sparkles },
            { title: t('evals'), url: '/dashboard/evals', icon: TestTube },
          ]}
        />

        {/* 3. Observability — see what happened */}
        <AppSidebarNav
          label={t('observability_section_label')}
          items={[
            { title: t('logs'), url: '/dashboard/logs', icon: Activity },
            { title: t('observability'), url: '/dashboard/observability', icon: LineChart },
          ]}
        />

        {/* 4. Settings. Members replaced Billing in the nav (billing page
            stays routable at /dashboard/billing, it's just not something a
            single-tenant deploy needs front-and-center). "System" is the
            old Admin link — same status page, clearer name. Docs points at
            the PUBLIC docs site — the in-app viewer rendered repo-internal
            docs that go stale between image builds. */}
        <AppSidebarNav
          label={t('settings_section_label')}
          items={[
            { title: 'Members', url: '/dashboard/members', icon: UserPlus },
            { title: 'System', url: '/dashboard/admin', icon: ShieldCheck },
            { title: t('docs'), url: 'https://www.vocion.ai/docs', icon: FileText },
          ]}
        />
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
