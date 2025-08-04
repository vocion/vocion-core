'use client';

import { OrganizationSwitcher } from '@clerk/nextjs';
import { CirclePlus, CreditCard, Home, LifeBuoy, Send, Settings, Users } from 'lucide-react';
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
                // WORKAROUND: conflict with Shadcn Sidebar, solution from https://github.com/clerk/javascript/issues/3739
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
              title: t('home'),
              url: '/dashboard',
              icon: Home,
            },
            {
              title: t('todos'),
              url: '/dashboard/todos',
              icon: CirclePlus,
            },
          ]}
        />
        <AppSidebarNav
          label={t('organization_section_label')}
          items={[
            {
              title: t('billing'),
              url: '/dashboard/billing',
              icon: CreditCard,
            },
            {
              title: t('members'),
              url: '/dashboard/organization-profile/organization-members',
              icon: Users,
            },
            {
              title: t('settings'),
              url: '/dashboard/organization-profile',
              icon: Settings,
            },
          ]}
        />
        <AppSidebarNav
          items={[
            {
              title: t('support'),
              url: 'mailto:contact@creativedesignsguru.com',
              icon: LifeBuoy,
            },
            {
              title: t('feedback'),
              url: 'mailto:contact@creativedesignsguru.com',
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
