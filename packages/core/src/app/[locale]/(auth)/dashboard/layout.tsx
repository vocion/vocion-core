import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Toaster } from '@/components/ui/toast';
import { AppShell } from '@/features/dashboard/AppShell';

type DashboardLayoutProps = {
  params: Promise<{ locale: string }>;
  children: React.ReactNode;
};

export async function generateMetadata(props: DashboardLayoutProps): Promise<Metadata> {
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

export default async function DashboardLayout(props: DashboardLayoutProps) {
  const { locale } = await props.params;

  return (
    <>
      <AppShell locale={locale}>{props.children}</AppShell>
      {/* The global toast queue — one mount for every dashboard page. */}
      <Toaster />
    </>
  );
}
