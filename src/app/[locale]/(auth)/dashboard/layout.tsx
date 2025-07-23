import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import { AppSidebarHeader } from '@/features/dashboard/AppSidebarHeader';
import { AppConfig } from '@/utils/AppConfig';

type ILayoutProps = {
  params: Promise<{ locale: string }>;
  children: React.ReactNode;
};

export async function generateMetadata(props: ILayoutProps): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({
    locale,
    namespace: 'Dashboard',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function DashboardLayout(props: ILayoutProps) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  // Get the persisted sidebar state from the cookie
  const cookieStore = await cookies();
  // If the cookie is not set, default to open
  const defaultOpen = cookieStore.get(AppConfig.sidebarCookieName)?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <AppSidebarHeader />

        <div className="@container flex-1 px-6 py-4">
          {props.children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
