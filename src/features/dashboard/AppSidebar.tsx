'use client';

import { OrganizationSwitcher } from '@clerk/nextjs';
import {
  CircleDollarSign,
  CirclePlus,
  Home,
  LifeBuoy,
  Send,
  Settings,
  Users,
} from 'lucide-react';
import { useLocale } from 'next-intl';

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { Logo } from '@/templates/Logo';
import { getI18nPath } from '@/utils/Helpers';

export const AppSidebar = (props: React.ComponentProps<typeof Sidebar>) => {
  const locale = useLocale();

  return (
    <Sidebar {...props}>
      <SidebarHeader className="pt-5">
        <div className="flex justify-center pb-3">
          <Logo />
        </div>

        <OrganizationSwitcher
          organizationProfileMode="navigation"
          organizationProfileUrl={getI18nPath(
            '/dashboard/organization-profile',
            locale,
          )}
          afterCreateOrganizationUrl="/dashboard"
          hidePersonal
          skipInvitationScreen
          appearance={{
            elements: {
              organizationSwitcherTrigger: 'w-64 md:w-60 justify-between',
            },
          }}
        />
      </SidebarHeader>
      <SidebarContent>
        <AppSidebarNav
          label="Main navigation"
          items={[
            {
              title: 'Home',
              url: '/dashboard',
              icon: Home,
            },
            {
              title: 'Todos',
              url: '/dashboard/todos',
              icon: CirclePlus,
            },
          ]}
        />
        <AppSidebarNav
          label="Organization"
          items={[
            {
              title: 'Billing',
              url: '/dashboard/billing',
              icon: CircleDollarSign,
            },
            {
              title: 'Members',
              url: '/dashboard/organization-profile/organization-members',
              icon: Users,
            },
            {
              title: 'Settings',
              url: '/dashboard/organization-profile',
              icon: Settings,
            },
          ]}
        />
        <AppSidebarNav
          items={[
            {
              title: 'Support',
              url: 'mailto:contact@creativedesignsguru.com',
              icon: LifeBuoy,
            },
            {
              title: 'Feedback',
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
