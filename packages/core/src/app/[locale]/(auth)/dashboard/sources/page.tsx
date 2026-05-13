import { setRequestLocale } from 'next-intl/server';
import { SourcesPanel } from '@/features/dashboard/SourcesPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function SourcesPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <TitleBar
        title="Sources"
        description="Connected systems that feed context into agents + retrieval. Hybrid pgvector search runs over every chunk you ingest."
      />
      <SourcesPanel />
    </>
  );
}
