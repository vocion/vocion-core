import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { LiveConnectors } from '@/features/dashboard/LiveConnectors';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function ConnectorsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Connectors' });

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <DashboardSection
        title={t('section_active')}
        description={t('section_active_description')}
      >
        <LiveConnectors />
      </DashboardSection>
    </>
  );
}
