import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DocsFooter } from '@/features/dashboard/DocsFooter';
import { DocsSidebar } from '@/features/dashboard/DocsSidebar';
import { DocsToc } from '@/features/dashboard/DocsToc';
import { DocViewer } from '@/features/dashboard/DocViewer';
import { isRoadmapPath, listDocs, readDoc } from '@/libs/docs';

type Props = {
  params: Promise<{ locale: string; slug?: string[] }>;
};

/**
 * In-app Docs viewer — public dev-consumable docs only. Internal/strategy
 * material (roadmap, progress, case studies, requirements specs) is shown
 * in the separate /dashboard/roadmap viewer.
 * @param props
 */
export default async function DocsPage(props: Props) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);

  const slugStr = (slug ?? []).join('/');
  const doc = readDoc(slugStr);
  // Block roadmap content from leaking into the public docs viewer even by direct URL.
  if (!doc || isRoadmapPath(doc.path)) {
    notFound();
  }

  const entries = listDocs({ kind: 'public' });
  const currentSlug = slugStr === '' ? '' : slugStr;
  const currentEntry = entries.find(e => e.path === doc.path);

  return (
    <div className="flex h-full gap-6 p-6">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-border pr-4">
        <DocsSidebar entries={entries} currentSlug={currentSlug} />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mb-3 font-mono text-xs text-muted-foreground">{doc.path}</div>
        <DocViewer currentPath={doc.path} content={doc.content} />
        {currentEntry && (
          <DocsFooter currentEntry={currentEntry} entries={entries} linkBase="/dashboard/docs" />
        )}
      </main>
      <aside className="hidden w-56 shrink-0 overflow-y-auto pl-2 xl:block">
        <DocsToc />
      </aside>
    </div>
  );
}
