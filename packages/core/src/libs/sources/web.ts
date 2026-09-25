/**
 * Web URL connector — fetch one or more URLs and ingest them as
 * documents. Zero auth, intentionally minimal so it ships as the
 * first working connector before the heavier OAuth ones (Drive,
 * GitHub) land in M.1.
 *
 * Supported config:
 *   - `urls: string[]` — explicit list to fetch
 *   - `urlsFrom: { url, arrayPath?, urlKey?, maxUrls? }`, read the list
 *     from a remote JSON endpoint, so a registry elsewhere owns it
 *   - `feedUrl: string`, a calendar/RSS/Atom feed to read instead of the
 *     listing, when someone already knows the site has one
 *   - `crawl: { startUrl, maxDepth?, maxPages?, include?, exclude? }`,
 *     same-origin BFS with optional path filters
 *
 * With `crawl` and no `feedUrl`, the connector picks the SMALLEST complete
 * source it can find, per listing seed: a feed if the listing advertises one,
 * else a JSON listing, else the listing plus a capped depth-1 crawl. The
 * probes that answer that question are silent by design, see `fetchPage`.
 *
 * What a listed URL MEANS depends on whether `crawl` is configured with it.
 * Alone, it is one document, fetched and ingested as it stands. Alongside a
 * `crawl` block it is a listing SEED, and gets the same smallest-source
 * question `crawl.startUrl` gets, which is what a registry-driven source
 * (`urlsFrom` naming one entry URL per site) needs: without this, a site whose
 * listing advertises an ics feed is ingested as one 800 KB HTML page.
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

export const USER_AGENT = 'VocionBot/0.1 (+https://vocion.ai)';
const PAGE_TIMEOUT_MS = 15_000;
/** Feed probes and the URL list are side quests: they get a shorter leash. */
const PROBE_TIMEOUT_MS = 8_000;

/**
 * zod 4's `.url()` accepts ANY scheme, `file://`, `javascript:` and
 * `webcal://` all pass it, so every URL that reaches `fetch` is checked
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

    const listed = [...(cfg.urls ?? [])];
    if (cfg.urlsFrom) {
      listed.push(...await urlsFromRegistry(cfg.urlsFrom, ctx));
    }
    const urls = dedupe(listed.map(httpUrl));

    // No crawl block: an explicit list is already the smallest source there
    // is, nothing to discover, nothing to crawl. This is the path every
    // tenant listing URLs and nothing else is on, and it is untouched.
    if (!cfg.crawl) {
      if (!urls.length) {
        // `urlsFrom` answered with nothing usable and there is no crawl to
        // fall back on. It has already reported why, as an error or a no-op.
        return;
      }
      runNote(ctx, urls[0], `source: ${urls.length} listed URL${urls.length === 1 ? '' : 's'}`);
      for (const url of urls) {
        yield* fetchDocs(url, ctx);
      }
      return;
    }

    // A configured feed is the smallest source there is and skips discovery
    // entirely, whether or not anything else was listed.
    if (cfg.feedUrl) {
      const url = httpUrl(cfg.feedUrl);
      runNote(ctx, url, 'source: configured feed');
      yield* fetchDocs(url, ctx);
      return;
    }

    // With a crawl block, every listed URL is a listing SEED. A registry that
    // answered nothing is the one case that does NOT fall back to `startUrl`:
    // an empty list is how a source row is switched off, and falling back is
    // how a switched-off source spends money.
    let seeds = urls;
    if (!seeds.length) {
      if (cfg.urlsFrom) {
        return;
      }
      seeds = [httpUrl(cfg.crawl.startUrl)];
    }
    if (seeds.length > 1) {
      runNote(ctx, seeds[0], `source: ${seeds.length} listing seeds`);
    }
    // ONE page budget for the whole sync. `maxPages` bounds requests, and five
    // seeds each allowed their own 60 pages is 300 requests, every run.
    const pages: PageBudget = { attempted: 0 };
    for (const seed of seeds) {
      yield* smallestSource(seed, cfg.crawl, ctx, pages);
    }
  },
};

/**
 * Pages attempted across one sync, shared by every seed.
 *
 * `crawl()` used to own this counter, which was right while one sync meant one
 * crawl. With a seed per listed URL it has to live above them, or `maxPages`
 * silently becomes per seed.
 */
type PageBudget = { attempted: number };

/* ------------------------------------------------------------------ */
/* smallest-source selection                                           */
/* ------------------------------------------------------------------ */

/**
 * Read the smallest complete thing one listing seed exposes, in order: a feed
 * the listing advertises, then a JSON listing, then the listing plus a capped
 * crawl of its detail pages. A feed named by the config never gets here, it is
 * answered in `sync` before any seed is read.
 *
 * Nothing here is persisted, core has no home for a string (`cursor` is
 * nulled every run, `counts` is `Record<string, number>`), so the answer is
 * re-derived once per seed per sync and the choice is named in the run log.
 * The durable copy of the answer belongs to whoever owns the source row.
 * @param seedUrl - the listing to read, from `crawl.startUrl` or from the list.
 * @param cfg - the crawl config, whose `startUrl` is only the default seed.
 * @param ctx - the sync context.
 * @param pages - the sync's shared page budget, spent across every seed.
 * @yields {IngestDoc} one document per page or per event, from whichever source won.
 */
async function* smallestSource(
  seedUrl: string,
  cfg: CrawlConfig,
  ctx: SourceContext,
  pages: PageBudget,
): AsyncIterable<IngestDoc> {
  if (pages.attempted >= cfg.maxPages) {
    runNote(ctx, seedUrl, `source: page budget spent (${cfg.maxPages} pages), seed not read`);
    return;
  }
  // Counted before the fetch, and NOT counted again by `crawl`: the listing is
  // one request whoever ends up reading it.
  pages.attempted += 1;
  const listing = await fetchPage(httpUrl(seedUrl), ctx);
  if (!listing) {
    return;
  }

  for (const candidate of discoverFeeds(listing, ctx)) {
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
  yield* crawl(cfg, ctx, listing, pages);
}

/**
 * Fetch and read one discovered feed. Returns null when it is not there, does
 * not answer, or does not look like the kind advertised, all silently, so a
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
 * Failure is deliberately loud, one CONNECTOR-scope error, because the
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
 * One list entry, a bare string or an object keyed by `urlKey`, as a URL we
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
  // under another name. Everything else non-http stays out, the explicit
  // protocol test is the whole point, since zod's `.url()` waves `file://` and
  // `javascript:` through.
  const url = httpUrl(value.trim());
  return isHttpUrl(url) ? url : undefined;
}

/* ------------------------------------------------------------------ */
/* fetch + extract                                                     */
/* ------------------------------------------------------------------ */

type FetchedPage = {
  /** The URL requested, after the `webcal:` rewrite. */
  url: string;
  /** Where a redirect that stayed on the site landed, else `url`. Read by navigation and the feed scope, never by text or ids. */
  base: string;
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
 * instead of `error`. That matters more than it looks, a connector-scope
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
    // used to be skipped silently as an unsupported type, and an RSS feed is
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
    const base = res.redirected && HTTP_URL_RE.test(res.url) ? sameSiteUrl(target, res.url) : target;
    const extracted = isHtml ? extractFromHtml(raw, target) : { title: undefined, content: raw, structure: undefined };
    const lastModifiedHeader = res.headers.get('last-modified');
    return {
      url: target,
      base,
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

function sameSiteUrl(requestedUrl: string, landedUrl: string): string {
  const requested = new URL(requestedUrl);
  const landed = new URL(landedUrl);
  const site = (url: URL): string => url.hostname.replace(/^www\./, '');
  const upgradedAtMost = landed.protocol === requested.protocol || (requested.protocol === 'http:' && landed.protocol === 'https:');
  return upgradedAtMost && landed.port === requested.port && site(landed) === site(requested) ? landedUrl : requestedUrl;
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
 * feed, or it has no stable per-event key", the caller then ingests the
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
  const items = feedEntries(page);
  return items ? splitJsonArray(page, items) : null;
}

/**
 * The one VEVENT property RFC 5545 defines as when the file was written rather
 * than as anything about the event, so it is the one property a conformant
 * exporter is free to change on a request that changed nothing.
 *
 * It is dropped before the block becomes document text because that text is
 * what the ingest hashes to decide a document changed. Exporters that stamp it
 * per export therefore hand every event a new hash on every fetch, and a
 * pipeline that runs a model per changed document pays for every one of them to
 * be read again and return what it returned yesterday. Nothing downstream reads
 * it. `LAST-MODIFIED` and `SEQUENCE` stay: both say something about the event,
 * and an exporter that moves those is reporting an edit.
 */
const ICS_EXPORT_STAMP = 'DTSTAMP';

/**
 * Split an ICS body on `BEGIN:VEVENT` … `END:VEVENT`.
 *
 * A text split and nothing more: no TZID arithmetic, no RRULE expansion. Every
 * property read as a value is unfolded, because RFC 5545 makes a fold a fact
 * about the line rather than about the value, so reading one without unfolding
 * simply truncates it. A recurring event stays one document unless the feed
 * itself writes separate components with RECURRENCE-ID.
 *
 * The component is kept verbatim but for `ICS_EXPORT_STAMP`, which says when
 * the file was written and would otherwise make a re-export read as an edit.
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
    const uid = icsValue(block, 'UID');
    if (!uid) {
      return null;
    }
    const recurrenceId = icsValue(block, 'RECURRENCE-ID');
    const externalId = `${page.url}#${uid}${recurrenceId ? `#${recurrenceId}` : ''}`;
    if (seen.has(externalId)) {
      // Two components the feed itself cannot tell apart. Splitting on a key
      // that repeats would make them fight over one document every sync.
      return null;
    }
    seen.add(externalId);
    const published = icsPublishedUrls(block, page.url);
    docs.push({
      externalId,
      uri: externalId,
      title: icsValue(block, 'SUMMARY') || uid,
      content: withoutIcsProperty(block, ICS_EXPORT_STAMP).join('\n'),
      // Feed-wide headers say nothing about one event inside it.
      etag: null,
      lastModifiedAt: null,
      metadata: {
        contentType: page.contentType,
        feedUrl: page.url,
        // Omitted when empty: an entry that publishes no URL must keep writing
        // the metadata it wrote before, or every sync reports a refresh.
        ...(published.length ? { publishedUrls: published } : {}),
      },
    });
  }
  return docs;
}

/**
 * Caps on what a feed entry may declare, so one broken or hostile feed cannot
 * write an arbitrarily large row. `pageMetadata` states boundedness as a hard
 * invariant for this column and caps the HTML path at `LINK_CAP`; `ATTACH`
 * repeats without limit and an unfolded value concatenates every continuation
 * line, so both need a ceiling here. The length is set above any real URL.
 */
const PUBLISHED_URL_CAP = 50;
const PUBLISHED_URL_CHAR_CAP = 2048;

/**
 * Properties whose value is a URL the entry publishes about itself: its page,
 * its attachments, and RFC 7986's `IMAGE`.
 */
const ICS_URL_PROPERTIES = ['URL', 'ATTACH', 'IMAGE'] as const;

/**
 * An exporter's own property for the event's picture, for platforms that ignore
 * `ATTACH` and `IMAGE` (`X-TKF-FEATURED-IMAGE`, `X-WP-IMAGES-URL`). Anchored so
 * a property about an image, such as a credit or alt text, is not read as one.
 */
const ICS_VENDOR_IMAGE_RE = /^X-[A-Z0-9-]*IMAGES?(?:-UR[LI])?$/;

/** A relative reference written as a path, never a bare word like `None`. */
const ICS_RELATIVE_PATH_RE = /^\.{0,2}\//;

/**
 * The URLs a VEVENT publishes about itself: its own page, its attachments, its
 * image, and any picture an exporter writes under its own `X-` image property.
 *
 * A document's URLs are how the extractor tells a link the page really carried
 * from one a model invented. For an HTML page that list is the parsed links;
 * a feed entry is not HTML and had no list at all, so every real URL a
 * calendar entry carries was being discarded downstream.
 *
 * NOT written into `metadata.links`, though the shape would fit: that key has a
 * second consumer in `ScreenshotService.screenshotsFromSite`, which keeps any
 * link with an image extension and offers it as a workspace screenshot. A
 * calendar poster is not a screenshot of the site, so the two provenance
 * classes stay apart.
 *
 * NOT run through `usableUrl` either, deliberately: that rewrites `webcal:` to
 * `https:`, and this list has to match the string the model read out of the raw
 * body, so a rewrite here would break the exact comparison it exists for.
 *
 * Unfolding is not optional. RFC 5545 folds at 75 octets and these values run
 * past 140 characters, so a conformant feed splits its own event URL across
 * lines; read without unfolding it would arrive truncated.
 *
 * A relative value is resolved only for an event the feed's own host wrote. A
 * calendar entry is the one feed shape that travels: a VEVENT can be syndicated
 * far from the host that wrote it, so the feed URL is not always its base, and
 * guessing one is how a wrong link gets published. The event's own absolute
 * `URL` settles it: on the feed's origin, the event is native and a relative
 * attachment means what the standard says, a path on that host; anywhere
 * else, or absent, the relative value is dropped as before.
 * @param block - the VEVENT block's lines, as written in the feed.
 * @param feedUrl - the URL the feed was fetched from.
 */
function icsPublishedUrls(block: string[], feedUrl: string): string[] {
  const vendorImages = new Set(icsLines(block).map(line => line.property).filter(name => ICS_VENDOR_IMAGE_RE.test(name)));
  // Every occurrence, not the first: `ATTACH` repeats per RFC 5545, and a feed
  // that ships inline base64 bytes on the first line and the poster URL on the
  // second would otherwise lose the poster entirely.
  const values = [...ICS_URL_PROPERTIES, ...vendorImages].flatMap(name => icsPublishedValues(block, name));
  const base = icsNativeBase(block, feedUrl);
  const out: string[] = [];
  for (const value of values) {
    if (isFetchableUrl(value)) {
      out.push(value);
      continue;
    }
    if (base && ICS_RELATIVE_PATH_RE.test(value)) {
      const resolved = absoluteUrl(value, base);
      if (resolved && isFetchableUrl(resolved)) {
        out.push(resolved);
      }
    }
  }
  return dedupe(out).slice(0, PUBLISHED_URL_CAP);
}

/**
 * The feed URL, when the event says it was written on the feed's own origin.
 * @param block - the VEVENT block's lines, as written in the feed.
 * @param feedUrl - the URL the feed was fetched from.
 */
function icsNativeBase(block: string[], feedUrl: string): string | undefined {
  const feedOrigin = originOf(feedUrl);
  if (!feedOrigin) {
    return undefined;
  }
  const native = icsPublishedValues(block, 'URL').some(value => isFetchableUrl(value) && originOf(value) === feedOrigin);
  return native ? feedUrl : undefined;
}

/**
 * The origin of a URL, or undefined when it is not one.
 * @param value - an absolute URL.
 */
function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Whether a value has the shape of a URL over http or https.
 *
 * Both halves are needed and neither is enough: zod's `.url()` waves `file://`
 * and `javascript:` through, while the protocol regex alone accepts
 * `https:not a url`.
 * @param value - the raw value.
 */
function isHttpUrl(value: string): boolean {
  return HTTP_URL_RE.test(value) && z.string().url().safeParse(value).success;
}

/**
 * Whether a value is a URL something downstream could actually fetch: the shape
 * test, plus the length a feed entry is allowed to declare.
 *
 * Named for what it tests and deliberately not for what `publishedUrls` means,
 * which is a claim about provenance. The cap is kept here rather than in
 * `isHttpUrl` because it answers "what may this feed write into one metadata
 * row", which is a question only the feed paths ask. The URL-registry connector
 * reads a list a person configured and has no such budget, so a cap applied
 * there would silently drop a long entry nobody asked us to bound.
 * @param value - the raw value.
 */
function isFetchableUrl(value: string): boolean {
  return value.length <= PUBLISHED_URL_CHAR_CAP && isHttpUrl(value);
}

/**
 * Where a content line's name-and-parameters end and its value begins.
 *
 * Not simply the first colon: RFC 5545 lets a parameter value be quoted and a
 * quoted value may contain one, as in `ATTACH;FILENAME="a:b":https://…`.
 * Splitting on the first colon there would cut the value in half, which costs
 * the attachment and, worse, can produce a string that still looks like a URL.
 *
 * An unbalanced quote is not conformant (RFC 5545 excludes a bare DQUOTE from
 * a parameter value, which is why RFC 6868 exists), but a broken feed is not a
 * reason to lose the whole file: a line whose quotes never close falls back to
 * the first colon. Skipping it instead would leave that component with no UID,
 * and `splitIcs` answers a missing UID by abandoning the split for every event
 * in the feed.
 *
 * That fallback is a guess, and it says so. `ATTACH;FILENAME="unclosed:https://…`
 * splits into a value that reads exactly like a URL the event published, which
 * is the forgery the quote-aware scan exists to prevent. Marking the guess lets
 * each reader price it: a guessed `UID` is a usable key and costs nothing,
 * while a guessed URL is a provenance claim nobody made, so `icsPublishedValues`
 * refuses it.
 * @param line - one content line, as written in the feed.
 */
function icsValueColon(line: string): { colon: number; guessed: boolean } {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ':' && !quoted) {
      return { colon: i, guessed: false };
    }
  }
  return quoted ? { colon: line.indexOf(':'), guessed: true } : { colon: -1, guessed: false };
}

/** A line that continues the one above it, per RFC 5545 folding. */
const ICS_FOLD_RE = /^[ \t]/;

/**
 * One occurrence of a property, unfolded, with what the scanner knows about
 * it: whether the event itself wrote it rather than a component nested inside
 * it, and whether the split between its name and its value had to be guessed.
 */
type IcsProperty = { value: string; own: boolean; guessed: boolean };

/**
 * Where one property sits in the block: the line that names it and the span it
 * occupies, its folded continuations included, `end` exclusive.
 */
type IcsLine = { property: string; colon: number; guessed: boolean; start: number; end: number };

/**
 * Split a block into its properties without reading any of them.
 *
 * One scan, because two callers need the same answer about where a property
 * begins and ends: the value reader below, and the filter that drops a
 * property before the block is hashed.
 *
 * A line with no colon to split on is left out entirely, so a caller that
 * removes lines never removes one it could not parse. `guessed` covers the
 * weaker case, a line whose quotes never closed: the name is still read from
 * the text before the first `;`, which is why dropping such a line is safe
 * while believing its value is not.
 * @param lines - the block's lines, starting at its own `BEGIN:`.
 */
function icsLines(lines: string[]): IcsLine[] {
  const out: IcsLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (ICS_FOLD_RE.test(line)) {
      continue;
    }
    const { colon, guessed } = icsValueColon(line);
    if (colon < 0) {
      continue;
    }
    let end = i + 1;
    while (end < lines.length && ICS_FOLD_RE.test(lines[end]!)) {
      end += 1;
    }
    out.push({ property: line.slice(0, colon).split(';')[0]!.toUpperCase(), colon, guessed, start: i, end });
  }
  return out;
}

/**
 * The block without one property, continuations and all.
 *
 * Matching is on the name alone, so `DTSTAMP;X-VENDOR=1:` and a lowercase
 * `dtstamp:` go the same way as the plain form, which is what RFC 5545 means
 * by a case-insensitive name carrying parameters.
 * @param lines - the block's lines, starting at its own `BEGIN:`.
 * @param name - the property name, uppercase.
 */
function withoutIcsProperty(lines: string[], name: string): string[] {
  const drop = new Set<number>();
  for (const span of icsLines(lines)) {
    if (span.property !== name) {
      continue;
    }
    for (let i = span.start; i < span.end; i += 1) {
      drop.add(i);
    }
  }
  return drop.size === 0 ? lines : lines.filter((_, i) => !drop.has(i));
}

/**
 * Every occurrence of one property in a VEVENT block, unfolded, each marked
 * with whether it is the event's own.
 *
 * Unfolding is unconditional because RFC 5545 section 3.1 makes a fold an
 * artifact of how the line was written down, never part of the value: a value
 * read without unfolding is simply truncated, whether it is a URL or a title.
 *
 * Ownership is tracked by name, not by counting: `END:` closes a component
 * only when it names the one still open. A feed that writes a stray `END:` in
 * the middle of a VEVENT would otherwise leave the counter permanently off by
 * one, and every property after it would read as somebody else's, including
 * `UID`, which `splitIcs` answers by abandoning the split for the whole file.
 * Trading one wrong image for every document of a source is not a trade worth
 * making, so a mismatched `END:` is ignored rather than believed.
 * @param lines - the block's lines, starting at its own `BEGIN:`.
 * @param name - the property name, uppercase.
 */
function icsProperties(lines: string[], name: string): IcsProperty[] {
  const out: IcsProperty[] = [];
  // The block opens with its own `BEGIN:VEVENT`, so while only that is open the
  // properties are the event's; anything deeper belongs to a component inside.
  const open: string[] = [];
  for (const { property, colon, guessed, start, end } of icsLines(lines)) {
    const line = lines[start]!;
    if (property === 'BEGIN') {
      open.push(line.slice(colon + 1).trim().toUpperCase());
      continue;
    }
    if (property === 'END') {
      if (open[open.length - 1] === line.slice(colon + 1).trim().toUpperCase()) {
        open.pop();
      }
      continue;
    }
    if (property !== name) {
      continue;
    }
    let value = line.slice(colon + 1);
    for (let j = start + 1; j < end; j += 1) {
      value += lines[j]!.slice(1);
    }
    out.push({ value: value.trim(), own: open.length === 1, guessed });
  }
  return out;
}

/**
 * Every occurrence of one property that the event itself certainly published.
 *
 * Two exclusions, both about not putting words in a document's mouth. A
 * `VEVENT` carries its alarms inside it and an alarm has its own `ATTACH`, so a
 * reader that ignored nesting would declare an alarm's sound file as a URL the
 * event published. And a line whose quotes never closed was split by guesswork,
 * which can manufacture a string that reads like a URL out of a filename
 * parameter; the extractor's gate would then bless a link nobody published.
 * @param lines - the block's lines, starting at its own `BEGIN:`.
 * @param name - the property name, uppercase.
 */
function icsPublishedValues(lines: string[], name: string): string[] {
  return icsProperties(lines, name).filter(p => p.own && !p.guessed).map(p => p.value);
}

/**
 * Read one property out of a VEVENT block: the event's own where it has one,
 * and otherwise the first found at any depth.
 *
 * Both halves are load-bearing, and each covers the other's failure. Preferring
 * the event's own matters because a nested component may carry the same
 * property name: RFC 9074 gives a `VALARM` its own `UID`, and an `ACTION:EMAIL`
 * alarm carries a `SUMMARY` that is the mail subject, so a feed writing its
 * alarm above the event's own lines would otherwise key and title the document
 * from the alarm. Falling back to any depth matters because a block whose
 * components do not balance still has a `UID` we would rather find than lose
 * every document of the source over, which is what `splitIcs` does when the key
 * comes back empty.
 * @param lines - the block's lines, starting at its own `BEGIN:`.
 * @param name - the property name, uppercase.
 */
function icsValue(lines: string[], name: string): string {
  const found = icsProperties(lines, name);
  return (found.find(p => p.own) ?? found[0])?.value ?? '';
}

/**
 * Keys a JSON feed is known to keep its entries under, most trusted first.
 *
 * A tie-breaker, not the rule. Naming one CMS's vocabulary as *the* place to
 * look would put a concretion in shared core; what actually identifies a feed's
 * entries is their shape, and this list only decides which of two equally
 * entry-shaped keys a publisher meant. `upcoming` earns its place at the front
 * because a Squarespace collection publishes it beside `past` and both are real
 * arrays of real entries, so shape alone cannot separate them.
 */
const FEED_ARRAY_PATHS = ['upcoming', 'items', 'events', 'data'] as const;

/**
 * The value, when it is a list of entries rather than a list of anything else.
 *
 * Entries are objects. A bare array of strings is a page's navigation labels or
 * a registry of URLs, and splitting one gives a document whose whole content is
 * `"Home"`, hashed for an id, embedded, and sent to the model, which can only
 * answer that there is no event in it. Emptiness is not entry-shaped either: a
 * feed with nothing in it today is a feed to leave whole, not one to split into
 * no documents at all.
 * @param value - a candidate array from the body.
 */
function entryArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  // Anything that is not an object is a hole and is dropped: a null, a number,
  // a stray label. What decides the array is whether any entry survives that,
  // so a list of nothing but strings is a navigation menu and no feed at all,
  // while a good list with one hole in it still splits. Demanding that every
  // element be an entry would let one hole cost the split for the whole source,
  // which puts it back on a single whole-file document, and only the first
  // `PAGE_CHAR_CAP` characters of that ever reach a model.
  const entries = value.filter(isRecord);
  return entries.length > 0 ? entries : null;
}

/**
 * The entries of a JSON feed, whether the body is the array or wraps one.
 *
 * A bare array is the easy case. Squarespace, and every CMS that answers a
 * listing with its whole page model, returns an object instead: the site's
 * settings, its navigation, and the entries under a key. Refusing those left
 * the entire page model as one document, and since only the first
 * `PAGE_CHAR_CAP` characters reach the model, what it read was the site
 * settings and never an event. `looksLikeFeed` already admits such a body, so
 * refusing to split it was the connector disagreeing with itself.
 *
 * Which key holds them is decided by shape: any key whose value is a non-empty
 * array of objects is a candidate, and a body that names none of the known keys
 * is still split on whatever key its entries are under. `FEED_ARRAY_PATHS` only
 * settles which of several candidates was meant, which is what keeps a vendor's
 * vocabulary from deciding anything on its own: a sibling `past` array loses
 * without ever being named, because `upcoming` is the more trusted of two
 * equals.
 *
 * Deliberately NOT built on `arrayFromBody`: that helper answers a different
 * question for the URL-registry connector and carries a `urls` fallback of its
 * own, which would quietly outrank every key here and split a feed on its link
 * registry instead of its events.
 * @param page - the fetched feed.
 */
function feedEntries(page: FetchedPage): unknown[] | null {
  if (!page.contentType.includes('json')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(page.raw);
  } catch {
    return null;
  }
  const bare = entryArray(parsed);
  if (bare || !isRecord(parsed)) {
    return bare;
  }
  for (const path of FEED_ARRAY_PATHS) {
    const entries = entryArray(parsed[path]);
    if (entries) {
      return entries;
    }
  }
  // A known key present but empty is the feed answering "nothing today", not
  // failing to answer, so the file stays whole rather than falling through to a
  // sibling. Otherwise the day a listing's last entry ages out, every document
  // of the source is swapped for whatever the archive key holds and swapped
  // back when the next one is published: two tombstone-and-re-embed cycles,
  // plus a model call per stale entry, since the pipeline only learns an entry
  // is stale after a model has read it.
  if (FEED_ARRAY_PATHS.some(path => Array.isArray(parsed[path]) && parsed[path].length === 0)) {
    return null;
  }
  const first = Object.keys(parsed).find(key => entryArray(parsed[key]));
  return first === undefined ? null : entryArray(parsed[first]);
}

/**
 * Sentinels for the two kinds of break we add on purpose, so the whitespace
 * pass can flatten the newlines that merely came from the source markup
 * without flattening ours. They are private-use code points, which no real
 * page has any business containing, and they are scrubbed out of the input
 * first so neither a page nor a feed entry can smuggle one in.
 */
const PARAGRAPH_MARK = '';
const LINE_MARK = '';
const OWN_MARKS = /[]/g;
const PARAGRAPH_MARK_RE = / ? ?/g;
const LINE_MARK_RE = / ? ?/g;

/** Counters a feed moves on every view, never an edit (Localist's view and attendance counts). */
const ITEM_VOLATILE_FIELDS: ReadonlySet<string> = new Set(['detail_views', 'num_attending']);

/** A string carrying markup rather than describing one. */
const MARKUP_RE = /<[a-z!/][^>]*>/i;

/**
 * The window a millisecond timestamp falls in, 2001 to 2033. Narrow on purpose:
 * it is what keeps a price, a count or an identifier from being read as a date
 * however its key is spelled.
 */
const EPOCH_MS_MIN = 1_000_000_000_000;
const EPOCH_MS_MAX = 2_000_000_000_000;

/**
 * The last word of a key that means the value is a moment in time.
 *
 * A word, not a suffix, because a suffix test on `at` or `on` also matches
 * `format`, `season`, `location` and `lat`. `publishOn`, `created_at`,
 * `startDate` and `endTime` all end on one of these; `duration` and `version`
 * end on none.
 */
const TIME_WORDS = new Set(['at', 'on', 'date', 'time', 'timestamp']);

/**
 * Whether a key names a moment rather than a number.
 * @param key - the key the value sat under.
 */
function namesATime(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_\-.]+/);
  return TIME_WORDS.has(words[words.length - 1] ?? '');
}

/**
 * The text a markup string says, breaks kept.
 *
 * `body` is read rather than the root so a fragment that opens with a
 * head-level tag does not fold that tag's text into the entry's prose, and the
 * page's own break marks are scrubbed first so a feed cannot inject them.
 * @param value - a string containing markup.
 */
function textFromMarkup(value: string): string {
  const $ = load(value.replace(OWN_MARKS, ' '));
  $('script,style,noscript').remove();
  markBreaks($);
  return collapse($('body').text());
}

/**
 * One line of what a markup string says.
 * @param value - a string that may contain markup.
 */
function plainText(value: string): string {
  return MARKUP_RE.test(value) ? flatten(textFromMarkup(value)) : value;
}

/**
 * The entry as it reads: markup reduced to the text it renders, a millisecond
 * timestamp written as the instant it names, view counters left out.
 *
 * Applied to the text a document carries, never to the values its identity is
 * read from. A feed's markup is the same prose rewritten by whatever built the
 * page that morning — a stylesheet hash inside an attribute, an asset version,
 * a wrapper class — so hashing it verbatim reports an edit on a request that
 * changed nothing, and a pipeline that runs a model per changed document pays
 * for every one. The rendered text is what actually changed or did not. It is
 * also what a reader, human or model, was going to read anyway: an epoch
 * integer is a date nobody can check, and the markup is several times the size
 * of the words inside it.
 * @param value - any JSON value from the entry.
 * @param key - the key it sat under, where it had one.
 */
function readable(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    return MARKUP_RE.test(value) ? textFromMarkup(value) : value;
  }
  if (typeof value === 'number') {
    const isInstant = key !== undefined
      && namesATime(key)
      && Number.isInteger(value)
      && value >= EPOCH_MS_MIN
      && value <= EPOCH_MS_MAX;
    return isInstant ? new Date(value).toISOString() : value;
  }
  if (Array.isArray(value)) {
    return value.map(entry => readable(entry, key));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => !ITEM_VOLATILE_FIELDS.has(k))
      .map(([k, v]) => [k, readable(v, k)]));
  }
  return value;
}

/**
 * Split a feed's entries into one document each, keyed by the entry's own
 * identifier where it has one and by a hash of the entry where it does not,
 * never by its position in the array.
 * @param page - the fetched feed.
 * @param items - the entries, as `feedEntries` found them.
 */
function splitJsonArray(page: FetchedPage, items: unknown[]): IngestDoc[] | null {
  if (!items.length) {
    // Unreachable from the one caller, because `feedEntries` answers only with
    // null or a non-empty list. Kept rather than dropped because of what
    // breaking that invariant would cost: falling through would return an empty
    // array, which is a connector yielding zero documents, which tombstones
    // everything the source owns. Answering null costs one whole-file document.
    return null;
  }
  const docs: IngestDoc[] = [];
  const seen = new Set<string>();
  // An envelope's inner key is used only where it is unique in this feed: a
  // repeat with no occurrence to tell it apart keeps the content hash, since a
  // collision would abandon the split for the whole file.
  const enveloped = items.map(item => (declaredKey(item) === undefined ? envelopedKey(item) : undefined));
  const envelopedCount = new Map<string, number>();
  for (const key of enveloped) {
    if (key) {
      envelopedCount.set(key, (envelopedCount.get(key) ?? 0) + 1);
    }
  }
  for (const [index, item] of items.entries()) {
    // The entry as written is what identity is read from: keying on the
    // readable form would re-key every document of a feed that publishes no id
    // of its own, and a moved key is not an update, it is a tombstone and a
    // new document that costs another model call.
    const body = JSON.stringify(item) ?? 'null';
    const inner = enveloped[index];
    const key = declaredKey(item)
      ?? (inner && envelopedCount.get(inner) === 1 ? inner : undefined)
      ?? createHash('sha256').update(body).digest('hex').slice(0, 16);
    const externalId = `${page.url}#${key}`;
    if (seen.has(externalId)) {
      return null;
    }
    seen.add(externalId);
    const published = declaredUrls(item, page.url);
    const declared = declaredTitle(item);
    docs.push({
      externalId,
      uri: externalId,
      title: declared === undefined ? key : plainText(declared),
      content: JSON.stringify(readable(item)) ?? body,
      etag: null,
      lastModifiedAt: null,
      metadata: {
        contentType: page.contentType,
        feedUrl: page.url,
        ...(published.length ? { publishedUrls: published } : {}),
      },
    });
  }
  return docs;
}

/** Keys a JSON feed item might state its own identity with, in order of trust. */
const ITEM_KEY_FIELDS = ['@id', 'id', 'slug'] as const;

/** Where an entry names which occurrence of a recurring record it is (Localist's `event_instances`). */
const ITEM_OCCURRENCE_FIELDS = ['event_instances'] as const;
/** Keys a JSON feed item might state its own name with, in order of trust. */
const ITEM_TITLE_FIELDS = ['name', 'title', 'summary'] as const;
/**
 * Keys a JSON feed item might publish a URL of its own with.
 *
 * `fullUrl` and `assetUrl` are what a Squarespace entry uses, and they are the
 * reason this list resolves relative values: `fullUrl` is a path, `/events/x`,
 * and the gate it feeds compares exactly, so an unresolved path can never
 * match what a model read and would drop the link it exists to keep.
 *
 * `imageUrl` is here because it is the extractor's own field name: an entry
 * that publishes its poster under the very key the pipeline reads it back out
 * of would otherwise lose it, which is the defect this whole list exists for.
 *
 * `localist_url` and `photo_url` are Localist's.
 */
const ITEM_URL_FIELDS = [
  'url',
  'link',
  'fullUrl',
  'localist_url',
  'image',
  'imageUrl',
  'thumbnail',
  'assetUrl',
  'photo_url',
] as const;

/**
 * A value with no `/`, `.` or `:` cannot be a link, whatever key it sits under.
 * Localist writes the string "None" into `url`; resolving a bare word against
 * the feed invents an address the document never published.
 */
const UNLINKABLE_VALUE_RE = /^[^/.:]*$/;

/**
 * The record an entry's links live on, unwrapping a single-key envelope.
 *
 * Read by `declaredUrls`, and by `envelopedKey` for an entry with no key of
 * its own.
 *
 * The inner record has to carry a title, which is what separates an entry from
 * a nested value: `{"image": {"url": …, "id": …}}` has an id and is still not
 * an entry, and declaring its url would claim provenance one level down.
 * @param item - one entry from the array.
 */
function entryFields(item: unknown): Record<string, unknown> | undefined {
  if (!isRecord(item)) {
    return undefined;
  }
  const keys = Object.keys(item);
  if (keys.length !== 1) {
    return item;
  }
  const inner = item[keys[0]!];
  if (!isRecord(inner)) {
    return item;
  }
  return ITEM_TITLE_FIELDS.some(f => typeof inner[f] === 'string') ? inner : item;
}

/**
 * The key of an entry wrapped in a one-key envelope: the inner record's id,
 * with the id of the occurrence it lists when it names one, since a recurring
 * record repeats its id on every occurrence.
 * @param item - one entry from the array.
 */
function envelopedKey(item: unknown): string | undefined {
  const fields = entryFields(item);
  if (!fields || fields === item) {
    return undefined;
  }
  const id = declaredKey(fields);
  if (!id) {
    return undefined;
  }
  for (const name of ITEM_OCCURRENCE_FIELDS) {
    const list = fields[name];
    const first: unknown = Array.isArray(list) ? list[0] : undefined;
    const occurrence = declaredKey(isRecord(first) && Object.keys(first).length === 1 ? Object.values(first)[0] : first);
    if (occurrence) {
      return `${id}~${occurrence}`;
    }
  }
  return id;
}

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

/**
 * The URLs the item publishes about itself, for the same reason
 * `icsPublishedUrls` exists: a JSON entry is not HTML, so nothing else in the
 * pipeline knows which links it really carried.
 *
 * Only top-level string values are read. A URL nested inside an object is left
 * alone rather than guessed at, because the shape of a feed item is the
 * publisher's to choose and walking it would turn this into a parser.
 *
 * Bounded twice over. The field list is fixed, and `PUBLISHED_URL_CAP` is
 * applied on top of it, so the bound on how many URLs one entry may declare
 * survives someone adding a field to the list. `PUBLISHED_URL_CHAR_CAP`, inside
 * `isFetchableUrl`, bounds each value's length rather than the count.
 * @param item - one entry from the array.
 * @param baseUrl - the feed's own URL, which a relative value resolves against.
 */
function declaredUrls(item: unknown, baseUrl: string): string[] {
  const fields = entryFields(item);
  if (!fields) {
    return [];
  }
  const out: string[] = [];
  for (const field of ITEM_URL_FIELDS) {
    const value = fields[field];
    if (typeof value !== 'string') {
      continue;
    }
    // Resolved against the feed's own URL, which is where the entry was
    // published. A base that will not parse leaves the value as written, and
    // a path that stays a path then fails the fetchable test below.
    if (UNLINKABLE_VALUE_RE.test(value.trim())) {
      continue;
    }
    const url = absoluteUrl(value, baseUrl) ?? '';
    if (isFetchableUrl(url)) {
      out.push(url);
    }
  }
  // A CMS export routinely repeats one link under two keys, so the dedupe is
  // what keeps the stored row honest rather than a formality.
  return dedupe(out).slice(0, PUBLISHED_URL_CAP);
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
 * here, these are candidates, and the caller probes them silently.
 *
 * Candidates are scoped to the listing, see `describesTheListing`, because a
 * feed declared in the head of every page on a site is about the site.
 * @param page - the fetched listing page.
 * @param ctx - the sync context, for the note naming a candidate the scope rule dropped.
 */
function discoverFeeds(page: FetchedPage, ctx: SourceContext): FeedCandidate[] {
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
  // head, "Add to calendar" buttons, mostly.
  for (const link of page.structure?.links ?? []) {
    if (ICS_PATH_RE.test(link.url) || link.url.toLowerCase().startsWith('webcal:') || ICAL_QUERY_RE.test(link.url)) {
      add(link.url, 'ics');
    }
  }
  if (SQUARESPACE_MARKERS.some(marker => page.raw.includes(marker))) {
    add(withFormatJson(page.url), 'json');
  }

  const landedListing = listingAsLanded(page).toString();
  const eligible = found.filter((candidate) => {
    if (describesTheListing(candidate, page.url) || (landedListing !== page.url && describesTheListing(candidate, landedListing))) {
      return true;
    }
    runNote(ctx, candidate.url, `source: skipped ${candidate.kind} feed outside the listing path ${candidate.url}`);
    return false;
  });

  // Stable sort: same kind keeps document order.
  return eligible.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/**
 * A trailing `index`, `index.html`, `index.php` on a listing path: the file
 * that IS the directory, so scoping keeps the directory rather than the file.
 */
const INDEX_SEGMENT_RE = /(^|\/)index(?:\.\w+)?$/i;

/**
 * Whether `url` sits at the listing's own path or under it.
 *
 * The path and nothing else. The query string is deliberately not part of the
 * test, which is what makes a listing's own paginated pages count as its own:
 * Ashby Library's `/index.php/calendar-of-events?month=10&year=2026` is the
 * next month of the very listing being read, while `/index.php/services/notary`
 * is another corner of the site. A trailing index segment is stripped first,
 * so the file that IS the directory scopes to the directory.
 *
 * Shared by the two rules that ask "is this about THIS listing":
 * `describesTheListing`, which drops a site-wide feed, and `crawl`, which
 * queues the listing's own pages ahead of the rest of the origin.
 * @param url - the URL being placed.
 * @param listing - the listing it is measured against.
 */
function isUnderListingPath(url: URL, listing: URL): boolean {
  const path = listing.pathname.replace(INDEX_SEGMENT_RE, '$1');
  const directory = path.endsWith('/') ? path : `${path}/`;
  return url.pathname === path || url.pathname.startsWith(directory);
}

/**
 * The listing a fetched page stands for once its redirect is followed: where
 * it landed, unless that path is an ancestor of the one requested, so a
 * listing that redirects to its site root never widens its scope to the site.
 * @param page - the fetched listing.
 */
function listingAsLanded(page: FetchedPage): URL {
  const landed = new URL(page.base);
  const requested = new URL(page.url);
  const broader = landed.pathname !== requested.pathname && isUnderListingPath(requested, landed);
  return broader ? new URL(requested.pathname, landed.origin) : landed;
}

/**
 * Whether a discovered feed describes THIS listing rather than the whole site.
 *
 * The test is the URL path and nothing else: a feed counts when it sits at the
 * listing's own path or under it, on the same origin. Bellwater Hall's calendar
 * at `/calendar/` declares `https://bellwaterhall.example/feed/` in its head,
 * the WordPress blog feed every page on that site declares, and the second dev
 * shadow (2026-09-15) took it: the whole source became ONE document of 1,460
 * characters of blog posts and zero events, while the shows sat unread on the
 * listing. Mill Creek declares `/feed/` and `/comments/feed/` the same way.
 *
 * An `ics` candidate is exempt, `webcal:` included, since that is rewritten to
 * `https:` and reaches here as `ics`. A calendar feed is a calendar wherever a
 * site parks it, it cannot be about anything but events, and it is the kind
 * worth most: Mill Creek's `/events/?ical=1` is the 26 events the run takes.
 * A Squarespace `?format=json` candidate is the listing URL itself, so it
 * passes on the paths being equal.
 * @param candidate - the discovered feed.
 * @param listingUrl - the listing it was discovered on, as requested or as landed on the same site.
 */
function describesTheListing(candidate: FeedCandidate, listingUrl: string): boolean {
  if (candidate.kind === 'ics') {
    return true;
  }
  let feed: URL;
  let listing: URL;
  try {
    feed = new URL(candidate.url);
    listing = new URL(listingUrl);
  } catch {
    return false;
  }
  if (feed.origin !== listing.origin) {
    return false;
  }
  return isUnderListingPath(feed, listing);
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
 * The same page asked for as JSON, the Squarespace listing answer.
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
      return feedEntries(page) !== null || jsonObjectBody(page);
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
 * True when the listing's own JSON-LD already describes events, a signal
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
 * `structure` is the same walk's structured half, the parsed JSON-LD, the
 * og:image and every URL the page published, kept instead of thrown away.
 * It is optional on the return type because the callers write
 * `{ title: undefined, content: raw, structure: undefined }` for non-HTML
 * bodies.
 *
 * The og:image is declared on `structure` and is deliberately absent from
 * `content`. `content` is what the ingest hashes to decide a page changed, and
 * plenty of sites version that URL by the day they served it, which turns an
 * unchanged page into a changed document every morning. A reader that wants
 * the image reads `structure.ogImage`, which is where it always was.
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

  return { title, content: parts.join('\n\n'), structure };
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
    // data attribute, so the first usable candidate wins. Bellwater Hall does
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
 * Walk the site from the seed page, same origin only, bounded by `maxDepth`
 * and the sync's shared `maxPages`, with optional path filters.
 *
 * `maxPages` bounds pages ATTEMPTED, not pages ingested: the cost this cap
 * exists to control is requests, and a site answering 500 for half its detail
 * pages should not buy itself an unbounded crawl. The counter belongs to the
 * sync rather than to one crawl, because a source may have several seeds.
 *
 * The crawl starts at the SEED, not at `cfg.startUrl`: with a list of seeds
 * they are not the same URL, and the origin the same-origin rule is read
 * against is the seed's, where its redirect landed when that stayed on the site.
 *
 * A page's links are queued in two batches, the seed's own path first and the
 * rest of the origin after, each in page order. See the partition below.
 * @param cfg - the crawl config, defaults already applied.
 * @param ctx - the sync context.
 * @param seed - the start page, already fetched (and already counted) by the caller.
 * @param pages - the sync's shared page budget.
 * @yields {IngestDoc} one document per page the crawl reaches.
 */
async function* crawl(
  cfg: CrawlConfig,
  ctx: SourceContext,
  seed: FetchedPage,
  pages: PageBudget,
): AsyncIterable<IngestDoc> {
  const startUrl = seed.url;
  const start = listingAsLanded(seed);
  const startOrigin = start.origin;
  const visited = new Set<string>();
  const queue: QueueEntry[] = [{ url: startUrl, depth: 0 }];
  let pending: FetchedPage | undefined = seed;
  while (queue.length && pages.attempted < cfg.maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) {
      continue;
    }
    visited.add(url);
    const prefetched = pending?.url === url ? pending : undefined;
    pending = undefined;
    if (!prefetched) {
      pages.attempted += 1;
    }
    const page = prefetched ?? await fetchPage(url, ctx);
    if (page) {
      visited.add(page.base);
      for (const doc of docsFromPage(page, ctx)) {
        yield doc;
      }
    }
    if (!page || depth >= cfg.maxDepth) {
      // Nothing to read links out of, and `fetchPage` has already reported why
      // , as a connector-scope error for a real failure, which is what keeps
      // the runner from treating a half-read listing as a complete run and
      // hard-deleting last run's detail documents.
      continue;
    }
    // The link pass reads the body we already hold. It used to be a SECOND raw
    // fetch of the same URL whose every failure was swallowed by
    // `.catch(() => '')`: one extra request per source, and a silent one whose
    // failure left the run looking complete with only the listing handled.

    // A stable PARTITION of this page's links, not a filter: the seed's own
    // path first, the rest of the origin after, each in page order. Every
    // filter still runs first and nothing that was followable becomes
    // unfollowable, so with budget to spare the crawl reaches exactly what it
    // reached before, in a different order.
    //
    // Order is what a spent budget turns into content. The queue is FIFO and a
    // site's chrome is its first markup, collected before chrome removal on
    // purpose. Ashby Library's calendar (third dev shadow, 2026-09-15) crawled
    // 60 pages and only 3 of them were calendar pages: the listing twice and
    // one PAST month. The other 50-odd were the Joomla sidebar menu,
    // `/services/`, `/digital-library/`, `/library-policies/`, `/learn/`,
    // `/about-us/`, none of which has ever held an event.
    const ownPath: QueueEntry[] = [];
    const elsewhere: QueueEntry[] = [];
    const base = new URL(page.base).origin === startOrigin ? page.base : page.url;
    for (const href of pageLinks(page, base)) {
      try {
        const next = new URL(href, base);
        // Strip fragments so #section links don't blow up the queue.
        next.hash = '';
        if (next.origin === startOrigin && !visited.has(next.toString()) && followable(next, cfg)) {
          (isUnderListingPath(next, start) ? ownPath : elsewhere).push({ url: next.toString(), depth: depth + 1 });
        }
      } catch {
        /* malformed href, skip */
      }
    }
    // One at a time rather than a spread: neither the page body nor
    // `collectLinks` caps how many links a page may publish, and a spread of
    // that array is an argument list.
    for (const batch of [ownPath, elsewhere]) {
      for (const entry of batch) {
        queue.push(entry);
      }
    }
  }
}

/** One page waiting to be crawled, and how many hops from the seed it sits. */
type QueueEntry = { url: string; depth: number };

/**
 * The links to consider following out of a fetched page.
 * @param page - the fetched page.
 * @param base - the URL its relative links resolve against.
 */
function pageLinks(page: FetchedPage, base: string): string[] {
  if (page.structure && base !== page.url) {
    return collectLinks(load(page.raw.replace(OWN_MARKS, ' ')), base).map(link => link.url);
  }
  if (page.structure) {
    return page.structure.links?.map(link => link.url) ?? [];
  }
  // Non-HTML bodies never went through cheerio. The old regex still covers the
  // odd page served as text/plain with markup inside it.
  return extractLinks(page.raw, base);
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
 * There is nowhere else to put a string, the checkpoint's `counts` is
 * `Record<string, number>` and `cursor` is nulled every run.
 * @param ctx - the sync context.
 * @param uri - the URL the line is about, when there is one.
 * @param message - the line.
 */
function runNote(ctx: SourceContext, uri: string | undefined, message: string): void {
  ctx.onProgress?.({ kind: 'skipped', uri, message });
}
