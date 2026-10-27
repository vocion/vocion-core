import type { InventoryFetchers } from './inventory';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inventoryIssues, parseSitemap, readInventory, renderInventory, robotsSitemaps, sitePages } from './inventory';

/**
 * A client's whole site, read from its own sitemap rather than from what ten
 * crawled pages link to (red team, 2026-10-27: onboarding saw about ten of
 * forty pages and nothing about how they were built). Recorded sitemap
 * shapes — Squarespace's urlset with nested images, a WordPress-style index
 * of indexes, a robots.txt that names its sitemap — over a fictional site.
 */

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const page = (o: { title?: string; meta?: string; h1?: string[]; canonical?: string; robots?: string; body?: string; schema?: string }) => `<!doctype html><html><head>
${o.title ? `<title>${o.title}</title>` : ''}
${o.meta ? `<meta name="description" content="${o.meta}">` : ''}
${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ''}
${o.robots ? `<meta name="robots" content="${o.robots}">` : ''}
${o.schema ? `<script type="application/ld+json">{"@context":"https://schema.org","@type":"${o.schema}"}</script>` : ''}
</head><body><main>${(o.h1 ?? []).map(h => `<h1>${h}</h1>`).join('')}<p>${o.body ?? 'We fix furnaces and air conditioners.'}</p></main></body></html>`;

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status} from northwind-home.example.`), { status });

/**
 * Fetchers over recorded files: text by URL, HTML by URL, a crawl that says
 * what it was asked.
 * @param text - Text files by URL.
 * @param html - Pages by URL (an Error is thrown as the fetch failing).
 * @param crawled - What a crawl finds.
 */
function fetchers(text: Record<string, string>, html: Record<string, string | Error> = {}, crawled: string[] = []): InventoryFetchers & { crawl: ReturnType<typeof vi.fn> } {
  return {
    fetchText: async url => text[url] ?? null,
    fetchHtml: async (url) => {
      const got = html[url];
      if (got instanceof Error) {
        throw got;
      }
      return got === undefined ? { url, html: page({ title: `Page ${url}`, meta: `About ${url}`, h1: ['Heading'] }) } : { url, html: got };
    },
    crawl: vi.fn(async () => crawled),
  };
}

const NOW = new Date('2026-10-27T15:00:00Z');

describe('parseSitemap and robots.txt', () => {
  it('reads each url\'s own loc from a Squarespace urlset, never an image\'s', () => {
    const { urls, sitemaps } = parseSitemap(fixture('squarespace-sitemap.xml'));

    expect(sitemaps).toEqual([]);
    expect(urls).toHaveLength(8);
    expect(urls).not.toContain('https://images.cdn.example/content/v1/van.jpg');
    expect(urls[1]).toBe('https://www.northwind-home.example/furnace-repair');
  });

  it('reads a sitemap index\'s children', () => {
    expect(parseSitemap(fixture('sitemap-index.xml')).sitemaps).toEqual(['https://northwind-home.example/page-sitemap.xml', 'https://northwind-home.example/blog-sitemaps.xml']);
  });

  it('reads the Sitemap lines of robots.txt', () => {
    expect(robotsSitemaps(fixture('robots.txt'))).toEqual(['https://northwind-home.example/sitemaps/main.xml']);
  });

  it('keeps the site\'s own pages once each: no other host, no files, no fragments, www or not', () => {
    expect(sitePages('https://northwind-home.example', [
      'https://www.northwind-home.example/about',
      'https://northwind-home.example/about#team',
      'https://northwind-home.example/about/',
      'https://partner.example/x',
      'https://northwind-home.example/s/price-sheet.pdf',
      'mailto:hello@northwind-home.example',
    ])).toEqual(['https://www.northwind-home.example/about']);
  });
});

describe('readInventory', () => {
  it('reads a Squarespace sitemap and every page on it, with the basics and what needs fixing', async () => {
    const base = 'https://www.northwind-home.example';
    const f = fetchers(
      { 'https://northwind-home.example/sitemap.xml': fixture('squarespace-sitemap.xml') },
      {
        [`${base}/`]: page({ title: 'Northwind Home Services | Heating and Cooling', meta: 'Furnace and AC repair.', h1: ['Comfort, fixed today'], canonical: `${base}/`, schema: 'HVACBusiness', body: 'One two three four five.' }),
        [`${base}/furnace-repair`]: page({ title: 'Furnace repair', h1: ['Furnace repair'], canonical: `${base}/furnace-repair` }),
        [`${base}/ac-installation`]: page({ title: 'Furnace repair', meta: 'AC installation.', h1: [] }),
        [`${base}/about`]: page({ title: 'About us', meta: 'Who we are.', h1: ['About', 'Our team'], canonical: `${base}/` }),
        [`${base}/old-specials`]: httpError(404),
        [`${base}/thank-you`]: page({ title: 'Thanks', meta: 'Thanks.', h1: ['Thanks'], robots: 'noindex, nofollow' }),
      },
    );

    const inv = await readInventory('northwind-home.example', f, { now: NOW });

    expect(inv).toMatchObject({ site: 'northwind-home.example', from: 'sitemap', sitemaps: ['https://northwind-home.example/sitemap.xml'], listed: 6, readAt: '2026-10-27T15:00:00.000Z' });
    expect(inv.cappedAt).toBeUndefined();
    expect(f.crawl).not.toHaveBeenCalled();
    expect(inv.rows.map(r => r.url)).toEqual(['/', '/furnace-repair', '/ac-installation', '/about', '/old-specials', '/thank-you'].map(p => `${base}${p}`));
    expect(inv.rows[0]).toMatchObject({ status: 200, title: 'Northwind Home Services | Heating and Cooling', metaDescription: 'Furnace and AC repair.', h1: 'Comfort, fixed today', h1Count: 1, canonical: `${base}/`, noindex: false, wordCount: 8, schemaTypes: ['HVACBusiness'] });
    expect(inv.rows[4]).toMatchObject({ status: 404, title: null });
    expect(inv.rows[5]).toMatchObject({ noindex: true });

    const issues = inventoryIssues(inv.rows);

    expect(issues.notRead.map(r => r.url)).toEqual([`${base}/old-specials`]);
    expect(issues.noMeta.map(r => r.url)).toEqual([`${base}/furnace-repair`]);
    expect(issues.noH1.map(r => r.url)).toEqual([`${base}/ac-installation`]);
    expect(issues.manyH1.map(r => r.url)).toEqual([`${base}/about`]);
    expect(issues.duplicateTitles).toEqual([{ text: 'Furnace repair', rows: [inv.rows[1], inv.rows[2]] }]);
    expect(issues.noindex.map(r => r.url)).toEqual([`${base}/thank-you`]);
    expect(issues.canonicalElsewhere.map(r => r.url)).toEqual([`${base}/about`]);
  });

  it('follows a sitemap index of indexes and keeps only this site\'s pages', async () => {
    const f = fetchers({
      'https://northwind-home.example/sitemap.xml': fixture('sitemap-index.xml'),
      'https://northwind-home.example/page-sitemap.xml': fixture('page-sitemap.xml'),
      'https://northwind-home.example/blog-sitemaps.xml': fixture('blog-sitemaps.xml'),
      'https://northwind-home.example/post-sitemap.xml': fixture('post-sitemap.xml'),
    });

    const inv = await readInventory('https://northwind-home.example/any/page', f, { now: NOW });

    expect(inv.from).toBe('sitemap');
    expect(inv.sitemaps).toEqual([
      'https://northwind-home.example/sitemap.xml',
      'https://northwind-home.example/page-sitemap.xml',
      'https://northwind-home.example/blog-sitemaps.xml',
      'https://northwind-home.example/post-sitemap.xml',
    ]);
    expect(inv.rows.map(r => r.url)).toEqual([
      'https://northwind-home.example/',
      'https://northwind-home.example/services/',
      'https://northwind-home.example/blog/when-to-replace-a-furnace/',
      'https://northwind-home.example/blog/ac-tune-up-checklist/',
    ]);
  });

  it('reads the sitemap robots.txt names when /sitemap.xml has none', async () => {
    const f = fetchers({
      'https://northwind-home.example/robots.txt': fixture('robots.txt'),
      'https://northwind-home.example/sitemaps/main.xml': fixture('page-sitemap.xml'),
    });

    const inv = await readInventory('northwind-home.example', f, { now: NOW });

    expect(inv.from).toBe('robots');
    expect(inv.sitemaps).toEqual(['https://northwind-home.example/sitemaps/main.xml']);
    expect(inv.rows).toHaveLength(2);
  });

  it('falls back to a crawl, bounded by the cap, and says so', async () => {
    const f = fetchers({}, {}, ['https://northwind-home.example/', 'https://northwind-home.example/contact']);

    const inv = await readInventory('northwind-home.example', f, { now: NOW, cap: 40 });

    expect(inv.from).toBe('crawl');
    expect(f.crawl).toHaveBeenCalledWith('https://northwind-home.example/', 40);
    expect(inv.rows).toHaveLength(2);
    expect(renderInventory(inv)).toContain('a crawl from the home page: the site has no sitemap at /sitemap.xml or in robots.txt, so pages nothing links to are missing');
  });

  it('reads up to the cap and states it when the site lists more', async () => {
    const f = fetchers({ 'https://northwind-home.example/sitemap.xml': fixture('squarespace-sitemap.xml') });

    const inv = await readInventory('northwind-home.example', f, { now: NOW, cap: 4 });

    expect(inv).toMatchObject({ listed: 6, cappedAt: 4 });
    expect(inv.rows).toHaveLength(4);
    expect(renderInventory(inv)).toContain('**Capped.** The site lists 6 pages; the first 4 were read. Run site_inventory with max_pages 6 to read them all.');
  });
});

describe('renderInventory', () => {
  it('is a dated table with every row linked, and the problems named with their pages', async () => {
    const base = 'https://www.northwind-home.example';
    const f = fetchers(
      { 'https://northwind-home.example/sitemap.xml': fixture('squarespace-sitemap.xml') },
      {
        [`${base}/furnace-repair`]: page({ title: 'Furnace repair | Fast', h1: ['Furnace repair'] }),
        [`${base}/old-specials`]: httpError(404),
      },
    );
    const inv = await readInventory('northwind-home.example', f, { now: NOW });
    const md = renderInventory(inv);
    const rows = md.split('\n').filter(l => /^\| \d+ \|/.test(l));

    expect(md.startsWith('# Site inventory · northwind-home.example · 2026-10-27\n\nRead 2026-10-27 from the sitemap ([northwind-home.example/sitemap.xml](https://northwind-home.example/sitemap.xml)): 6 pages listed, 6 pages read.')).toBe(true);
    expect(rows).toHaveLength(6);
    expect(rows.every(r => /\| \[[^\]]+\]\(https:\/\/www\.northwind-home\.example\/[^)]*\) \|/.test(r))).toBe(true);
    // A pipe in a title cannot break the table.
    expect(rows[1]).toContain('Furnace repair \\| Fast');
    expect(md).toContain('- 1 page did not load: [/old-specials](https://www.northwind-home.example/old-specials) (HTTP 404)');
    expect(md).toContain('- 1 page with no meta description: [/furnace-repair](https://www.northwind-home.example/furnace-repair)');
  });

  it('says plainly when nothing is missing', () => {
    const md = renderInventory({ site: 'northwind-home.example', readAt: NOW.toISOString(), from: 'sitemap', sitemaps: [], listed: 1, rows: [{ url: 'https://northwind-home.example/', status: 200, title: 'Home', metaDescription: 'Home.', h1: 'Home', h1Count: 1, canonical: null, noindex: false, wordCount: 10, schemaTypes: [] }] });

    expect(md).toContain('Nothing missing: every page read has a title, a meta description and one H1');
  });
});
