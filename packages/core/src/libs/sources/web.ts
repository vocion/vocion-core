/**
 * Web URL connector — fetch one or more URLs and ingest them as
 * documents. Zero auth, intentionally minimal so it ships as the
 * first working connector before the heavier OAuth ones (Drive,
 * GitHub) land in M.1.
 *
 * Supported config:
 *   - `urls: string[]` — explicit list to fetch
 *   - `urlsFrom: { url, arrayPath?, urlKey?, maxUrls? }` — read the list
 *     from a remote JSON endpoint, so a registry elsewhere owns it
 *   - `feedUrl: string` — a calendar/RSS/Atom feed to read instead of the
 *     listing, when someone already knows the site has one
 *   - `crawl: { startUrl, maxDepth?, maxPages?, include?, exclude? }` —
 *     same-origin BFS with optional path filters
 *
 * With `crawl` and no `feedUrl`, the connector picks the SMALLEST complete
 * source it can find, once per sync: a feed if the listing advertises one,
 * else a JSON listing, else the listing plus a capped depth-1 crawl. The
 * probes that answer that question are silent by design — see `fetchPage`.
 *
 * HTML to text is done with cheerio: the chrome (scripts, nav, footer,
 * cookie bars) comes out, and links, images, <time> stamps and JSON-LD
 * stay in. Pages that build their body client-side still look thin. The
 * follow-up is a headless-browser variant, punted until users actually
 * ask for it. The same DOM walk now also returns the page's structure
 * (`libs/sources/pageMetadata.ts`), which lands on the document row.
 */

import type { CheerioAPI } from 'cheerio';
import type { PageLink, PageStructure } from './pageMetadata';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { z } from 'zod';
import { JSON_LD_BLOCK_CAP, pageMetadata } from './pageMetadata';

const urlsFromSchema = z.object({
  url: z.string().url(),
  /**
   * Dotted path to the array inside the response, `data.items` and all.
   * Omitted, a bare array or a top-level `urls` array is read instead.
   */
  arrayPath: z.string().optional(),
  urlKey: z.string().default('url'),
  maxUrls: z.number().int().min(1).max(1000).default(200),
});

const crawlSchema = z.object({
  startUrl: z.string().url(),
  maxDepth: z.number().int().min(0).max(3).default(1),
  maxPages: z.number().int().min(1).max(200).default(50),
  /** Substrings a link's path+query must contain to be followed. */
  include: z.array(z.string()).optional(),
  /** Substrings that keep a link out, checked before `include`. */
  exclude: z.array(z.string()).optional(),
});

const webConfigSchema = z.object({
  urls: z.array(z.string().url()).optional(),
  urlsFrom: urlsFromSchema.optional(),
  feedUrl: z.string().url().optional(),
  crawl: crawlSchema.optional(),
}).refine(c => c.urls?.length || c.urlsFrom || c.crawl, {
  message: 'Provide `urls`, `urlsFrom` or `crawl`.',
});

type CrawlConfig = z.infer<typeof crawlSchema>;
type UrlsFromConfig = z.infer<typeof urlsFromSchema>;

const USER_AGENT = 'VocionBot/0.1 (+https://vocion.ai)';
const PAGE_TIMEOUT_MS = 15_000;
/** Feed probes and the URL list are side quests: they get a shorter leash. */
const PROBE_TIMEOUT_MS = 8_000;

/**
 * zod 4's `.url()` accepts ANY scheme — `file://`, `javascript:` and
 * `webcal://` all pass it — so every URL that reaches `fetch` is checked
 * against this as well.
 */
const HTTP_URL_RE = /^https?:/i;

export const webConnector: SourceConnector<typeof webConfigSchema> = {
  slug: 'web',
  name: 'Web URL',
  description: 'Crawl a list of public URLs or a single site (same-origin BFS, capped depth + page count).',
  icon: 'Globe',
  authKind: 'none',
  configSchema: webConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = webConfigSchema.parse(ctx.config);

    // An explicit list, from the config or from a registry, is already the
    // smallest source there is: nothing to discover, nothing to crawl.
    const listed = [...(cfg.urls ?? [])];
    if (cfg.urlsFrom) {
      listed.push(...await urlsFromRegistry(cfg.urlsFrom, ctx));
    }
    if (listed.length) {
      const urls = dedupe(listed.map(httpUrl));
      runNote(ctx, urls[0], `source: ${urls.length} listed URL${urls.length === 1 ? '' : 's'}`);
      for (const url of urls) {
        yield* fetchDocs(url, ctx);
      }
      return;
    }
    if (!cfg.crawl) {
      // `urlsFrom` answered with nothing usable and there is no crawl to fall
      // back on. It has already reported why, as an error or as a no-op.
      return;
    }
    yield* smallestSource(cfg.feedUrl, cfg.crawl, ctx);
  },
};

/* ------------------------------------------------------------------ */
/* smallest-source selection                                           */
/* ------------------------------------------------------------------ */

/**
 * Read the smallest complete thing this source exposes, in order: the feed
 * the config names, then a feed the listing advertises, then a JSON listing,
 * then the listing plus a capped crawl of its detail pages.
 *
 * Nothing here is persisted — core has no home for a string (`cursor` is
 * nulled every run, `counts` is `Record<string, number>`), so the answer is
 * re-derived once per sync and the choice is named in the run log. The
 * durable copy of the answer belongs to whoever owns the source row.
 * @param feedUrl - a feed from the config, which skips discovery entirely.
 * @param cfg - the crawl config, whose `startUrl` is the listing.
 * @param ctx - the sync context.
 * @yields {IngestDoc} one document per page or per event, from whichever source won.
 */
async function* smallestSource(
  feedUrl: string | undefined,
  cfg: CrawlConfig,
  ctx: SourceContext,
): AsyncIterable<IngestDoc> {
  if (feedUrl) {
    const url = httpUrl(feedUrl);
    runNote(ctx, url, 'source: configured feed');
    yield* fetchDocs(url, ctx);
    return;
  }

  const listing = await fetchPage(httpUrl(cfg.startUrl), ctx);
  if (!listing) {
    return;
  }

  for (const candidate of discoverFeeds(listing)) {
    const docs = await readFeed(candidate, ctx);
    if (!docs) {
      continue;
    }
    runNote(ctx, candidate.url, `source: discovered ${candidate.kind} feed, ${docs.length} document${docs.length === 1 ? '' : 's'}`);
    yield* docs;
    return;
  }

  const jsonLdNote = hasEventJsonLd(listing) ? '; listing carries Event JSON-LD' : '';
  runNote(ctx, listing.url, `source: listing + depth-${cfg.maxDepth} crawl${jsonLdNote}`);
  // The listing body is handed to the crawl so the seed is not fetched twice.
  yield* crawl(cfg, ctx, listing);
}

/**
 * Fetch and read one discovered feed. Returns null when it is not there, does
 * not answer, or does not look like the kind advertised — all silently, so a
 * site that never had a feed costs the run nothing.
 * @param candidate - the feed URL and the kind the page claimed it is.
 * @param ctx - the sync context.
 */
async function readFeed(candidate: FeedCandidate, ctx: SourceContext): Promise<IngestDoc[] | null> {
  const page = await fetchPage(candidate.url, ctx, { probe: true, timeoutMs: PROBE_TIMEOUT_MS });
  if (!page) {
    return null;
  }
  if (!looksLikeFeed(candidate.kind, page)) {
    // A site that answers 200 with its own 404 page for anything under /feed
    // is common enough to be worth one cheap shape check.
    ctx.onProgress?.({ kind: 'skipped', uri: candidate.url, message: `not a ${candidate.kind} feed` });
    return null;
  }
  const docs = docsFromPage(page, ctx);
  return docs.length ? docs : null;
}

/* ------------------------------------------------------------------ */
/* the remote URL list                                                 */
/* ------------------------------------------------------------------ */

/**
 * Read the source's URL list from a JSON endpoint.
 *
 * Failure is deliberately loud — one CONNECTOR-scope error — because the
 * runner reads a connector error as "a slice we could not fetch": it holds
 * the watermark, suppresses tombstoning for the whole run, and fails the run
 * when nothing else was saved. A registry that is down for an hour therefore
 * can never delete a source's documents. The one case that is NOT a failure
 * is a 200 carrying a valid empty array: that is the registry answering
 * "nothing listed today", and the run stays healthy.
 * @param cfg - the `urlsFrom` block, defaults already applied.
 * @param ctx - the sync context.
 */
async function urlsFromRegistry(cfg: UrlsFromConfig, ctx: SourceContext): Promise<string[]> {
  const registry = httpUrl(cfg.url);
  const fail = (message: string): string[] => {
    ctx.onProgress?.({ kind: 'error', uri: registry, message });
    return [];
  };

  let body: unknown;
  try {
    const res = await fetch(registry, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return fail(`the URL list answered HTTP ${res.status}`);
    }
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      return fail('the URL list is not JSON');
    }
  } catch (err) {
    return fail(`the URL list could not be read: ${(err as Error).message}`);
  }

  const items = arrayFromBody(body, cfg.arrayPath);
  if (!items) {
    return fail(`the URL list holds no array${cfg.arrayPath ? ` at \`${cfg.arrayPath}\`` : ''}`);
  }
  if (!items.length) {
    ctx.onProgress?.({ kind: 'skipped', uri: registry, message: 'the URL list is empty' });
    return [];
  }

  const seen = new Set<string>();
  let unusable = 0;
  for (const item of items) {
    const url = usableUrl(item, cfg.urlKey);
    if (!url) {
      unusable += 1;
      continue;
    }
    seen.add(url);
  }
  if (!seen.size) {
    return fail(`the URL list holds ${items.length} entr${items.length === 1 ? 'y' : 'ies'} and no usable URL`);
  }

  const all = [...seen];
  const kept = all.slice(0, cfg.maxUrls);
  const duplicates = items.length - unusable - all.length;
  const detail = [
    unusable ? `${unusable} unusable` : '',
    duplicates > 0 ? `${duplicates} duplicate` : '',
    kept.length < all.length ? `capped at ${cfg.maxUrls}` : '',
  ].filter(Boolean).join(', ');
  ctx.onProgress?.({
    kind: 'skipped',
    uri: registry,
    message: `URL list: ${kept.length} of ${items.length}${detail ? ` (${detail})` : ''}`,
  });
  return kept;
}

/**
 * Find the array of URLs in whatever shape the endpoint answers with: a bare
 * array, the array at `arrayPath`, or a top-level `urls` array.
 * @param body - the parsed response.
 * @param arrayPath - dotted path from the config, when set.
 */
function arrayFromBody(body: unknown, arrayPath: string | undefined): unknown[] | null {
  if (Array.isArray(body)) {
    return body;
  }
  if (arrayPath) {
    const found = valueAtPath(body, arrayPath);
    if (Array.isArray(found)) {
      return found;
    }
  }
  if (isRecord(body) && Array.isArray(body.urls)) {
    return body.urls;
  }
  return null;
}

/**
 * Walk a dotted path through plain objects.
 * @param body - the value to walk.
 * @param path - dotted path, `data.items` style.
 */
function valueAtPath(body: unknown, path: string): unknown {
  let current: unknown = body;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/**
 * One list entry — a bare string or an object keyed by `urlKey` — as a URL we
 * are willing to fetch, or undefined.
 * @param raw - the entry as it came out of the JSON.
 * @param urlKey - the object key holding the URL.
 */
function usableUrl(raw: unknown, urlKey: string): string | undefined {
  const value = typeof raw === 'string' ? raw : isRecord(raw) ? raw[urlKey] : undefined;
  if (typeof value !== 'string') {
    return undefined;
  }
  // `webcal:` is rewritten rather than rejected: it is an ICS feed over https
  // under another name. Everything else non-http stays out — the explicit
  // protocol test is the whole point, since zod's `.url()` waves `file://` and
  // `javascript:` through.
  const url = httpUrl(value.trim());
  if (!HTTP_URL_RE.test(url) || !z.string().url().safeParse(url).success) {
    return undefined;
  }
  return url;
}

/* ------------------------------------------------------------------ */
/* fetch + extract                                                     */
/* ------------------------------------------------------------------ */

type FetchedPage = {
  /** The URL actually fetched, after the `webcal:` rewrite. */
  url: string;
  raw: string;
  contentType: string;
  isHtml: boolean;
  etag: string | null;
  lastModifiedAt: Date | null;
  title?: string;
  content: string;
  structure?: PageStructure;
};

/**
 * Fetch one URL and extract it, without deciding what it becomes.
 *
 * `probe: true` is the discovery mode: it reports a failure as `skipped`
 * instead of `error`. That matters more than it looks — a connector-scope
 * error sets `connectorFailureCount`, which holds the watermark and
 * suppresses tombstoning for the WHOLE run, so a 404 from guessing at a feed
 * URL would quietly break deletion on an otherwise healthy source.
 * @param url - the URL to fetch; `webcal:` is rewritten to `https:` first.
 * @param ctx - the sync context.
 * @param opts - discovery options.
 * @param opts.probe - report failures as `skipped` rather than `error`.
 * @param opts.timeoutMs - a shorter leash than the default page timeout.
 */
async function fetchPage(
  url: string,
  ctx: SourceContext,
  opts?: { probe?: boolean; timeoutMs?: number },
): Promise<FetchedPage | null> {
  const target = httpUrl(url);
  const report = (message: string): void => {
    ctx.onProgress?.({ kind: opts?.probe ? 'skipped' : 'error', uri: target, message });
  };
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(opts?.timeoutMs ?? PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      report(`HTTP ${res.status}`);
      return null;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const isHtml = contentType.includes('text/html');
    // `+xml` covers `application/rss+xml` and `application/atom+xml`, which
    // used to be skipped silently as an unsupported type — and an RSS feed is
    // the only feed some venues publish.
    const isPlain = contentType.startsWith('text/')
      || contentType.includes('application/json')
      || contentType.includes('application/xml')
      || contentType.includes('+xml');
    if (!isHtml && !isPlain) {
      ctx.onProgress?.({ kind: 'skipped', uri: target, message: `unsupported content-type: ${contentType}` });
      return null;
    }
    const raw = await res.text();
    const extracted = isHtml ? extractFromHtml(raw, target) : { title: undefined, content: raw, structure: undefined };
    const lastModifiedHeader = res.headers.get('last-modified');
    return {
      url: target,
      raw,
      contentType,
      isHtml,
      etag: res.headers.get('etag'),
      lastModifiedAt: lastModifiedHeader ? new Date(lastModifiedHeader) : null,
      title: extracted.title,
      content: extracted.content,
      structure: extracted.structure,
    };
  } catch (err) {
    report((err as Error).message);
    return null;
  }
}

/**
 * Turn a fetched page into the documents it holds: one per event for a feed,
 * one for the page otherwise.
 * @param page - the fetched page.
 * @param ctx - the sync context, for the progress event.
 */
function docsFromPage(page: FetchedPage, ctx: SourceContext): IngestDoc[] {
  const split = splitFeed(page);
  if (split) {
    ctx.onProgress?.({ kind: 'fetched', uri: page.url });
    return split;
  }
  if (!page.content.trim()) {
    ctx.onProgress?.({ kind: 'skipped', uri: page.url, message: 'empty after extraction' });
    return [];
  }
  ctx.onProgress?.({ kind: 'fetched', uri: page.url });
  return [{
    externalId: page.url,
    uri: page.url,
    title: page.title ?? page.url,
    content: page.content,
    etag: page.etag,
    lastModifiedAt: page.lastModifiedAt,
    metadata: { contentType: page.contentType, ...pageMetadata(page.structure) },
  }];
}

/**
 * Fetch one URL and yield whatever it holds.
 * @param url - the URL to fetch.
 * @param ctx - the sync context.
 * @yields {IngestDoc} one document per page, or one per event when the body is a feed.
 */
async function* fetchDocs(url: string, ctx: SourceContext): AsyncIterable<IngestDoc> {
  const page = await fetchPage(url, ctx);
  if (!page) {
    return;
  }
  yield* docsFromPage(page, ctx);
}

/* ------------------------------------------------------------------ */
/* per-event split                                                     */
/* ------------------------------------------------------------------ */

/**
 * One document per event, when the body is a feed. Null means "this is not a
 * feed, or it has no stable per-event key" — the caller then ingests the
 * whole file as one document, which is the fallback the id scheme needs:
 * index-based ids are never used, because one reorder or one removal
 * mid-feed turns every following id into an `updated` document, costing a
 * re-embed and a model call each.
 * @param page - the fetched page.
 */
function splitFeed(page: FetchedPage): IngestDoc[] | null {
  if (page.isHtml) {
    return null;
  }
  if (page.raw.includes('BEGIN:VEVENT')) {
    return splitIcs(page);
  }
  const items = topLevelJsonArray(page);
  return items ? splitJsonArray(page, items) : null;
}

/**
 * Split an ICS body on `BEGIN:VEVENT` … `END:VEVENT`.
 *
 * A text split and nothing more: no RFC 5545 unfolding of any field except
 * UID (the split key, which would otherwise be cut in half by a fold), no
 * TZID arithmetic, no RRULE expansion. A recurring event stays one document
 * unless the feed itself writes separate components with RECURRENCE-ID.
 * @param page - the fetched feed.
 */
function splitIcs(page: FetchedPage): IngestDoc[] | null {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of page.raw.split(/\r?\n/)) {
    const marker = line.trim().toUpperCase();
    if (marker === 'BEGIN:VEVENT') {
      current = [line.trim()];
      continue;
    }
    if (!current) {
      continue;
    }
    if (marker === 'END:VEVENT') {
      current.push(line.trim());
      blocks.push(current);
      current = null;
      continue;
    }
    current.push(line);
  }
  if (!blocks.length) {
    return null;
  }

  const docs: IngestDoc[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const uid = icsValue(block, 'UID', true);
    if (!uid) {
      return null;
    }
    const recurrenceId = icsValue(block, 'RECURRENCE-ID', false);
    const externalId = `${page.url}#${uid}${recurrenceId ? `#${recurrenceId}` : ''}`;
    if (seen.has(externalId)) {
      // Two components the feed itself cannot tell apart. Splitting on a key
      // that repeats would make them fight over one document every sync.
      return null;
    }
    seen.add(externalId);
    docs.push({
      externalId,
      uri: externalId,
      title: icsValue(block, 'SUMMARY', false) || uid,
      content: block.join('\n'),
      // Feed-wide headers say nothing about one event inside it.
      etag: null,
      lastModifiedAt: null,
      metadata: { contentType: page.contentType, feedUrl: page.url },
    });
  }
  return docs;
}

/**
 * Read one property out of a VEVENT block.
 * @param lines - the block's lines, as written in the feed.
 * @param name - the property name, uppercase.
 * @param unfold - join RFC 5545 continuation lines. Only UID asks for this.
 */
function icsValue(lines: string[], name: string, unfold: boolean): string {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    // A line starting with a space or a tab is the continuation of the one
    // above it, never a property of its own.
    if (/^[ \t]/.test(line)) {
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) {
      continue;
    }
    // `UID:x`, but also `DTSTART;TZID=America/New_York:x`.
    if (line.slice(0, colon).split(';')[0]!.toUpperCase() !== name) {
      continue;
    }
    let value = line.slice(colon + 1);
    if (unfold) {
      for (let j = i + 1; j < lines.length && /^[ \t]/.test(lines[j]!); j += 1) {
        value += lines[j]!.slice(1);
      }
    }
    return value.trim();
  }
  return '';
}

/**
 * The body as a top-level JSON array, when that is what it is.
 * @param page - the fetched page.
 */
function topLevelJsonArray(page: FetchedPage): unknown[] | null {
  if (!page.contentType.includes('json')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(page.raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Split a top-level JSON array into one document per item, keyed by the
 * item's own identifier where it has one and by a hash of the item where it
 * does not — never by its position in the array.
 * @param page - the fetched feed.
 * @param items - the parsed top-level array.
 */
function splitJsonArray(page: FetchedPage, items: unknown[]): IngestDoc[] | null {
  if (!items.length) {
    // An empty array is a feed with nothing in it today, not a feed to split.
    // The whole file stays one document so the source keeps a document to own.
    return null;
  }
  const docs: IngestDoc[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const body = JSON.stringify(item) ?? 'null';
    const key = declaredKey(item) ?? createHash('sha256').update(body).digest('hex').slice(0, 16);
    const externalId = `${page.url}#${key}`;
    if (seen.has(externalId)) {
      return null;
    }
    seen.add(externalId);
    docs.push({
      externalId,
      uri: externalId,
      title: declaredTitle(item) ?? key,
      content: body,
      etag: null,
      lastModifiedAt: null,
      metadata: { contentType: page.contentType, feedUrl: page.url },
    });
  }
  return docs;
}

/** Keys a JSON feed item might state its own identity with, in order of trust. */
const ITEM_KEY_FIELDS = ['@id', 'id', 'slug'] as const;
/** Keys a JSON feed item might state its own name with, in order of trust. */
const ITEM_TITLE_FIELDS = ['name', 'title', 'summary'] as const;

/**
 * The item's own stable identifier, when it publishes one.
 * @param item - one entry from the array.
 */
function declaredKey(item: unknown): string | undefined {
  if (!isRecord(item)) {
    return undefined;
  }
  for (const field of ITEM_KEY_FIELDS) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

/**
 * The item's own name, when it publishes one.
 * @param item - one entry from the array.
 */
function declaredTitle(item: unknown): string | undefined {
  if (!isRecord(item)) {
    return undefined;
  }
  for (const field of ITEM_TITLE_FIELDS) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) {
      return flatten(value);
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* feed discovery                                                      */
/* ------------------------------------------------------------------ */

type FeedCandidate = { url: string; kind: 'ics' | 'rss' | 'atom' | 'json' };

/** Smallest complete source first: a calendar beats a feed beats a listing. */
const KIND_ORDER: Record<FeedCandidate['kind'], number> = { ics: 0, rss: 1, atom: 2, json: 3 };

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const ICS_PATH_RE = /\.ics(?:$|[?#])/i;
const ICAL_QUERY_RE = /[?&]ical=1(?:&|$)/i;
/** Markers that mean the page is served by Squarespace, whose pages answer `?format=json`. */
const SQUARESPACE_MARKERS = ['static1.squarespace.com', 'squarespace-cdn.com', 'Squarespace.afterBodyLoad'];

/**
 * What feeds this listing page advertises, best first. Nothing is fetched
 * here — these are candidates, and the caller probes them silently.
 * @param page - the fetched listing page.
 */
function discoverFeeds(page: FetchedPage): FeedCandidate[] {
  if (!page.isHtml) {
    return [];
  }
  const found: FeedCandidate[] = [];
  const add = (raw: string | undefined, kind: FeedCandidate['kind']): void => {
    const url = httpUrl(absoluteUrl(raw, page.url) ?? '');
    if (!HTTP_URL_RE.test(url) || found.some(c => c.url === url)) {
      return;
    }
    found.push({ url, kind });
  };

  for (const tag of alternateLinks(page.raw)) {
    if (tag.type.includes('text/calendar')) {
      add(tag.href, 'ics');
    } else if (tag.type.includes('rss+xml')) {
      add(tag.href, 'rss');
    } else if (tag.type.includes('atom+xml')) {
      add(tag.href, 'atom');
    }
  }
  // Plenty of sites link their .ics from the body and never declare it in the
  // head — "Add to calendar" buttons, mostly.
  for (const link of page.structure?.links ?? []) {
    if (ICS_PATH_RE.test(link.url) || link.url.toLowerCase().startsWith('webcal:') || ICAL_QUERY_RE.test(link.url)) {
      add(link.url, 'ics');
    }
  }
  if (SQUARESPACE_MARKERS.some(marker => page.raw.includes(marker))) {
    add(withFormatJson(page.url), 'json');
  }

  // Stable sort: same kind keeps document order.
  return found.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/**
 * The `rel="alternate"` link tags in the page head.
 *
 * Read with a regex rather than a second cheerio parse: `<link>` is a void
 * element that never nests, the page has already been parsed once for its
 * text, and discovery runs on the listing page of every source every sync.
 * @param html - the raw page.
 */
function alternateLinks(html: string): Array<{ type: string; href: string }> {
  const out: Array<{ type: string; href: string }> = [];
  for (const match of html.matchAll(LINK_TAG_RE)) {
    const tag = match[0];
    const rel = tagAttr(tag, 'rel')?.toLowerCase() ?? '';
    if (!rel.split(/\s+/).includes('alternate')) {
      continue;
    }
    const href = tagAttr(tag, 'href');
    if (href) {
      out.push({ type: tagAttr(tag, 'type')?.toLowerCase() ?? '', href });
    }
  }
  return out;
}

/**
 * One attribute off a single tag, quoted or not.
 * @param tag - the tag's source text.
 * @param name - the attribute name.
 */
function tagAttr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  const value = match?.[2] ?? match?.[3] ?? match?.[4];
  // Only the ampersand matters here: a feed URL with two query parameters is
  // written `&amp;` in the markup and must come back out as `&`.
  return value?.replace(/&(?:amp|#0*38);/gi, '&').trim();
}

/**
 * The same page asked for as JSON — the Squarespace listing answer.
 * @param url - the listing URL.
 */
function withFormatJson(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('format', 'json');
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Cheap shape check so a 200 that is really a site's 404 page is not mistaken
 * for a feed.
 * @param kind - the kind the listing page claimed.
 * @param page - the fetched candidate.
 */
function looksLikeFeed(kind: FeedCandidate['kind'], page: FetchedPage): boolean {
  switch (kind) {
    case 'ics':
      return page.raw.includes('BEGIN:VCALENDAR') || page.raw.includes('BEGIN:VEVENT');
    case 'rss':
      return /<rss\b/i.test(page.raw) || /<rdf:rdf\b/i.test(page.raw);
    case 'atom':
      return /<feed\b/i.test(page.raw);
    case 'json':
      return topLevelJsonArray(page) !== null || jsonObjectBody(page);
  }
}

/**
 * True when the body parses as a JSON object.
 * @param page - the fetched candidate.
 */
function jsonObjectBody(page: FetchedPage): boolean {
  try {
    return isRecord(JSON.parse(page.raw));
  } catch {
    return false;
  }
}

/**
 * True when the listing's own JSON-LD already describes events — a signal
 * worth naming in the run log, because it means the listing page alone may
 * carry what the detail pages would have said.
 * @param page - the fetched listing page.
 */
function hasEventJsonLd(page: FetchedPage): boolean {
  const blocks = page.structure?.jsonLd ?? [];
  const types: unknown[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) {
      continue;
    }
    types.push(block['@type']);
    const graph = block['@graph'];
    if (Array.isArray(graph)) {
      for (const node of graph) {
        if (isRecord(node)) {
          types.push(node['@type']);
        }
      }
    }
  }
  return types.flat().some(t => typeof t === 'string' && t.includes('Event'));
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
 *
 * `structure` is the same walk's structured half — the parsed JSON-LD, the
 * og:image and every URL the page published — kept instead of thrown away.
 * It is optional on the return type because the two callers both write
 * `{ title: undefined, content: raw }` for non-HTML bodies; `content` is
 * byte-identical to what this returned before `structure` existed.
 * @param html - raw HTML as fetched
 * @param baseUrl - the URL the HTML came from, used to make hrefs and image
 * sources absolute. Relative URLs are left as written when it is omitted.
 */
export function extractFromHtml(html: string, baseUrl?: string): { title?: string; content: string; structure?: PageStructure } {
  const $ = load(html.replace(OWN_MARKS, ' '));

  // Read the metadata before the chrome comes out: on plenty of pages the
  // only h1 is the one sitting in the site header.
  const title = pageTitle($);
  const image = absoluteUrl(metaContent($, 'og:image'), baseUrl);
  const blocks = structuredBlocks($);
  // Collected here for the same reason, and one more: the gate a later stage
  // uses to check a model-returned URL wants every URL the page published,
  // not only the ones that survive chrome removal.
  const published = collectLinks($, baseUrl);
  const structured = structuredText(blocks.serialised);

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

  const structure: PageStructure = {};
  if (blocks.values.length) {
    structure.jsonLd = blocks.values.slice(0, JSON_LD_BLOCK_CAP);
  }
  if (blocks.values.length > JSON_LD_BLOCK_CAP) {
    structure.truncated = true;
  }
  if (image) {
    structure.ogImage = image;
  }
  if (published.length) {
    structure.links = published;
  }

  // An image on its own is not content. Both callers read empty content as
  // "nothing here" and skip the page, which is still the right call.
  return { title, content: text || structured ? parts.join('\n\n') : '', structure };
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
 * Every JSON-LD block on the page, parsed once and kept in both shapes: the
 * parsed value for `PageStructure`, and the compact string the text section
 * is built from.
 * @param $ - the parsed page, still holding its scripts
 */
function structuredBlocks($: CheerioAPI): { values: unknown[]; serialised: string[] } {
  const values: unknown[] = [];
  const serialised: string[] = [];
  $('script').each((_i, el) => {
    if (!($(el).attr('type') ?? '').toLowerCase().includes('ld+json')) {
      return;
    }
    const raw = $(el).text().trim();
    if (!raw) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      values.push(parsed);
      serialised.push(JSON.stringify(parsed));
    } catch {
      // Plenty of sites ship JSON-LD that does not parse. Dropping the block
      // beats failing the page over it.
    }
  });
  return { values, serialised };
}

/**
 * The JSON-LD text section: every schema.org type is kept, not just Event,
 * because this is a generic engine and a workspace that cares about recipes
 * or job postings has as much claim on its own structured data as an events
 * workspace has on its own.
 * @param blocks - the re-serialised JSON-LD blocks, in document order
 */
function structuredText(blocks: string[]): string {
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

/**
 * Every URL the page publishes, in document order, deduplicated. Read-only:
 * `renderLinks` is what rewrites the DOM, and it runs later.
 * @param $ - the parsed page, still holding its chrome
 * @param baseUrl - the page URL, when the caller knows it
 */
function collectLinks($: CheerioAPI, baseUrl: string | undefined): PageLink[] {
  const out: PageLink[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_i, el) => {
    const $el = $(el);
    const href = $el.attr('href')?.trim() ?? '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
      return;
    }
    const url = absoluteUrl(href, baseUrl);
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    out.push({ url, text: flatten($el.text()) });
  });
  return out;
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

/**
 * Walk the site from `startUrl`, same origin only, bounded by `maxDepth` and
 * `maxPages`, with optional path filters.
 *
 * `maxPages` bounds pages ATTEMPTED, not pages ingested: the cost this cap
 * exists to control is requests, and a site answering 500 for half its detail
 * pages should not buy itself an unbounded crawl.
 * @param cfg - the crawl config, defaults already applied.
 * @param ctx - the sync context.
 * @param seed - the start page, when the caller already fetched it.
 * @yields {IngestDoc} one document per page the crawl reaches.
 */
async function* crawl(cfg: CrawlConfig, ctx: SourceContext, seed?: FetchedPage): AsyncIterable<IngestDoc> {
  const startUrl = httpUrl(cfg.startUrl);
  const startOrigin = new URL(startUrl).origin;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  let attempted = 0;
  let pending = seed;
  while (queue.length && attempted < cfg.maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) {
      continue;
    }
    visited.add(url);
    attempted += 1;
    const page = pending?.url === url ? pending : await fetchPage(url, ctx);
    pending = undefined;
    if (page) {
      for (const doc of docsFromPage(page, ctx)) {
        yield doc;
      }
    }
    if (!page || depth >= cfg.maxDepth) {
      // Nothing to read links out of, and `fetchPage` has already reported why
      // — as a connector-scope error for a real failure, which is what keeps
      // the runner from treating a half-read listing as a complete run and
      // hard-deleting last run's detail documents.
      continue;
    }
    // The link pass reads the body we already hold. It used to be a SECOND raw
    // fetch of the same URL whose every failure was swallowed by
    // `.catch(() => '')`: one extra request per source, and a silent one whose
    // failure left the run looking complete with only the listing handled.
    for (const href of pageLinks(page)) {
      try {
        const next = new URL(href, url);
        // Strip fragments so #section links don't blow up the queue.
        next.hash = '';
        if (next.origin === startOrigin && !visited.has(next.toString()) && followable(next, cfg)) {
          queue.push({ url: next.toString(), depth: depth + 1 });
        }
      } catch {
        /* malformed href — skip */
      }
    }
  }
}

/**
 * The links to consider following out of a fetched page.
 * @param page - the fetched page.
 */
function pageLinks(page: FetchedPage): string[] {
  if (page.structure) {
    return page.structure.links?.map(link => link.url) ?? [];
  }
  // Non-HTML bodies never went through cheerio. The old regex still covers the
  // odd page served as text/plain with markup inside it.
  return extractLinks(page.raw, page.url);
}

/**
 * Apply the crawl's path filters. `exclude` wins; an `include` list, when set,
 * is a whitelist. Both match as substrings of path+query, which is what a
 * person configuring `include: ["/events/"]` expects.
 * @param url - the candidate link.
 * @param cfg - the crawl config.
 */
function followable(url: URL, cfg: CrawlConfig): boolean {
  const path = `${url.pathname}${url.search}`;
  if (cfg.exclude?.some(fragment => path.includes(fragment))) {
    return false;
  }
  if (cfg.include?.length) {
    return cfg.include.some(fragment => path.includes(fragment));
  }
  return true;
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

/* ------------------------------------------------------------------ */
/* small shared helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * `webcal://` is https with another name. Left alone it reaches `fetch`, which
 * throws on the unknown scheme and turns a perfectly good calendar into a
 * connector-scope error that fails the run.
 * @param url - the URL as configured or as found on a page.
 */
function httpUrl(url: string): string {
  return url.replace(/^webcal:/i, 'https:');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A line for the run log.
 *
 * `skipped` and never `error`: an error would count a connector failure,
 * which holds the watermark and suppresses tombstoning for the whole run.
 * There is nowhere else to put a string — the checkpoint's `counts` is
 * `Record<string, number>` and `cursor` is nulled every run.
 * @param ctx - the sync context.
 * @param uri - the URL the line is about, when there is one.
 * @param message - the line.
 */
function runNote(ctx: SourceContext, uri: string | undefined, message: string): void {
  ctx.onProgress?.({ kind: 'skipped', uri, message });
}
