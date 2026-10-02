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
        description="Connected systems that feed context into agents + retrieval. Hybrid pgvector search runs over every chunk you ingest."
      />
      <SourcesPanel connectInfo={connectInfo} />
    </>
  );
}
