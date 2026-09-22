import type { BrowseProvider, Page } from './types';
import { extractFromHtml, USER_AGENT } from '@/libs/sources/web';

/**
 * Built-in browse provider — no key, no middleman. Reuses the same
 * cheerio HTML-to-text extractor as the `web` source connector
 * (`libs/sources/web.ts`), and hands it the fetched URL so hrefs and
 * image sources come back absolute. Good for static/server-rendered
 * pages; for JS-heavy pages set VOCION_BROWSE_PROVIDER=firecrawl.
 */
export function builtinBrowseProvider(): BrowseProvider {
  return {
    name: 'builtin',
    requiredEnv: [],
    isReady: () => true,
    async fetchPage(url): Promise<Page | null> {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      const contentType = res.headers.get('content-type') ?? '';
      const isHtml = contentType.includes('text/html');
      const raw = await res.text();
      const { title, content, structure } = isHtml
        ? extractFromHtml(raw, url)
        : { title: undefined, content: raw, structure: undefined };
      if (!content.trim()) {
        return null;
      }
      // The extractor keeps the og:image out of the text it returns, because
      // that text is hashed to decide a page changed and plenty of sites date
      // that URL. A page read by hand is not hashed, and a reader who asked
      // for the page wants to know what it shows, so it goes back on here.
      const image = structure?.ogImage;
      return { url, title: title ?? url, content: image ? `Image: ${image}\n\n${content}` : content };
    },
  };
}
