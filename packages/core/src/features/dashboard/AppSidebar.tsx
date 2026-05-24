'use client';

import { ProjectSwitcher } from '@/features/dashboard/ProjectSwitcher';
import {
  Activity,
  BookOpen,
  Bot,
  Boxes,
  CheckSquare,
  Database,
  FileText,
  GitBranch,
  LineChart,
  MessageSquare,
  Plug,
  ScrollText,
  Settings,
  Sparkles,
  TestTube,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { VocionLogo } from '@/templates/VocionLogo';

/**
 * Dashboard left sidebar — v0.3 rev-ai-style restructure.
 *
 * Four sections, in order:
 *   1. Workspace — chat, review, search, logs (day-to-day work)
 *   2. Capabilities — agents, operations, playbooks, learnings, evals,
 *      workflows, objects, sources, docs (everything authored as code)
 *   3. Agents — server-loaded list of agent rows with per-agent accent
 *      left-border (placeholder hardcoded today; Phase C wires the real
 *      `agents.list` server fetch + per-agent recent-conversations).
 *   4. Settings — billing, organization, members
 *
 * Active-state styling is driven by `--sidebar-accent` + `--sidebar-accent-foreground`
 * in styles/global.css — those now map to brand amber. No per-item
 * styling needed in this file.
 * @param props
 */
export const AppSidebar = (props: React.ComponentProps<typeof Sidebar>) => {
  const t = useTranslations('DashboardLayout');

  return (
    <Sidebar {...props}>
      <SidebarHeader className="pt-5">
        <div className="flex justify-center pb-3">
          <VocionLogo size="sm" />
        </div>

        <ProjectSwitcher />
      </SidebarHeader>

      <SidebarContent>
        {/* 1. Workspace — day-to-day work */}
        <AppSidebarNav
          label={t('main_section_label')}
          items={[
            { title: t('chat'), url: '/dashboard/chat', icon: MessageSquare },
            { title: t('review'), url: '/dashboard/review', icon: CheckSquare },
            { title: t('search'), url: '/dashboard/search', icon: BookOpen },
            { title: t('logs'), url: '/dashboard/logs', icon: Activity },
            { title: t('observability'), url: '/dashboard/observability', icon: LineChart },
          ]}
        />

        {/* 2. Capabilities — everything authored as code */}
        <AppSidebarNav
          label={t('capabilities_section_label')}
          items={[
            { title: 'Agents', url: '/dashboard/agents', icon: Bot },
            { title: t('operations'), url: '/dashboard/skills', icon: Zap },
            { title: t('playbooks'), url: '/dashboard/playbooks', icon: ScrollText, disabled: true },
            { title: t('learnings'), url: '/dashboard/learnings', icon: Sparkles, disabled: true },
            { title: t('evals'), url: '/dashboard/evals', icon: TestTube, disabled: true },
            { title: t('workflows'), url: '/dashboard/workflows', icon: GitBranch },
            { title: t('objects'), url: '/dashboard/objects', icon: Database },
            { title: t('connectors'), url: '/dashboard/sources', icon: Plug },
            { title: t('docs'), url: '/dashboard/docs', icon: FileText },
          ]}
        />

        {/* 3. Agents — placeholder for Phase C server-loaded list */}
        <AppSidebarNav
          label={t('agents_section_label')}
          items={[
            { title: t('ziggy'), url: '/dashboard/chat', icon: Boxes },
          ]}
        />

        {/* 4. Settings */}
        <AppSidebarNav
          label={t('settings_section_label')}
          items={[
            { title: t('billing'), url: '/dashboard/billing', icon: Settings },
          ]}
        />
      </SidebarContent>

      <SidebarFooter className="px-4 pb-3 text-[11px] text-muted-foreground/70">
        <div>
          ©
          {' '}
          {new Date().getFullYear()}
          {' '}
          Vocion · Apache 2.0
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};
