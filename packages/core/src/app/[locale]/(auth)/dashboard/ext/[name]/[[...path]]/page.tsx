import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { extensionPage } from '@/libs/extensions';

/**
 * A page an extension serves (`libs/extensions.ts`, `pages`):
 * `/dashboard/ext/<name>/<...path>` renders the page registered under `<name>`
 * with the rest of the path and the query. No extension serves `<name>`, or
 * none is built in: 404, as for any page that does not exist. The page decides
 * for itself who may see it.
 * @param props - The route's params and query.
 * @param props.params - Locale, the page's name and the path under it.
 * @param props.searchParams - The query.
 */
export default async function ExtensionPage(props: {
  params: Promise<{ locale: string; name: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, name, path } = await props.params;
  setRequestLocale(locale);
  const render = extensionPage(name);
  if (!render) {
    notFound();
  }
  // Called rather than mounted: the page is the extension's function of the
  // path and query, and may be async.
  return render({ path: path ?? [], searchParams: await props.searchParams });
}
