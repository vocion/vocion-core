/**
 * Web URL connector — fetch one or more URLs and ingest them as
 * documents. Zero auth, intentionally minimal so it ships as the
 * first working connector before the heavier OAuth ones (Drive,
 * GitHub) land in M.1.
 *
 * Supported config:
 *   - `urls: string[]` — explicit list to fetch
 *   - `crawl: { startUrl, maxDepth?, maxPages? }` — same-origin BFS
 *
 * HTML → plain text is done with a regex-based stripper. It's not
 * perfect; pages with heavy JS-rendered content will look thin. The
 * follow-up is a headless-browser variant — punted until users
 * actually ask for it.
 */

import type { IngestDoc } from '@/services/IngestionService';
import type { SourceConnector, SourceContext } from './types';
import { z } from 'zod';

const webConfigSchema = z.object({
  urls: z.array(z.string().url()).optional(),
  crawl: z
    .object({
      startUrl: z.string().url(),
      maxDepth: z.number().int().min(0).max(3).default(1),
      maxPages: z.number().int().min(1).max(200).default(50),
    })
    .optional(),
}).refine(c => c.urls?.length || c.crawl, {
  message: 'Provide either `urls` or `crawl`.',
});

export const webConnector: SourceConnector<typeof webConfigSchema> = {
  slug: 'web',
  name: 'Web URL',
  description: 'Crawl a list of public URLs or a single site (same-origin BFS, capped depth + page count).',
  icon: 'Globe',
  authKind: 'none',
  configSchema: webConfigSchema,
  async *sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = webConfigSchema.parse(ctx.config);
    if (cfg.urls?.length) {
      for (const url of cfg.urls) {
        const doc = await fetchAsDoc(url, ctx);
        if (doc) {
          yield doc;
        }
      }
      return;
    }
    if (cfg.crawl) {
      yield* crawl(cfg.crawl, ctx);
    }
  },
};

/* ------------------------------------------------------------------ */
/* fetch + extract                                                     */
/* ------------------------------------------------------------------ */

async function fetchAsDoc(url: string, ctx: SourceContext): Promise<IngestDoc | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VocionBot/0.1 (+https://vocion.ai)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      ctx.onProgress?.({ kind: 'error', uri: url, message: `HTTP ${res.status}` });
      return null;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const isHtml = contentType.includes('text/html');
    const isPlain = contentType.startsWith('text/') || contentType.includes('application/json') || contentType.includes('application/xml');
    if (!isHtml && !isPlain) {
      ctx.onProgress?.({ kind: 'skipped', uri: url, message: `unsupported content-type: ${contentType}` });
      return null;
    }
    const raw = await res.text();
    const { title, content } = isHtml ? extractFromHtml(raw) : { title: undefined, content: raw };
    if (!content.trim()) {
      ctx.onProgress?.({ kind: 'skipped', uri: url, message: 'empty after extraction' });
      return null;
    }
    ctx.onProgress?.({ kind: 'fetched', uri: url });
    const etag = res.headers.get('etag');
    const lastModifiedHeader = res.headers.get('last-modified');
    return {
      externalId: url,
      uri: url,
      title: title ?? url,
      content,
      etag: etag ?? null,
      lastModifiedAt: lastModifiedHeader ? new Date(lastModifiedHeader) : null,
      metadata: { contentType },
    };
  } catch (err) {
    ctx.onProgress?.({ kind: 'error', uri: url, message: (err as Error).message });
    return null;
  }
}

/**
 * Strip HTML to plain text. Deletes script/style/nav blocks, extracts
 * the page title, then collapses tags + whitespace.
 *
 * The heuristic is intentionally simple — a full DOM-based extractor
 * (Readability.js, mozilla-readability) would do better on news/blog
 * articles, but it adds 600KB of JS and a JSDOM dep. Revisit when a
 * user complains about a specific bad extraction.
 */
function extractFromHtml(html: string): { title?: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim();
  // Drop the things we never want to ingest.
  let body = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // Preserve paragraph breaks so chunker boundaries land on sentences.
  body = body
    .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  // HTML entities most likely to appear in plain prose.
  body = body
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'');
  const content = body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { title, content };
}

/* ------------------------------------------------------------------ */
/* same-origin BFS crawler                                             */
/* ------------------------------------------------------------------ */

async function* crawl(
  cfg: { startUrl: string; maxDepth: number; maxPages: number },
  ctx: SourceContext,
): AsyncIterable<IngestDoc> {
  const startOrigin = new URL(cfg.startUrl).origin;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: cfg.startUrl, depth: 0 }];
  let fetched = 0;
  while (queue.length && fetched < cfg.maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) {
      continue;
    }
    visited.add(url);
    const doc = await fetchAsDoc(url, ctx);
    if (!doc) {
      continue;
    }
    fetched += 1;
    yield doc;
    if (depth < cfg.maxDepth) {
      const html = await fetch(url, { signal: AbortSignal.timeout(10_000) }).then(r => r.text()).catch(() => '');
      for (const href of extractLinks(html, url)) {
        try {
          const u = new URL(href, url);
          if (u.origin === startOrigin && !visited.has(u.toString())) {
            // Strip fragments so #section links don't blow up the queue.
            u.hash = '';
            queue.push({ url: u.toString(), depth: depth + 1 });
          }
        } catch {
          /* malformed href — skip */
        }
      }
    }
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(html)) !== null) {
    const href = match[1]!.trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('javascript:') || href.startsWith('#')) {
      continue;
    }
    try {
      out.push(new URL(href, baseUrl).toString());
    } catch {
      /* skip */
    }
  }
  return out;
}
