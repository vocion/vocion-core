import { setRequestLocale } from 'next-intl/server';
import { SystemStatus } from '@/features/dashboard/SystemStatus';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function AdminPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <TitleBar
        title="System Status"
        description="Infrastructure health, service heartbeats, and platform links"
      />
      <SystemStatus />
    </>
  );
}
