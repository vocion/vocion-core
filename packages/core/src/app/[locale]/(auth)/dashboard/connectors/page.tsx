import { setRequestLocale } from 'next-intl/server';
import { SourcesPanel } from '@/features/dashboard/SourcesPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { connectInfoForOrg } from '@/services/connect/connectInfo';

export default async function ConnectorsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const connectInfo = orgId ? await connectInfoForOrg(orgId) : {};

  return (
    <>
      <TitleBar
        title="Connectors"
        description="The systems your agents and search read from."
      />
      <SourcesPanel connectInfo={connectInfo} />
    </>
  );
}
