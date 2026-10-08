import { setRequestLocale } from 'next-intl/server';
import { SystemStatus } from '@/features/dashboard/SystemStatus';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ExtensionSlot } from '@/features/extensions/ExtensionSlot';
import { slotComponents } from '@/libs/extensions';

export default async function AdminPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <TitleBar
        title="System"
        description="Infrastructure health, service heartbeats, and platform links"
        actions={slotComponents('system.actions').length > 0 ? <ExtensionSlot name="system.actions" locale={locale} /> : undefined}
      />
      <SystemStatus />
    </>
  );
}
