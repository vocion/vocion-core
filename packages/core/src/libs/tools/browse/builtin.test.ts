/**
 * builtinBrowseProvider: the agent's fetch_url path through the same
 * extractor the `web` connector uses. What matters here is that the provider
 * hands the fetched URL down to the extractor, so a relative href on the
 * page comes back as something the agent can actually fetch next.
 *
 * No network: fetch is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinBrowseProvider } from './builtin';

const PAGE_URL = 'https://bellwaterhall.example/shows-at-bellwater-hall/';

/**
 * A 200 response that looks like HTML to the provider's content-type check.
 * @param html - the body to serve
 */
function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('builtinBrowseProvider', () => {
  it('resolves the page\'s relative links and images against the URL it fetched', async () => {
    const html = `<html><head><title>Shows</title><meta property="og:image" content="/hero.jpg"></head>
      <body><main><p><a href="/events/velvet-antler/">Velvet Antler</a></p>
      <img src="/card.jpg" alt="Card"></main></body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(html)));

    const page = await builtinBrowseProvider().fetchPage(PAGE_URL);

    expect(page?.title).toBe('Shows');
    expect(page?.content).toContain('Image: https://bellwaterhall.example/hero.jpg');
    expect(page?.content).toContain('Velvet Antler (https://bellwaterhall.example/events/velvet-antler/)');
    expect(page?.content).toContain('[image: Card](https://bellwaterhall.example/card.jpg)');
  });

  it('returns null when a page has no readable text, so fetch_url can say so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('<html><body><nav>Menu</nav></body></html>')));

    const page = await builtinBrowseProvider().fetchPage(PAGE_URL);

    expect(page).toBeNull();
  });

  it('throws with the status when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));

    await expect(builtinBrowseProvider().fetchPage(PAGE_URL)).rejects.toThrow('HTTP 503');
  });
});
