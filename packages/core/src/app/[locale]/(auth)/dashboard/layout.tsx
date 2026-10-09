import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Toaster } from '@/components/ui/toast';
import { AppShell } from '@/features/dashboard/AppShell';
import { brandTitle } from '@/libs/branding/orgBrand';
import { titlePrefix } from '@/libs/envLabel';
import { brandChromeForRequest, brandViewForRequest } from '@/services/branding/OrgBrandService';

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

  // An Org with a brand: its own name in the tab ("Northwind · Vocion"),
  // rather than the product's; pages under it read "<page> · Northwind".
  // Only where the Org leads the install (`libs/branding/chrome.ts`): Vocion
  // Cloud keeps Vocion's own title whichever Org is open.
  const [view, chrome] = await Promise.all([brandViewForRequest().catch(() => null), brandChromeForRequest().catch(() => null)]);
  const brand = chrome?.lead === 'org' ? view : null;
  return {
    title: brand ? { absolute: `${titlePrefix()}${brandTitle(brand.name)}`, template: `${titlePrefix()}%s · ${brand.name}` } : t('meta_title'),
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
