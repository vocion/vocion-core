import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DocsFooter } from '@/features/dashboard/DocsFooter';
import { DocsMobileDrawer } from '@/features/dashboard/DocsMobileDrawer';
import { DocsSidebar } from '@/features/dashboard/DocsSidebar';
import { DocsToc } from '@/features/dashboard/DocsToc';
import { DocViewer } from '@/features/dashboard/DocViewer';
import { isInternalPath, listDocs, readDoc } from '@/libs/docs';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';
import { getBaseUrl } from '@/utils/Helpers';

type Props = {
  params: Promise<{ locale: string; slug?: string[] }>;
};

/**
 * Pre-render every public doc URL × every locale at build time.
 *
 * Two benefits: (a) instant TTFB for docs, (b) gives Pagefind a static
 * HTML tree to index in the build step. Marketing docs are pure
 * file-system content — no per-request data — so static rendering is
 * a strict win.
 */
export async function generateStaticParams(): Promise<Array<{ locale: string; slug?: string[] }>> {
  const entries = listDocs({ kind: 'public' });
  const locales = ['en', 'fr'];
  const params: Array<{ locale: string; slug?: string[] }> = [];
  for (const locale of locales) {
    for (const entry of entries) {
      params.push({
        locale,
        slug: entry.slug === '' ? undefined : entry.slug.split('/'),
      });
    }
  }
  return params;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const slugStr = (slug ?? []).join('/');
  const doc = readDoc(slugStr);
  if (!doc || isInternalPath(doc.path)) {
    return { title: 'Docs · Vocion' };
  }

  // Match the same entry-builder logic listDocs uses so title + desc
  // here always agree with the sidebar label.
  const entry = listDocs({ kind: 'public' }).find(e => e.path === doc.path);
  const title = entry?.title ?? doc.frontmatter.title ?? slugStr;
  const description = entry?.description ?? doc.frontmatter.description ?? '';
  const canonical = `${getBaseUrl()}/docs${slugStr === '' ? '' : `/${slugStr}`}`;

  return {
    title: `${title} · Vocion docs`,
    description: description || undefined,
    alternates: { canonical },
    openGraph: {
      title,
      description: description || undefined,
      url: canonical,
      type: 'article',
      siteName: 'Vocion',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: description || undefined,
    },
  };
}

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
  const currentEntry = entries.find(e => e.path === doc.path);

  return (
    <>
      <Navbar />
      <div className="mx-auto flex w-full max-w-[88rem] gap-8 px-6 py-10">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-4rem)] overflow-y-auto pr-2">
            <DocsSidebar entries={entries} currentSlug={currentSlug} publicBasePath="/docs" />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">{doc.path}</span>
            <DocsMobileDrawer entries={entries} currentSlug={currentSlug} publicBasePath="/docs" />
          </div>
          <DocViewer currentPath={doc.path} content={doc.content} linkBase="/docs" />
          {currentEntry && (
            <DocsFooter currentEntry={currentEntry} entries={entries} linkBase="/docs" />
          )}
        </main>
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-4rem)] overflow-y-auto pl-2">
            <DocsToc />
          </div>
        </aside>
      </div>
      <Footer />
    </>
  );
}
