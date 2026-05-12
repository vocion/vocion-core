import type { MetadataRoute } from 'next';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { listDocs } from '@/libs/docs';
import { routing } from '@/libs/I18nRouting';
import { getRepoRoot } from '@/libs/repo-root';
import { getBaseUrl, getI18nPath } from '@/utils/Helpers';

const ROOT = getRepoRoot();

function mtimeFor(rel: string): Date {
  try {
    return statSync(join(ROOT, rel)).mtime;
  } catch {
    return new Date();
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();

  // Marketing top-level routes get locale alternates; doc URLs are
  // English-only so we emit them without alternates to avoid signaling
  // duplicate content to crawlers.
  const marketingRoutes = [''];
  const marketing = marketingRoutes.map(route => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    alternates: {
      languages: Object.fromEntries(
        routing.locales
          .filter(locale => locale !== routing.defaultLocale)
          .map(locale => [locale, `${baseUrl}${getI18nPath(route, locale)}`]),
      ),
    },
  }));

  // Public docs corpus — every entry in libs/docs.ts public set gets a
  // URL. The marketing /docs/[[...slug]]/page.tsx route renders
  // these. Slug shape: `/docs/<doc.slug>` (e.g. `/docs/docs/concepts/agents`).
  const docs = listDocs({ kind: 'public' }).map(doc => ({
    url: doc.slug === ''
      ? `${baseUrl}/docs`
      : `${baseUrl}/docs/${doc.slug}`,
    lastModified: mtimeFor(doc.path),
  }));

  return [...marketing, ...docs];
}
