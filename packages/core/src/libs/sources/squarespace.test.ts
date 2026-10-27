import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_BLOG_JSON, FIXTURE_SITE_URL, squarespaceFetch } from '@/libs/fixtures/squarespace';

// Every address in the fixtures is invented; the public-address guard would otherwise resolve DNS.
vi.mock('@/libs/net/publicUrl', () => ({ resolvesPublicly: vi.fn(async (raw: string) => ({ ok: true, url: new URL(raw) })) }));

const { blogUrlOf, findPublishedPost, postsFromJson, squarespaceConnector } = await import('./squarespace');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(squarespaceFetch()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Inspection = { reachable: boolean; authorized: boolean; checks: Array<{ key: string; ok: boolean; detail: string | null }>; note: string; error: string | null };

describe('the Squarespace connector', () => {
  it('names the site, its blog and the key\'s site, and says plainly why it signs in to publish', async () => {
    const out = await squarespaceConnector.inspect!({ config: { siteUrl: FIXTURE_SITE_URL, blogPath: '/journal' }, credentials: { email: 'editor@northwind-outfitters.example', password: 'fixture-password', apiKey: 'sqsp-fixture-key' }, options: {} }) as Inspection;

    expect(out.checks.map(c => `${c.key}:${c.ok}`)).toEqual(['site:true', 'blog:true', 'apiKey:true', 'login:true']);
    expect(out.checks[0]!.detail).toBe('Northwind Outfitters · https://example-site.squarespace.com');
    expect(out.checks[1]!.detail).toBe('2 published posts on the first page');
    expect(out.error).toBeNull();
    expect(out.note).toBe('Squarespace has no API for posts, so Vocion publishes by signing in to your site\'s editor. It saves a draft first and asks before it goes live.');
  });

  it('says what is missing: a refused key, a path that is not the blog, no login', async () => {
    const out = await squarespaceConnector.inspect!({ config: { siteUrl: FIXTURE_SITE_URL, blogPath: '/' }, credentials: { apiKey: 'wrong' }, options: {} }) as Inspection;

    expect(out.checks.map(c => `${c.key}:${c.ok}`)).toEqual(['site:true', 'blog:false', 'apiKey:false', 'login:false']);
    expect(out.authorized).toBe(false);
    expect(out.checks[2]!.detail).toBe('Authorization failed');
    expect(out.error).toMatch(/The blog at \/; The API key belongs to this site; An editor login is stored for publishing: not yet\./);
  });

  it('reads the blog\'s posts with their addresses on the site, and finds a published one by slug or title', async () => {
    expect(postsFromJson(FIXTURE_BLOG_JSON, FIXTURE_SITE_URL)[0]).toEqual({
      title: 'Layering for Shoulder Season',
      url: 'https://example-site.squarespace.com/journal/layering-for-shoulder-season',
      slug: 'layering-for-shoulder-season',
      publishedAt: new Date(1_790_000_000_000).toISOString(),
      excerpt: 'Three layers, and when to shed each one.',
    });
    expect((await findPublishedPost(FIXTURE_SITE_URL, '/journal', { slug: 'choose-a-three-season-tent', title: 'x' })).post?.url).toBe('https://example-site.squarespace.com/journal/choose-a-three-season-tent');
    expect((await findPublishedPost(FIXTURE_SITE_URL, '/journal', { slug: 'other', title: 'layering for shoulder season' })).post?.slug).toBe('layering-for-shoulder-season');
    expect((await findPublishedPost(FIXTURE_SITE_URL, '/journal', { slug: 'a-draft', title: 'A Draft' })).post).toBeNull();
    expect(blogUrlOf(`${FIXTURE_SITE_URL}/`, null)).toBe('https://example-site.squarespace.com/blog');
  });

  it('syncs through the web connector\'s own read, seeded at the site and its blog', async () => {
    const { webConnector } = await import('./web');
    const seen: unknown[] = [];
    const spy = vi.spyOn(webConnector, 'sync').mockImplementation(async function* (ctx) {
      seen.push(ctx.config);
    });
    for await (const _ of squarespaceConnector.sync({ sourceId: 1, orgId: 'o', config: { siteUrl: `${FIXTURE_SITE_URL}/`, blogPath: '/journal' } })) {
      // nothing to read
    }

    expect(seen).toEqual([{ urls: ['https://example-site.squarespace.com', 'https://example-site.squarespace.com/journal'], crawl: { startUrl: 'https://example-site.squarespace.com', maxDepth: 1, maxPages: 50, exclude: ['/config', '/cart', '/account', '/checkout'] } }]);

    spy.mockRestore();
  });
});
