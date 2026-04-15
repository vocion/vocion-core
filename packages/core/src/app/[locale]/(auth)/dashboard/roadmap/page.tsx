import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DocsSidebar } from '@/features/dashboard/DocsSidebar';
import { DocViewer } from '@/features/dashboard/DocViewer';
import { listDocs, readDoc } from '@/libs/docs';

const DEFAULT_SLUG = 'docs/internal/roadmap';

export default async function RoadmapPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  const doc = readDoc(DEFAULT_SLUG);
  if (!doc) {
    notFound();
  }

  const entries = listDocs({ kind: 'roadmap' });

  return (
    <div className="flex h-full gap-6 p-6">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-border pr-4">
        <DocsSidebar entries={entries} currentSlug={DEFAULT_SLUG} publicBasePath="/dashboard/roadmap" />
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mb-3 font-mono text-xs text-muted-foreground">{doc.path}</div>
        <DocViewer currentPath={doc.path} content={doc.content} linkBase="/dashboard/roadmap" />
      </main>
    </div>
  );
}
