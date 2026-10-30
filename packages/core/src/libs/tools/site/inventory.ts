/**
 * A site inventory: every page a site has, with the basics an SEO reads
 * first — status, title, meta description, H1, canonical, noindex, word count
 * and schema.org types — and what is missing or duplicated across them.
 *
 * The URL list comes from the site's own sitemap (nested sitemap indexes
 * followed, Squarespace's and WordPress's included), then from the `Sitemap:`
 * lines of robots.txt, and only then from a crawl. A crawl sees what the menu
 * links to; a sitemap sees every page, which is the point of an inventory.
 * Each page is read once (`extractPageFacts`), a few at a time, up to a cap
 * that is stated whenever it is hit.
 *
 * Fetching is injected (`InventoryFetchers`) so every rule here runs on
 * recorded fixtures; the tool (`services/agents/tools/siteInventory.ts`)
 * supplies the guarded network reads.
 */

import type { PageFacts } from '@/libs/tools/serp/pageFacts';
import { load } from 'cheerio';
import { mapWithConcurrency } from '@/libs/concurrency';
import { extractPageFacts } from '@/libs/tools/serp/pageFacts';

/** Pages read when the caller names no cap. */
export const DEFAULT_INVENTORY_CAP = 300;
/** Pages read at once: polite to the site, quick enough for a turn. */
export const INVENTORY_CONCURRENCY = 6;
/** Sitemap files followed at most, nested indexes included. */
const MAX_SITEMAPS = 50;

export type InventoryFetchers = {
  /** A text file (a sitemap, robots.txt), or null when the site has none. */
  fetchText: (url: string) => Promise<string | null>;
  /** A page's HTML and the URL finally read; null when it is not HTML. Throws on failure, with `status` for an HTTP error. */
  fetchHtml: (url: string) => Promise<{ url: string; html: string } | null>;
  /** URLs a crawl from the home page finds, for a site with no sitemap. */
  crawl: (start: string, maxPages: number) => Promise<string[]>;
};

export type InventorySource = 'sitemap' | 'robots' | 'crawl';

export type InventoryRow = {
  url: string;
  /** HTTP status: 200 when read; the error's status; null when the site did not answer. */
  status: number | null;
  /** Where a redirect landed, when it did. */
  redirectedTo?: string;
  /** Why it could not be read. */
  error?: string;
  title: string | null;
  metaDescription: string | null;
  /** The first H1, and how many the page has. */
  h1: string | null;
  h1Count: number;
  canonical: string | null;
  noindex: boolean;
  wordCount: number | null;
  schemaTypes: string[];
};

export type SiteInventory = {
  site: string;
  readAt: string;
  from: InventorySource;
  /** The sitemap files read, in order. */
  sitemaps: string[];
  /** URLs the site listed (after leaving out other hosts and files). */
  listed: number;
  /** The cap, when `listed` passed it. */
  cappedAt?: number;
  rows: InventoryRow[];
};

/**
 * A site as an origin: a bare domain gets https.
 * @param site - "northwind-home.example" or a URL.
 */
export function siteOrigin(site: string): string {
  const s = site.trim();
  return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).origin;
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Files a sitemap may list that are not pages. */
const NOT_A_PAGE = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|mp[34]|mov|webm|xml|txt|docx?|xlsx?|pptx?|csv|json)$/i;

/**
 * The page URLs and the nested sitemaps one sitemap file lists. Reads a
 * `<urlset>` (only each `<url>`'s own `<loc>`, never an image's) and a
 * `<sitemapindex>`. Pure.
 * @param xml - The file.
 */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const $ = load(xml, { xml: true });
  const text = (els: ReturnType<typeof $>) => els.toArray().map(el => $(el).text().trim()).filter(Boolean);
  return { urls: text($('urlset > url > loc')), sitemaps: text($('sitemapindex > sitemap > loc')) };
}

/**
 * The `Sitemap:` lines of a robots.txt, in order. Pure.
 * @param robots - The file.
 */
export function robotsSitemaps(robots: string): string[] {
  return robots.split(/\r?\n/).map(l => /^\s*sitemap\s*:\s*(\S+)/i.exec(l)?.[1]).filter((u): u is string => Boolean(u));
}

/**
 * Follow sitemaps from the given files, nested indexes included, until the
 * files run out or `MAX_SITEMAPS` were read.
 * @param start - The first sitemap URLs.
 * @param f - The fetchers.
 */
async function walkSitemaps(start: string[], f: InventoryFetchers): Promise<{ urls: string[]; read: string[] }> {
  const queue = [...start];
  const seen = new Set<string>();
  const read: string[] = [];
  const urls: string[] = [];
  while (queue.length && read.length < MAX_SITEMAPS) {
    const next = queue.shift()!;
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    const xml = await f.fetchText(next).catch(() => null);
    if (!xml) {
      continue;
    }
    const parsed = parseSitemap(xml);
    if (parsed.urls.length === 0 && parsed.sitemaps.length === 0) {
      continue;
    }
    read.push(next);
    urls.push(...parsed.urls);
    queue.push(...parsed.sitemaps);
  }
  return { urls, read };
}

/**
 * The site's pages: same host, http(s), not a file, each once, in the
 * order the site listed them. Pure.
 * @param origin - The site.
 * @param urls - What was listed.
 */
export function sitePages(origin: string, urls: readonly string[]): string[] {
  const host = hostOf(origin);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw.trim(), origin);
    } catch {
      continue;
    }
    u.hash = '';
    if (!/^https?:$/.test(u.protocol) || hostOf(u.toString()) !== host || NOT_A_PAGE.test(u.pathname)) {
      continue;
    }
    const key = `${hostOf(u.toString())}${u.pathname.replace(/\/$/, '')}${u.search}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(u.toString());
    }
  }
  return out;
}

/**
 * Where the site's pages are listed: its sitemap, else the sitemaps its
 * robots.txt names, else a crawl.
 * @param origin - The site.
 * @param f - The fetchers.
 * @param cap - Pages wanted at most (bounds the crawl).
 */
export async function discoverPages(origin: string, f: InventoryFetchers, cap: number): Promise<{ urls: string[]; from: InventorySource; sitemaps: string[] }> {
  const direct = await walkSitemaps([`${origin}/sitemap.xml`], f);
  const fromDirect = sitePages(origin, direct.urls);
  if (fromDirect.length) {
    return { urls: fromDirect, from: 'sitemap', sitemaps: direct.read };
  }
  const robots = await f.fetchText(`${origin}/robots.txt`).catch(() => null);
  const named = robots ? robotsSitemaps(robots).filter(u => !direct.read.includes(u)) : [];
  if (named.length) {
    const viaRobots = await walkSitemaps(named, f);
    const pages = sitePages(origin, viaRobots.urls);
    if (pages.length) {
      return { urls: pages, from: 'robots', sitemaps: viaRobots.read };
    }
  }
  return { urls: sitePages(origin, await f.crawl(`${origin}/`, cap)), from: 'crawl', sitemaps: [] };
}

/**
 * One page's row from its facts. Pure.
 * @param url - The URL listed.
 * @param finalUrl - Where it was read.
 * @param facts - What it is made of.
 */
export function rowFromFacts(url: string, finalUrl: string, facts: PageFacts): InventoryRow {
  const h1s = facts.outline.filter(h => h.level === 1);
  return {
    url,
    status: 200,
    ...(finalUrl.replace(/\/$/, '') !== url.replace(/\/$/, '') ? { redirectedTo: finalUrl } : {}),
    title: facts.title,
    metaDescription: facts.metaDescription,
    h1: h1s[0]?.text ?? null,
    h1Count: h1s.length,
    canonical: facts.canonical ?? null,
    noindex: facts.noindex ?? false,
    wordCount: facts.wordCount,
    schemaTypes: facts.schemaTypes,
  };
}

const unread = (url: string, status: number | null, error: string): InventoryRow => ({ url, status, error, title: null, metaDescription: null, h1: null, h1Count: 0, canonical: null, noindex: false, wordCount: null, schemaTypes: [] });

/**
 * Read a site into an inventory.
 * @param site - The site, as a domain or URL.
 * @param f - The fetchers.
 * @param opts - The cap and the clock.
 * @param opts.cap - Pages read at most (default 300).
 * @param opts.now - When it was read.
 * @param opts.onProgress
 */
export async function readInventory(site: string, f: InventoryFetchers, opts: { cap?: number; now?: Date; onProgress?: (progress: { phase: 'discover' | 'read'; completed: number; total?: number }) => void } = {}): Promise<SiteInventory> {
  const origin = siteOrigin(site);
  const cap = opts.cap ?? DEFAULT_INVENTORY_CAP;
  const report = (progress: { phase: 'discover' | 'read'; completed: number; total?: number }) => {
    try {
      opts.onProgress?.(progress);
    } catch { /* Progress cannot fail a read. */ }
  };
  report({ phase: 'discover', completed: 0 });
  const found = await discoverPages(origin, f, cap);
  const urls = found.urls.slice(0, cap);
  let completed = 0;
  report({ phase: 'read', completed, total: urls.length });
  const rows = await mapWithConcurrency(urls, INVENTORY_CONCURRENCY, async (url): Promise<InventoryRow> => {
    try {
      const raw = await f.fetchHtml(url);
      return raw ? rowFromFacts(url, raw.url, extractPageFacts(raw.html, raw.url)) : unread(url, 200, 'not an HTML page');
    } catch (err) {
      const status = (err as { status?: unknown }).status;
      return unread(url, typeof status === 'number' ? status : null, ((err as Error).message ?? 'could not be read').slice(0, 160));
    } finally {
      completed++;
      report({ phase: 'read', completed, total: urls.length });
    }
  });
  return {
    site: hostOf(origin),
    readAt: (opts.now ?? new Date()).toISOString(),
    from: found.from,
    sitemaps: found.sitemaps,
    listed: found.urls.length,
    ...(found.urls.length > cap ? { cappedAt: cap } : {}),
    rows,
  };
}

export type InventoryIssues = {
  notRead: InventoryRow[];
  noTitle: InventoryRow[];
  noMeta: InventoryRow[];
  noH1: InventoryRow[];
  manyH1: InventoryRow[];
  noindex: InventoryRow[];
  /** Pages whose canonical names another URL. */
  canonicalElsewhere: InventoryRow[];
  /** Titles and meta descriptions used on more than one page. */
  duplicateTitles: Array<{ text: string; rows: InventoryRow[] }>;
  duplicateMeta: Array<{ text: string; rows: InventoryRow[] }>;
};

const sameUrl = (a: string, b: string) => a.replace(/\/$/, '').replace(/^https?:\/\/(?:www\.)?/, '') === b.replace(/\/$/, '').replace(/^https?:\/\/(?:www\.)?/, '');

function duplicates(rows: InventoryRow[], pick: (r: InventoryRow) => string | null): Array<{ text: string; rows: InventoryRow[] }> {
  const by = new Map<string, InventoryRow[]>();
  for (const r of rows) {
    const v = pick(r)?.trim();
    if (v) {
      by.set(v.toLowerCase(), [...(by.get(v.toLowerCase()) ?? []), r]);
    }
  }
  return [...by.values()].filter(g => g.length > 1).map(g => ({ text: pick(g[0]!)!.trim(), rows: g })).sort((a, b) => b.rows.length - a.rows.length);
}

/**
 * What needs fixing across the pages read. Pure.
 * @param rows - The inventory's rows.
 */
export function inventoryIssues(rows: readonly InventoryRow[]): InventoryIssues {
  const read = rows.filter(r => r.status === 200 && !r.error);
  return {
    notRead: rows.filter(r => r.status !== 200 || r.error),
    noTitle: read.filter(r => !r.title),
    noMeta: read.filter(r => !r.metaDescription),
    noH1: read.filter(r => r.h1Count === 0),
    manyH1: read.filter(r => r.h1Count > 1),
    noindex: read.filter(r => r.noindex),
    canonicalElsewhere: read.filter(r => r.canonical && !sameUrl(r.canonical, r.redirectedTo ?? r.url)),
    duplicateTitles: duplicates(read, r => r.title),
    duplicateMeta: duplicates(read, r => r.metaDescription),
  };
}

const cell = (s: string | null | undefined, max = 120): string => {
  const v = (s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
};

/**
 * A page as a link, labelled by its path.
 * @param url - The page.
 */
function pageLink(url: string): string {
  let label = url;
  try {
    const u = new URL(url);
    label = `${u.pathname}${u.search}` || '/';
  } catch {}
  return `[${cell(label, 80)}](${url})`;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

/** A markdown artifact holds at most 60,000 characters (`markdownSpecSchema`); leave room. */
export const INVENTORY_MD_BUDGET = 58_000;

/** Pages named per issue in the summary; the table has the rest. */
const NAMED_PER_ISSUE = 8;

const some = (rows: InventoryRow[]) => `${rows.slice(0, NAMED_PER_ISSUE).map(r => pageLink(r.url)).join(', ')}${rows.length > NAMED_PER_ISSUE ? ` and ${rows.length - NAMED_PER_ISSUE} more` : ''}`;
const pages = (n: number) => `${n} page${n === 1 ? '' : 's'}`;

/**
 * The summary lines: one per kind of problem, each naming its pages. Pure.
 * @param issues - From `inventoryIssues`.
 */
export function issueLines(issues: InventoryIssues): string[] {
  const lines: string[] = [];
  if (issues.notRead.length) {
    lines.push(`- ${pages(issues.notRead.length)} did not load: ${issues.notRead.slice(0, NAMED_PER_ISSUE).map(r => `${pageLink(r.url)} (${r.status ? `HTTP ${r.status}` : r.error ?? 'no answer'})`).join(', ')}${issues.notRead.length > NAMED_PER_ISSUE ? ` and ${issues.notRead.length - NAMED_PER_ISSUE} more` : ''}`);
  }
  if (issues.noTitle.length) {
    lines.push(`- ${pages(issues.noTitle.length)} with no title: ${some(issues.noTitle)}`);
  }
  if (issues.noMeta.length) {
    lines.push(`- ${pages(issues.noMeta.length)} with no meta description: ${some(issues.noMeta)}`);
  }
  if (issues.noH1.length) {
    lines.push(`- ${pages(issues.noH1.length)} with no H1: ${some(issues.noH1)}`);
  }
  if (issues.manyH1.length) {
    lines.push(`- ${pages(issues.manyH1.length)} with more than one H1: ${some(issues.manyH1)}`);
  }
  for (const d of issues.duplicateTitles.slice(0, 5)) {
    lines.push(`- Title "${cell(d.text, 80)}" on ${pages(d.rows.length)}: ${some(d.rows)}`);
  }
  if (issues.duplicateTitles.length > 5) {
    lines.push(`- ${issues.duplicateTitles.length - 5} more titles used more than once (see the table)`);
  }
  for (const d of issues.duplicateMeta.slice(0, 5)) {
    lines.push(`- Meta description "${cell(d.text, 80)}" on ${pages(d.rows.length)}: ${some(d.rows)}`);
  }
  if (issues.duplicateMeta.length > 5) {
    lines.push(`- ${issues.duplicateMeta.length - 5} more meta descriptions used more than once (see the table)`);
  }
  if (issues.noindex.length) {
    lines.push(`- ${pages(issues.noindex.length)} ask not to be indexed (noindex): ${some(issues.noindex)}`);
  }
  if (issues.canonicalElsewhere.length) {
    lines.push(`- ${pages(issues.canonicalElsewhere.length)} name another URL as canonical: ${some(issues.canonicalElsewhere)}`);
  }
  return lines;
}

/**
 * Where the URL list came from, in words.
 * @param inv - The inventory.
 */
function sourceLine(inv: SiteInventory): string {
  const files = inv.sitemaps.slice(0, 3).map(u => `[${cell(u.replace(/^https?:\/\//, ''), 80)}](${u})`).join(', ');
  const more = inv.sitemaps.length > 3 ? ` and ${inv.sitemaps.length - 3} more sitemap files` : '';
  if (inv.from === 'sitemap') {
    return `the sitemap (${files}${more})`;
  }
  if (inv.from === 'robots') {
    return `the sitemaps robots.txt names (${files}${more}); /sitemap.xml had none`;
  }
  return 'a crawl from the home page: the site has no sitemap at /sitemap.xml or in robots.txt, so pages nothing links to are missing';
}

/**
 * The inventory as a dated markdown artifact: where the list came from, the
 * cap when it was hit, what needs fixing, then every page in a table, each
 * row linked. Pure.
 * @param inv - The inventory.
 * @param budget - The most characters the document may hold; a big site falls back to a compact table, then cuts rows.
 */
export function renderInventory(inv: SiteInventory, budget = INVENTORY_MD_BUDGET): string {
  const date = inv.readAt.slice(0, 10);
  const issues = inventoryIssues(inv.rows);
  const head = [
    `# Site inventory · ${inv.site} · ${date}`,
    '',
    `Read ${date} from ${sourceLine(inv)}: ${pages(inv.listed)} listed, ${pages(inv.rows.length)} read.`,
    '',
  ];
  if (inv.cappedAt) {
    head.push(`**Capped.** The site lists ${pages(inv.listed)}; the first ${inv.cappedAt} were read. Run site_inventory with max_pages ${inv.listed} to read them all.`, '');
  }
  const found = issueLines(issues);
  head.push('## What needs fixing', '', ...(found.length ? found : ['Nothing missing: every page read has a title, a meta description and one H1; no title or description is used twice; nothing is noindex.']), '');

  // The full table first; a big site (hundreds of posts) does not fit one
  // document, so it falls back to a compact table (page, status, title,
  // words), and only then cuts rows, saying how many and why. The tool's
  // reply still carries every page read.
  const full = tableLines(inv.rows, 'full');
  const fullDoc = [...head, '## Pages', '', ...full, ''].join('\n');
  if (fullDoc.length <= budget) {
    return fullDoc;
  }
  const compact = tableLines(inv.rows, 'compact');
  const note = (shown: number) => shown < inv.rows.length
    ? `Compact table, paths on ${inv.site}: the full columns for ${pages(inv.rows.length)} do not fit one document, and only the first ${shown} rows fit even compact. The problems above cover every page read.`
    : `Compact table, paths on ${inv.site}: the full columns (meta description, H1, canonical, index, schema) for ${pages(inv.rows.length)} do not fit one document. The problems above cover every page read.`;
  const base = [...head, '## Pages', '', note(inv.rows.length), ''];
  const compactDoc = [...base, ...compact, ''].join('\n');
  if (compactDoc.length <= budget) {
    return compactDoc;
  }
  // Header row + separator, then as many rows as fit.
  const [h, sep, ...rows] = compact;
  let used = [...head, '## Pages', '', note(0), '', h!, sep!].join('\n').length + 1;
  let shown = 0;
  for (const r of rows) {
    if (used + r.length + 1 > budget) {
      break;
    }
    used += r.length + 1;
    shown++;
  }
  return [...head, '## Pages', '', note(shown), '', h!, sep!, ...rows.slice(0, shown), ''].join('\n');
}

function tableLines(rows: readonly InventoryRow[], shape: 'full' | 'compact'): string[] {
  const status = (r: InventoryRow) => r.error && r.status === 200 ? r.error : r.status ? `${r.status}${r.redirectedTo ? ` → ${pageLink(r.redirectedTo)}` : ''}` : cell(r.error ?? 'no answer', 60);
  if (shape === 'compact') {
    // The path alone (the site is in the heading); a link per row doubles a
    // row's length, and a 300-page site then no longer fits.
    return [
      '| # | Path | Status | Title | Words |',
      '|---|---|---|---|---|',
      ...rows.map((r, i) => `| ${i + 1} | ${cell(pathOf(r.url), 90)} | ${r.status ?? cell(r.error ?? 'no answer', 40)} | ${cell(r.title, 80)} | ${r.wordCount ?? ''} |`),
    ];
  }
  return [
    '| # | Page | Status | Title | Meta description | H1 | Canonical | Index | Words | Schema |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r, i) => {
      const canonical = r.canonical ? (sameUrl(r.canonical, r.redirectedTo ?? r.url) ? 'self' : pageLink(r.canonical)) : '';
      return `| ${i + 1} | ${pageLink(r.url)} | ${status(r)} | ${cell(r.title)} | ${cell(r.metaDescription, 160)} | ${cell(r.h1)}${r.h1Count > 1 ? ` (+${r.h1Count - 1})` : ''} | ${canonical} | ${r.status === 200 && !r.error ? (r.noindex ? 'noindex' : 'yes') : ''} | ${r.wordCount ?? ''} | ${cell(r.schemaTypes.join(', '), 80)} |`;
    }),
  ];
}
