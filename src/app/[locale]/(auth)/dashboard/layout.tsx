import { getTranslations } from 'next-intl/server';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import { AppSidebarHeader } from '@/features/dashboard/AppSidebarHeader';

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
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppSidebarHeader />

        <div className="flex-1 px-6 pt-4">
          {props.children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export const dynamic = 'force-dynamic';
