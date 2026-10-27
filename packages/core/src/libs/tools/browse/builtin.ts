import type { BrowseProvider, Page, RawPage } from './types';
import { fetchPublic, readCapped } from '@/libs/net/publicFetch';
import { extractFromHtml, USER_AGENT } from '@/libs/sources/web';

/** The most of one page's HTML read off the wire for SERP research. */
const MAX_HTML_BYTES = 8 * 1024 * 1024;

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
    async fetchHtml(url): Promise<RawPage | null> {
      // Guarded on every hop and capped while read: these URLs come from a
      // search result list, which nobody vetted.
      const { res, finalUrl } = await fetchPublic(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' } });
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType && !/html|xml/i.test(contentType)) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      const html = (await readCapped(res, MAX_HTML_BYTES)).toString('utf8');
      return { url: res.url || finalUrl, html };
    },
  };
}
