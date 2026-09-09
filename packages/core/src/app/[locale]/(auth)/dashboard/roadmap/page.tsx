import { setRequestLocale } from 'next-intl/server';
import { DocsSidebar } from '@/features/dashboard/DocsSidebar';
import { DocViewer } from '@/features/dashboard/DocViewer';
import { listDocs, readDoc } from '@/libs/docs';

const DEFAULT_SLUG = 'docs/internal/roadmap';

export default async function RoadmapPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  const doc = readDoc(DEFAULT_SLUG);
  const entries = listDocs({ kind: 'roadmap' });

  // `docs/internal/` is MetaCTO-only and is NOT distributed with this public
  // repo (see .gitignore). A checkout without it still renders this route —
  // an empty roadmap is the honest state, not a 404 that reads like a bug.
  if (!doc) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <h1 className="font-display text-lg font-semibold">Roadmap not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Internal planning docs live outside this repository. Add
          {' '}
          <code className="font-mono text-xs">docs/internal/</code>
          {' '}
          to this checkout to read them here.
        </p>
      </div>
    );
  }

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
