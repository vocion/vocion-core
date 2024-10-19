import { UserButton } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { AppSidebar } from '@/components/app-sidebar';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Dashboard',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default function DashboardLayout(props: { children: React.ReactNode }) {
  const t = useTranslations('DashboardLayout');

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden lg:block">
                  <BreadcrumbLink href="#">
                    Building Your Application
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden lg:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Data Fetching</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <ul className="flex items-center gap-x-1.5 [&_li:not(:last-child):hover]:opacity-100 [&_li:not(:last-child)]:opacity-60">
            <li>
              <DarkModeToggle />
            </li>

            <li>
              <LocaleSwitcher />
            </li>

            <li>
              <UserButton
                userProfileMode="navigation"
                userProfileUrl="/dashboard/user-profile"
                appearance={{
                  elements: {
                    rootBox: 'px-2 py-1.5',
                  },
                }}
              />
            </li>
          </ul>
        </header>

        <div className="px-6 pt-4">
          {props.children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export const dynamic = 'force-dynamic';
