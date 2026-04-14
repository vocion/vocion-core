'use client';

import { OrganizationSwitcher } from '@clerk/nextjs';
import {
  Activity,
  BookOpen,
  Bot,
  CheckSquare,
  CreditCard,
  Database,
  GitBranch,
  HeartPulse,
  Home,
  Layers,
  LifeBuoy,
  MessageSquare,
  Plug,
  Send,
  Settings,
  Users,
  Zap,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { Logo } from '@/templates/Logo';
import { getI18nPath } from '@/utils/Helpers';

export const AppSidebar = (props: React.ComponentProps<typeof Sidebar>) => {
  const locale = useLocale();
  const t = useTranslations('DashboardLayout');

  return (
    <Sidebar {...props}>
      <SidebarHeader className="pt-5">
        <div className="flex justify-center pb-3">
          <Logo />
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
              title: t('skills'),
              url: '/dashboard/skills',
              icon: Zap,
            },
            {
              title: t('workflows'),
              url: '/dashboard/runs',
              icon: GitBranch,
            },
            {
              title: 'Review Queue',
              url: '/dashboard/review',
              icon: CheckSquare,
            },
          ]}
        />
        <AppSidebarNav
          label={t('agents_section_label')}
          items={[
            {
              title: t('ziggy'),
              url: '/dashboard/ziggy',
              icon: Bot,
            },
          ]}
        />
        <AppSidebarNav
          label={t('context_section_label')}
          items={[
            {
              title: t('connectors'),
              url: '/dashboard/connectors',
              icon: Plug,
            },
            {
              title: t('objects'),
              url: '/dashboard/objects',
              icon: Database,
            },
            {
              title: t('domains'),
              url: '/dashboard/domains',
              icon: Layers,
            },
          ]}
        />
        <AppSidebarNav
          label={t('organization_section_label')}
          items={[
            {
              title: t('members'),
              url: '/dashboard/organization-profile/organization-members',
              icon: Users,
            },
            {
              title: t('home'),
              url: '/dashboard',
              icon: Home,
            },
            {
              title: t('audit'),
              url: '/dashboard/audit',
              icon: Activity,
            },
            {
              title: t('billing'),
              url: '/dashboard/billing',
              icon: CreditCard,
            },
            {
              title: t('settings'),
              url: '/dashboard/organization-profile',
              icon: Settings,
            },
            {
              title: 'System Status',
              url: '/dashboard/admin',
              icon: HeartPulse,
            },
          ]}
        />
        <AppSidebarNav
          items={[
            {
              title: 'Docs',
              url: '/dashboard/docs',
              icon: BookOpen,
            },
            {
              title: t('support'),
              url: 'mailto:support@corecontext.com',
              icon: LifeBuoy,
            },
            {
              title: t('feedback'),
              url: 'mailto:feedback@corecontext.com',
              icon: Send,
            },
          ]}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
};
