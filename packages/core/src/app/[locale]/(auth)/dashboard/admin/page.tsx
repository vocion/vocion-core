import { setRequestLocale } from 'next-intl/server';
import { SystemStatus } from '@/features/dashboard/SystemStatus';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ExtensionSlot } from '@/features/extensions/ExtensionSlot';
import { JevRoutingSection } from '@/features/routing/JevRoutingSection';
import { slotComponents } from '@/libs/extensions';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

export default async function AdminPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, has } = await requireOrganization();

  return (
    <>
      <TitleBar
        title="System"
        description="Infrastructure health, service heartbeats, and platform links"
        actions={slotComponents('system.actions').length > 0 ? <ExtensionSlot name="system.actions" locale={locale} /> : undefined}
      />
      <SystemStatus />
      <div className="mt-8">
        <JevRoutingSection scope="instance" orgId={orgId} isAdmin={has({ role: ORG_ROLE.ADMIN })} />
      </div>
    </>
  );
}
