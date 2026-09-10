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
 * HTML to text is done with cheerio: the chrome (scripts, nav, footer,
 * cookie bars) comes out, and links, images, <time> stamps and JSON-LD
 * stay in. Pages that build their body client-side still look thin. The
 * follow-up is a headless-browser variant, punted until users actually
 * ask for it.
 */

import type { CheerioAPI } from 'cheerio';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { load } from 'cheerio';
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
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
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
    const { title, content } = isHtml ? extractFromHtml(raw, url) : { title: undefined, content: raw };
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

/* ------------------------------------------------------------------ */
/* HTML to text                                                        */
/* ------------------------------------------------------------------ */

/** Page chrome we never want in ingested text. */
const CHROME_SELECTOR = 'script, style, noscript, nav, header, footer, aside, template, svg';

/**
 * Class and id fragments that mark chrome the tag name alone does not catch:
 * cookie bars, menus, share widgets, breadcrumbs.
 */
const BOILERPLATE_ATTR = /cookie|consent|menu|navbar|share|social|breadcrumb|skip-link/i;

/**
 * Where an image's real URL can live, in the order we trust them. `src` first,
 * then the attributes lazy-loading themes use when `src` holds a placeholder.
 */
const LAZY_SRC_ATTRS = ['src', 'data-src', 'data-lazy-src', 'data-original'] as const;

/** Elements that hold the page's own content, whatever their class or id says. */
const CONTENT_LANDMARKS = new Set(['html', 'body', 'main', 'article']);

/** Closing one of these ended a paragraph in the old stripper, and still does. */
const BLOCK_SELECTOR = 'p, div, section, article, li, h1, h2, h3, h4, h5, h6';

/**
 * Sentinels for the two kinds of break we add on purpose, so the whitespace
 * pass can flatten the newlines that merely came from the source markup
 * without flattening ours. They are private-use code points, which no real
 * page has any business containing, and they are scrubbed out of the input
 * first so a page cannot smuggle one in either.
 */
const PARAGRAPH_MARK = '\uE000';
const LINE_MARK = '\uE001';
const OWN_MARKS = /[\uE000\uE001]/g;
const PARAGRAPH_MARK_RE = / ?\uE000 ?/g;
const LINE_MARK_RE = / ?\uE001 ?/g;

/** JSON-LD can run to megabytes on a big listing page, so it gets a budget. */
const JSON_LD_CHAR_CAP = 20_000;
const JSON_LD_HEADING = 'Structured data (JSON-LD):';
const JSON_LD_TRUNCATED = '[structured data truncated]';

/**
 * Turn a page into the text we ingest: an `Image:` header line when the page
 * declares an og:image, the readable text with links, images and machine
 * readable dates kept inline, then the page's JSON-LD verbatim.
 *
 * This used to be a stack of regexes that deleted every tag, which threw away
 * exactly the parts a downstream event card needs: the JSON-LD block (image,
 * address, price, ticket URL) went out with the other scripts, and a listing
 * page lost the links to its own detail pages. cheerio parses the page
 * properly instead, so we can drop the chrome and keep the facts.
 * @param html - raw HTML as fetched
 * @param baseUrl - the URL the HTML came from, used to make hrefs and image
 * sources absolute. Relative URLs are left as written when it is omitted.
 */
export function extractFromHtml(html: string, baseUrl?: string): { title?: string; content: string } {
  const $ = load(html.replace(OWN_MARKS, ' '));

  // Read the metadata before the chrome comes out: on plenty of pages the
  // only h1 is the one sitting in the site header.
  const title = pageTitle($);
  const image = absoluteUrl(metaContent($, 'og:image'), baseUrl);
  const structured = structuredData($);

  $(CHROME_SELECTOR).remove();
  removeBoilerplate($);

  // A URL is worth reading once. Menus and card grids repeat the same href or
  // the same image a dozen times a page, and the og:image is usually the same
  // file as the hero image in the body.
  const renderedImages = new Set<string>(image ? [image] : []);
  const renderedLinks = new Set<string>();
  renderImages($, baseUrl, renderedImages);
  renderTimes($);
  renderLinks($, baseUrl, renderedLinks);
  markBreaks($);

  const text = collapse($('body').text());
  const parts: string[] = [];
  if (image) {
    parts.push(`Image: ${image}`);
  }
  if (text) {
    parts.push(text);
  }
  if (structured) {
    parts.push(`${JSON_LD_HEADING}\n${structured}`);
  }
  // An image on its own is not content. Both callers read empty content as
  // "nothing here" and skip the page, which is still the right call.
  return { title, content: text || structured ? parts.join('\n\n') : '' };
}

/**
 * <title>, then og:title, then the first h1.
 * @param $ - the parsed page
 */
function pageTitle($: CheerioAPI): string | undefined {
  for (const candidate of [$('title').first().text(), metaContent($, 'og:title') ?? '', $('h1').first().text()]) {
    const flattened = candidate.replace(/\s+/g, ' ').trim();
    if (flattened) {
      return flattened;
    }
  }
  return undefined;
}

/**
 * Read one meta tag's content. Both spellings are in the wild: og: tags are
 * supposed to use `property`, and plenty of sites use `name` anyway.
 * @param $ - the parsed page
 * @param key - the lowercased property or name to look for
 */
function metaContent($: CheerioAPI, key: string): string | undefined {
  let found: string | undefined;
  $('meta').each((_i, el) => {
    if (found !== undefined) {
      return;
    }
    const $el = $(el);
    const attr = ($el.attr('property') ?? $el.attr('name') ?? '').toLowerCase();
    const content = $el.attr('content')?.trim();
    if (attr === key && content) {
      found = content;
    }
  });
  return found;
}

/**
 * Resolve a URL found in the page against the page's own URL.
 * @param raw - the href or src as written in the markup
 * @param baseUrl - the page URL, when the caller knows it
 */
function absoluteUrl(raw: string | undefined, baseUrl?: string): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  if (!baseUrl) {
    return value;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

/**
 * Re-serialise every JSON-LD block as one compact line. Every schema.org
 * type is kept, not just Event: this is a generic engine, and a workspace
 * that cares about recipes or job postings has as much claim on its own
 * structured data as an events workspace has on its own.
 * @param $ - the parsed page, still holding its scripts
 */
function structuredData($: CheerioAPI): string {
  const blocks: string[] = [];
  $('script').each((_i, el) => {
    if (!($(el).attr('type') ?? '').toLowerCase().includes('ld+json')) {
      return;
    }
    const raw = $(el).text().trim();
    if (!raw) {
      return;
    }
    try {
      blocks.push(JSON.stringify(JSON.parse(raw)));
    } catch {
      // Plenty of sites ship JSON-LD that does not parse. Dropping the block
      // beats failing the page over it.
    }
  });
  if (!blocks.length) {
    return '';
  }
  const kept: string[] = [];
  let budget = JSON_LD_CHAR_CAP;
  let truncated = false;
  for (const block of blocks) {
    if (block.length <= budget) {
      kept.push(block);
      budget -= block.length + 1;
      continue;
    }
    // Keep the head of the block that overflows. Name, dates and address sit
    // near the front of a schema.org object, and a marked cut at least tells
    // the reader that something is missing.
    if (budget > 0) {
      kept.push(block.slice(0, budget));
    }
    truncated = true;
    break;
  }
  return truncated ? `${kept.join('\n')}\n${JSON_LD_TRUNCATED}`.trim() : kept.join('\n');
}

function removeBoilerplate($: CheerioAPI): void {
  const pageLength = $('body').text().length;
  $('[class], [id]').each((_i, el) => {
    const $el = $(el);
    if (!BOILERPLATE_ATTR.test(`${$el.attr('class') ?? ''} ${$el.attr('id') ?? ''}`)) {
      return;
    }
    // A widget called "share" or "menu" is chrome. A landmark, or anything
    // holding most of the page's text, is the page. WordPress calls its own
    // <main> element `wp--skip-link--target`, so without this the pattern
    // above deletes the entire body of every show page on a WordPress site.
    if (CONTENT_LANDMARKS.has(el.tagName) || $el.text().length * 2 > pageLength) {
      return;
    }
    $el.remove();
  });
}

/**
 * Replace each image with `[image: alt](src)`.
 * @param $ - the parsed page
 * @param baseUrl - the page URL, when the caller knows it
 * @param rendered - srcs already spoken for, added to as we go
 */
function renderImages($: CheerioAPI, baseUrl: string | undefined, rendered: Set<string>): void {
  $('img').each((_i, el) => {
    const $el = $(el);
    // A lazy-loading theme puts a placeholder in `src` and the real file in a
    // data attribute, so the first usable candidate wins. Higher Ground does
    // this on every card: 91 of the 97 images on one show page carry a
    // one-pixel data: URI in `src` and the real JPEG in `data-src`.
    const raw = LAZY_SRC_ATTRS
      .map(attr => $el.attr(attr)?.trim())
      .find(value => value && !value.startsWith('data:'));
    // A 1px image is a tracking pixel. It tells the reader nothing.
    const isNoise = !raw || $el.attr('width') === '1' || $el.attr('height') === '1';
    const src = isNoise ? undefined : absoluteUrl(raw, baseUrl);
    if (!src || rendered.has(src)) {
      $el.remove();
      return;
    }
    rendered.add(src);
    const alt = ($el.attr('alt') ?? '').replace(/\s+/g, ' ').trim();
    $el.replaceWith(textNode($, alt ? `[image: ${alt}](${src})` : `[image](${src})`));
  });
}

/**
 * Render `<time datetime="X">label</time>` as `label (X)`, so the exact stamp survives.
 * @param $ - the parsed page
 */
function renderTimes($: CheerioAPI): void {
  $('time[datetime]').each((_i, el) => {
    const $el = $(el);
    const stamp = $el.attr('datetime')?.trim();
    if (!stamp) {
      return;
    }
    const label = flatten($el.text());
    $el.text(label ? `${label} (${stamp})` : stamp);
  });
}

/**
 * Render `<a href="x">label</a>` as `label (x)`, once per URL.
 * @param $ - the parsed page
 * @param baseUrl - the page URL, when the caller knows it
 * @param rendered - URLs already spoken for, added to as we go
 */
function renderLinks($: CheerioAPI, baseUrl: string | undefined, rendered: Set<string>): void {
  $('a[href]').each((_i, el) => {
    const $el = $(el);
    const href = $el.attr('href')?.trim() ?? '';
    const label = flatten($el.text());
    const url = href.startsWith('#') || href.startsWith('javascript:') ? undefined : absoluteUrl(href, baseUrl);
    if (!url || rendered.has(url)) {
      $el.text(label);
      return;
    }
    rendered.add(url);
    $el.text(label ? `${label} (${url})` : url);
  });
}

function markBreaks($: CheerioAPI): void {
  $('br').each((_i, el) => {
    $(el).replaceWith(textNode($, LINE_MARK));
  });
  $(BLOCK_SELECTOR).each((_i, el) => {
    $(el).append(textNode($, PARAGRAPH_MARK));
  });
}

/**
 * cheerio parses whatever you hand append() or replaceWith() as HTML, so text
 * goes in through a span whose text is set through the API. That keeps a
 * stray angle bracket in an alt attribute or a URL from becoming markup.
 * @param $ - the parsed page
 * @param value - the literal text to insert
 */
function textNode($: CheerioAPI, value: string) {
  return $('<span>').text(value);
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Collapse source whitespace, then turn our own marks into real breaks.
 * @param text - the raw concatenated text of the body
 */
function collapse(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(LINE_MARK_RE, '\n')
    .replace(PARAGRAPH_MARK_RE, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

export function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  // eslint-disable-next-line regexp/no-contradiction-with-assertion -- the regex is intentionally permissive; the linter's "always-entered quantifier" warning is a false positive against `<a\b[^>]*\bhref`, which is the standard pattern for extracting hrefs from anchor tags.
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
