import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import { AppSidebarHeader } from '@/features/dashboard/AppSidebarHeader';
import { getTranslations, setRequestLocale } from 'next-intl/server';

type ILayoutProps = {
  params: Promise<{ locale: string }>;
  children: React.ReactNode;
};

export async function generateMetadata(props: ILayoutProps) {
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

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppSidebarHeader />

        <div className="flex-1 px-6 pt-4 @container">
          {props.children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
