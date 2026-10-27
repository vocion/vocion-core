/**
 * Squarespace's public answers, recorded in shape and made fictional: what
 * `<site>/?format=json`, `<blog>?format=json` and the developer API's
 * `/1.0/authorization/website` return for a site, trimmed to the fields Vocion
 * reads. Every name, id and address is invented (Northwind Outfitters, on
 * `example-site.squarespace.com`), so the connector and the publish read-back
 * are tested with no network.
 */

export const FIXTURE_SITE_URL = 'https://example-site.squarespace.com';

/** `GET https://example-site.squarespace.com/?format=json` (a page model, trimmed). */
export const FIXTURE_HOME_JSON = {
  website: {
    id: '64f0c0ffee0000000000a001',
    siteTitle: 'Northwind Outfitters',
    identifier: 'example-site',
    baseUrl: 'https://example-site.squarespace.com',
    primaryDomain: 'example-site.squarespace.com',
    authenticUrl: 'https://example-site.squarespace.com',
    timeZone: 'America/Denver',
  },
  collection: { id: '64f0c0ffee0000000000b001', title: 'Home', typeName: 'page', type: 10, fullUrl: '/' },
};

/** `GET https://example-site.squarespace.com/journal?format=json` (a blog collection, trimmed). */
export const FIXTURE_BLOG_JSON = {
  website: FIXTURE_HOME_JSON.website,
  collection: { id: '64f0c0ffee0000000000b002', title: 'Journal', typeName: 'blog', type: 1, fullUrl: '/journal', urlId: 'journal' },
  items: [
    {
      id: '64f0c0ffee0000000000c001',
      title: 'Layering for Shoulder Season',
      urlId: 'layering-for-shoulder-season',
      fullUrl: '/journal/layering-for-shoulder-season',
      publishOn: 1_790_000_000_000,
      excerpt: '<p>Three layers, and when to shed each one.</p>',
    },
    {
      id: '64f0c0ffee0000000000c002',
      title: 'How to Choose a Three-Season Tent',
      urlId: 'choose-a-three-season-tent',
      fullUrl: '/journal/choose-a-three-season-tent',
      publishOn: 1_792_000_000_000,
      excerpt: '<p>What matters, what does not, and what to spend.</p>',
    },
  ],
  pagination: { nextPage: false },
};

/** `GET https://api.squarespace.com/1.0/authorization/website` with the site's developer key. */
export const FIXTURE_API_WEBSITE = {
  id: '64f0c0ffee0000000000a001',
  siteId: '64f0c0ffee0000000000a001',
  title: 'Northwind Outfitters',
  url: 'https://example-site.squarespace.com',
  timeZone: 'America/Denver',
};

/**
 * A fake of the three answers, for `vi.stubGlobal('fetch', …)`: the site, its
 * blog at /journal, and the developer API for the key `sqsp-fixture-key`.
 * @param overrides - Path → answer, to make one of them fail.
 */
export function squarespaceFetch(overrides: Record<string, { status: number; body: unknown }> = {}) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const key = url.hostname === 'api.squarespace.com' ? url.pathname : `${url.pathname}${url.search}`;
    if (overrides[key]) {
      return new Response(JSON.stringify(overrides[key].body), { status: overrides[key].status });
    }
    if (url.hostname === 'api.squarespace.com' && url.pathname === '/1.0/authorization/website') {
      const auth = new Headers(init?.headers).get('authorization');
      return auth === 'Bearer sqsp-fixture-key'
        ? new Response(JSON.stringify(FIXTURE_API_WEBSITE), { status: 200 })
        : new Response(JSON.stringify({ type: 'AUTHORIZATION_ERROR', message: 'Authorization failed' }), { status: 401 });
    }
    if (url.hostname === 'example-site.squarespace.com' && url.searchParams.get('format') === 'json') {
      if (url.pathname === '/' || url.pathname === '') {
        return new Response(JSON.stringify(FIXTURE_HOME_JSON), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/journal') {
        return new Response(JSON.stringify(FIXTURE_BLOG_JSON), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
  };
}
