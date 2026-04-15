'use client';

import { OrganizationSwitcher } from '@clerk/nextjs';
import {
  BookOpen,
  Bot,
  CheckSquare,
  Database,
  GitBranch,
  MessageSquare,
  Plug,
  Zap,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { VocionLogo } from '@/templates/VocionLogo';
import { getI18nPath } from '@/utils/Helpers';

export const AppSidebar = (props: React.ComponentProps<typeof Sidebar>) => {
  const locale = useLocale();
  const t = useTranslations('DashboardLayout');

  return (
    <Sidebar {...props}>
      <SidebarHeader className="pt-5">
        <div className="flex justify-center pb-3">
          <VocionLogo size="sm" />
        </div>

        <OrganizationSwitcher
          organizationProfileMode="navigation"
          organizationProfileUrl={getI18nPath('/dashboard/organization-profile', locale)}
          afterCreateOrganizationUrl="/onboarding/organization-selection"
          hideSlug
          hidePersonal
          skipInvitationScreen
          appearance={{
            elements: {
              organizationSwitcherTrigger: 'w-64 md:w-60 justify-between',
              organizationSwitcherPopoverRootBox: {
                pointerEvents: 'auto',
              },
            },
          }}
        />
      </SidebarHeader>
      <SidebarContent>
        <AppSidebarNav
          label={t('main_section_label')}
          items={[
            {
              title: t('chat'),
              url: '/dashboard/chat',
              icon: MessageSquare,
            },
            {
              title: 'Search',
              url: '/dashboard/search',
              icon: BookOpen,
            },
            {
              title: 'Reviews',
              url: '/dashboard/review',
              icon: CheckSquare,
            },
          ]}
        />
        <AppSidebarNav
          label={t('context_section_label')}
          items={[
            {
              title: 'Agents',
              url: '/dashboard/agents',
              icon: Bot,
            },
            {
              title: t('skills'),
              url: '/dashboard/skills',
              icon: Zap,
            },
            {
              title: t('workflows'),
              url: '/dashboard/workflows',
              icon: GitBranch,
            },
            {
              title: t('objects'),
              url: '/dashboard/objects',
              icon: Database,
            },
            {
              title: t('connectors'),
              url: '/dashboard/sources',
              icon: Plug,
            },
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
