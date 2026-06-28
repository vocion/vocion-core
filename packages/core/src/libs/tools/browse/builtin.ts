import type { BrowseProvider, Page } from './types';
import { extractFromHtml } from '@/libs/sources/web';

/**
 * Built-in browse provider — no key, no middleman. Reuses the same
 * regex HTML→text extractor as the `web` source connector
 * (`libs/sources/web.ts`). Good for static/server-rendered pages; for
 * JS-heavy pages set VOCION_BROWSE_PROVIDER=firecrawl.
 */
export function builtinBrowseProvider(): BrowseProvider {
  return {
    name: 'builtin',
    requiredEnv: [],
    isReady: () => true,
    async fetchPage(url): Promise<Page | null> {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'VocionBot/0.1 (+https://vocion.ai)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      const contentType = res.headers.get('content-type') ?? '';
      const isHtml = contentType.includes('text/html');
      const raw = await res.text();
      const { title, content } = isHtml ? extractFromHtml(raw) : { title: undefined, content: raw };
      if (!content.trim()) {
        return null;
      }
      return { url, title: title ?? url, content };
    },
  };
}
