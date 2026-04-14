import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DocsSidebar } from '@/features/dashboard/DocsSidebar';
import { DocViewer } from '@/features/dashboard/DocViewer';
import { isInternalPath, listDocs, readDoc } from '@/libs/docs';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

type Props = {
  params: Promise<{ locale: string; slug?: string[] }>;
};

/**
 * Public docs site — served at /{locale}/docs. Reuses the same DocViewer
 * + DocsSidebar as the in-product authenticated viewer, but filtered to
 * external-only content (hides `docs/internal/`). MetaCTO team members
 * see the full set at /dashboard/docs once signed in.
 * @param props
 */
export default async function PublicDocsPage(props: Props) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);

  const slugStr = (slug ?? []).join('/');
  const doc = readDoc(slugStr);
  // Block direct access to internal paths even if guessed.
  if (!doc || isInternalPath(doc.path)) {
    notFound();
  }

  const entries = listDocs({ publicOnly: true });
  const currentSlug = slugStr === '' ? '' : slugStr;

  return (
    <>
      <Navbar />
      <div className="mx-auto flex w-full max-w-7xl gap-8 px-6 py-10">
        <aside className="w-64 shrink-0">
          <div className="sticky top-6 max-h-[calc(100vh-4rem)] overflow-y-auto pr-2">
            <DocsSidebar entries={entries} currentSlug={currentSlug} publicBasePath="/docs" />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mb-3 font-mono text-xs text-muted-foreground">{doc.path}</div>
          <DocViewer currentPath={doc.path} content={doc.content} linkBase="/docs" />
        </main>
      </div>
      <Footer />
    </>
  );
}
