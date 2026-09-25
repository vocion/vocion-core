/**
 * The crawl: path filters, and the link pass.
 *
 * The link pass used to be a SECOND raw fetch of a page we had just fetched,
 * wrapped in `.catch(() => '')`. That cost one extra request per source and,
 * worse, swallowed the failure: the run then reported no connector failure,
 * looked complete with only the listing handled, and a complete full run
 * hard-deletes the previous run's detail documents. It now reads the body it
 * already holds, and a fetch that fails is reported as a connector-scope error
 *, which is what tells the runner to hold the watermark and suppress
 * tombstoning.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webConnector } from './web';

type Progress = { kind: string; uri?: string; message?: string };

const LISTING_URL = 'https://venue.test/shows/';

/**
 * Answer every fetch from one handler, and remember the calls.
 * @param handler - returns the response for a URL, or undefined to fail the call.
 */
function stubFetch(handler: (url: string) => Response | undefined): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const res = handler(url);
    if (!res) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return res;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * An HTML page.
 * @param body - markup for the body.
 */
function page(body: string): Response {
  return new Response(
    `<!doctype html><html><head><title>Shows</title></head><body><main>${body}</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/**
 * Make a response look like the one fetch returns after following a redirect.
 * @param res - the response the redirect landed on.
 * @param landedUrl - where the redirect landed.
 */
function redirectedTo(res: Response, landedUrl: string): Response {
  Object.defineProperties(res, { url: { value: landedUrl }, redirected: { value: true } });
  return res;
}

/**
 * Run one sync to completion.
 * @param config - the connector config under test.
 */
async function run(config: Record<string, unknown>): Promise<{ docs: IngestDoc[]; events: Progress[] }> {
  const events: Progress[] = [];
  const ctx: SourceContext = {
    sourceId: 1,
    orgId: 'org_test',
    config,
    onProgress: (e) => {
      events.push(e);
    },
  };
  const docs: IngestDoc[] = [];
  for await (const doc of webConnector.sync(ctx)) {
    docs.push(doc);
  }
  return { docs, events };
}

/**
 * The connector-scope errors a run reported.
 * @param events - every progress event from the run.
 */
function errors(events: Progress[]): Progress[] {
  return events.filter(e => e.kind === 'error');
}

/**
 * A listing linking to two event pages, one other page and one off-site page.
 * Built fresh per call: a Response body can only be read once.
 */
function mixedListing(): Response {
  return page(`
    <p><a href="/events/opening">Opening Night</a></p>
    <p><a href="/events/second">Second Show</a></p>
    <p><a href="/events/archive/old">Archive</a></p>
    <p><a href="/about">About us</a></p>
    <p><a href="https://elsewhere.test/events/nope">Elsewhere</a></p>
  `);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('crawl path filters', () => {
  it('follows only the paths `include` names', async () => {
    stubFetch(url => url === LISTING_URL ? mixedListing() : page('<p>A show.</p>'));

    const { docs } = await run({ crawl: { startUrl: LISTING_URL, include: ['/events/'] } });

    expect(docs.map(d => d.externalId)).toEqual([
      LISTING_URL,
      'https://venue.test/events/opening',
      'https://venue.test/events/second',
      'https://venue.test/events/archive/old',
    ]);
  });

  it('drops the paths `exclude` names, even when `include` matched them', async () => {
    stubFetch(url => url === LISTING_URL ? mixedListing() : page('<p>A show.</p>'));

    const { docs } = await run({
      crawl: { startUrl: LISTING_URL, include: ['/events/'], exclude: ['/archive/'] },
    });

    expect(docs.map(d => d.externalId)).toEqual([
      LISTING_URL,
      'https://venue.test/events/opening',
      'https://venue.test/events/second',
    ]);
  });

  it('still refuses another origin, filters or no filters', async () => {
    const fetchFn = stubFetch(url => url === LISTING_URL ? mixedListing() : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: LISTING_URL, include: ['/events/'] } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).not.toContain('https://elsewhere.test/events/nope');
  });
});

describe('the link pass', () => {
  it('reads the body of the first response instead of fetching the page twice', async () => {
    const fetchFn = stubFetch(url => url === LISTING_URL ? mixedListing() : page('<p>A show.</p>'));

    const { docs } = await run({ crawl: { startUrl: LISTING_URL, include: ['/events/opening'] } });
    const fetched = fetchFn.mock.calls.map(c => String(c[0]));

    expect(fetched).toEqual([LISTING_URL, 'https://venue.test/events/opening']);
    expect(docs).toHaveLength(2);
  });

  it('reports a detail page that fails as a connector-scope error, and carries on', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return mixedListing();
      }
      if (url === 'https://venue.test/events/second') {
        return undefined;
      }
      return page('<p>A show.</p>');
    });

    const { docs, events } = await run({
      crawl: { startUrl: LISTING_URL, include: ['/events/opening', '/events/second'] },
    });

    expect(docs.map(d => d.externalId)).toEqual([LISTING_URL, 'https://venue.test/events/opening']);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.uri).toBe('https://venue.test/events/second');
  });

  it('reports a non-2xx detail page as a connector-scope error', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return mixedListing();
      }
      return new Response('gone', { status: 500 });
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL, include: ['/events/opening'] } });

    expect(docs.map(d => d.externalId)).toEqual([LISTING_URL]);
    expect(errors(events)).toEqual([
      { kind: 'error', uri: 'https://venue.test/events/opening', message: 'HTTP 500' },
    ]);
  });
});

describe('the cost bound', () => {
  it('counts pages ATTEMPTED against maxPages, so failures cannot buy an unbounded crawl', async () => {
    const fetchFn = stubFetch(url => url === LISTING_URL ? mixedListing() : undefined);

    await run({ crawl: { startUrl: LISTING_URL, maxPages: 3 } });

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('never leaves depth 0 when maxDepth is 0', async () => {
    const fetchFn = stubFetch(() => mixedListing());

    const { docs } = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 0 } });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(docs.map(d => d.externalId)).toEqual([LISTING_URL]);
  });
});

describe('link order', () => {
  /** Ashby Library's calendar, whose path carries Joomla's `/index.php` segment. */
  const CALENDAR_URL = 'https://venue.test/index.php/calendar-of-events';
  const MONTH_URL = 'https://venue.test/index.php/calendar-of-events?month=10&year=2026';
  const STORY_URL = 'https://venue.test/index.php/calendar-of-events/story-time';
  const NOTARY_URL = 'https://venue.test/index.php/services/notary';
  const EBOOKS_URL = 'https://venue.test/index.php/digital-library/ebooks';

  /**
   * The shape that motivated the partition: the sidebar menu is the first
   * markup on the page, the calendar's own links come after it. Links are
   * collected BEFORE chrome removal, so the menu is in the crawl's link set.
   * Built fresh per call: a Response body can only be read once.
   */
  function joomlaListing(): Response {
    return page(`
      <nav>
        <a href="/index.php/services/notary">Notary</a>
        <a href="/index.php/digital-library/ebooks">Ebooks</a>
      </nav>
      <p><a href="/index.php/calendar-of-events?month=10&amp;year=2026">Next month</a></p>
      <p><a href="/index.php/calendar-of-events/story-time">Story Time</a></p>
    `);
  }

  it('queues links under the listing path before the rest of the same origin', async () => {
    const fetchFn = stubFetch(url => url === CALENDAR_URL ? joomlaListing() : page('<p>An event.</p>'));

    // Two pages buys the listing and exactly one link. The menu is first in
    // page order, so before the partition that link was the menu.
    await run({ crawl: { startUrl: CALENDAR_URL, maxPages: 2 } });
    const fetched = fetchFn.mock.calls.map(c => String(c[0]));

    // The seed's own path with a different query string is under it.
    expect(fetched).toEqual([CALENDAR_URL, MONTH_URL]);
    expect(fetched).not.toContain(NOTARY_URL);
  });

  it('the partition changes order only: with enough budget every same-origin link is still fetched once', async () => {
    const fetchFn = stubFetch(url => url === CALENDAR_URL ? joomlaListing() : page('<p>An event.</p>'));

    await run({ crawl: { startUrl: CALENDAR_URL, maxPages: 20 } });
    const fetched = fetchFn.mock.calls.map(c => String(c[0]));

    // Nothing followable was dropped, and nothing was fetched twice.
    expect([...fetched].sort()).toEqual([CALENDAR_URL, MONTH_URL, STORY_URL, NOTARY_URL, EBOOKS_URL].sort());
    expect(new Set(fetched).size).toBe(fetched.length);
    // Only the order moved: the listing's own pages ahead of the menu, each
    // group still in page order.
    expect(fetched).toEqual([CALENDAR_URL, MONTH_URL, STORY_URL, NOTARY_URL, EBOOKS_URL]);
  });

  it('leaves the path filters in charge: being under the listing path is not a pass', async () => {
    const excluded = stubFetch(url => url === CALENDAR_URL ? joomlaListing() : page('<p>An event.</p>'));

    await run({ crawl: { startUrl: CALENDAR_URL, exclude: ['?month='] } });

    expect(excluded.mock.calls.map(c => String(c[0]))).not.toContain(MONTH_URL);

    const included = stubFetch(url => url === CALENDAR_URL ? joomlaListing() : page('<p>An event.</p>'));

    await run({ crawl: { startUrl: CALENDAR_URL, include: ['/services/'] } });

    // The listing's own pages lost the whitelist, so the menu page is all
    // that is left, partition or no partition.
    expect(included.mock.calls.map(c => String(c[0]))).toEqual([CALENDAR_URL, NOTARY_URL]);
  });
});

describe('ignore, the parts of a page that are not the page', () => {
  const widget = (other: string): string =>
    `<div class="widget-area"><p>Upcoming: <a href="/events/${other}">${other}</a></p></div>`;
  const listing = (other: string): Response =>
    page(`<p><a href="/events/opening">Opening</a></p>${widget(other)}`);

  it('does not follow a link held only by an ignored element on the listing', async () => {
    const fetched = stubFetch(url => url === LISTING_URL ? listing('other') : page('<p>A show.</p>'));

    const { docs } = await run({ crawl: { startUrl: LISTING_URL }, ignore: ['.widget-area'] });

    expect(fetched.mock.calls.map(c => String(c[0]))).toEqual([LISTING_URL, 'https://venue.test/events/opening']);
    expect(docs.map(d => d.externalId)).toEqual([LISTING_URL, 'https://venue.test/events/opening']);
    expect(docs[0]!.content).not.toContain('Upcoming');
  });

  it('does not follow a link held only by an ignored element on a listing that redirected within its site', async () => {
    const fetched = stubFetch(url => url === LISTING_URL
      ? redirectedTo(listing('other'), 'https://www.venue.test/shows/')
      : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: LISTING_URL }, ignore: ['.widget-area'] });

    expect(fetched.mock.calls.map(c => String(c[0]))).toEqual([LISTING_URL, 'https://www.venue.test/events/opening']);
  });

  it('reads a detail page the same on two runs when only its ignored widget changed', async () => {
    const detail = async (other: string): Promise<string> => {
      stubFetch(url => url === LISTING_URL ? listing('x') : page(`<p>A show.</p>${widget(other)}`));
      const { docs } = await run({ crawl: { startUrl: LISTING_URL }, ignore: ['.widget-area'] });
      return docs.find(d => d.externalId.endsWith('/opening'))!.content;
    };

    expect(await detail('alpha')).toBe(await detail('beta'));
  });

  it('applies to a listed URL without a crawl block', async () => {
    stubFetch(() => page(`<p>A show.</p>${widget('alpha')}`));

    const { docs } = await run({ urls: [LISTING_URL], ignore: ['.widget-area'] });

    expect(docs[0]!.content).toContain('A show.');
    expect(docs[0]!.content).not.toContain('Upcoming');
  });

  it.each([
    '#eventJustAnnounced',
    'script.yoast-schema-graph',
    'div.sidebar > ul li:not(.keep)',
    '[data-widget="just-announced"]',
    'aside ~ div + p',
    '.a, .b',
    'a[href$=">"]',
  ])('accepts %s', (selector) => {
    const parsed = webConnector.configSchema.safeParse({ urls: [LISTING_URL], ignore: [selector] });

    expect(parsed.success).toBe(true);
  });

  it('trims a selector', () => {
    const parsed = webConnector.configSchema.safeParse({ urls: [LISTING_URL], ignore: ['  #x  '] });

    expect(parsed.success && parsed.data.ignore).toEqual(['#x']);
  });

  it.each([
    ['', 1],
    ['   ', 1],
    ['div[', 1],
    ['<div>', 1],
    ['div[title="<b>"]', 1],
    ['p:frobnicate', 1],
    ['a::before', 1],
    ['div >', 1],
    ['> div', 1],
    ['*', 1],
    ['body', 1],
    [':root', 1],
    ['div, html', 1],
    ['x'.repeat(201), 1],
  ])('refuses %j with one issue', (selector, issues) => {
    const parsed = webConnector.configSchema.safeParse({ urls: [LISTING_URL], ignore: [selector] });

    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues).toHaveLength(issues);
  });

  it('refuses more than twenty selectors', () => {
    const parsed = webConnector.configSchema.safeParse({ urls: [LISTING_URL], ignore: Array.from({ length: 21 }, (_, i) => `#s${i}`) });

    expect(parsed.success).toBe(false);
  });

  it('refuses to sync a config whose selector does not compile, before any fetch', async () => {
    const fetched = stubFetch(() => undefined);

    await expect(run({ urls: [LISTING_URL], ignore: ['div['] })).rejects.toThrow(/cheerio can read/);
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe('a seed that redirects within its site', () => {
  const WWW_LISTING_URL = 'https://www.venue.test/shows/';

  it.each([
    ['an https', LISTING_URL],
    ['an http', 'http://venue.test/shows/'],
  ])('follows the absolute and relative links of the www host %s apex seed landed on', async (_scheme, seedUrl) => {
    const fetchFn = stubFetch(url => url === seedUrl
      ? redirectedTo(page(`
          <p><a href="https://www.venue.test/shows/opening">Opening Night</a></p>
          <p><a href="/shows/second">Second Show</a></p>
        `), WWW_LISTING_URL)
      : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: seedUrl } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([
      seedUrl,
      'https://www.venue.test/shows/opening',
      'https://www.venue.test/shows/second',
    ]);
  });

  it('resolves relative links against the URL the seed landed on', async () => {
    const fetchFn = stubFetch(url => url === 'https://venue.test/shows'
      ? redirectedTo(page('<p><a href="opening">Opening Night</a></p>'), LISTING_URL)
      : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: 'https://venue.test/shows' } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual(['https://venue.test/shows', 'https://venue.test/shows/opening']);
  });

  it('queues the landed listing\'s own pages first', async () => {
    const fetchFn = stubFetch(url => url === 'https://venue.test/calendar'
      ? redirectedTo(page(`
          <nav><a href="/about">About</a></nav>
          <p><a href="/whats-on/next-month">Next month</a></p>
        `), 'https://venue.test/whats-on/')
      : page('<p>An event.</p>'));

    await run({ crawl: { startUrl: 'https://venue.test/calendar', maxPages: 2 } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([
      'https://venue.test/calendar',
      'https://venue.test/whats-on/next-month',
    ]);
  });

  it('keeps the requested listing path first when the seed lands on its site root', async () => {
    const fetchFn = stubFetch(url => url === 'https://venue.test/calendar/'
      ? redirectedTo(page(`
          <nav><a href="/about">About</a></nav>
          <p><a href="/calendar/next-month">Next month</a></p>
        `), 'https://www.venue.test/')
      : page('<p>An event.</p>'));

    await run({ crawl: { startUrl: 'https://venue.test/calendar/', maxPages: 2 } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([
      'https://venue.test/calendar/',
      'https://www.venue.test/calendar/next-month',
    ]);
  });

  it('does not fetch the landed listing again', async () => {
    const fetchFn = stubFetch(url => url === LISTING_URL
      ? redirectedTo(page(`
          <nav><a href="https://www.venue.test/shows/">Shows</a></nav>
          <p><a href="/shows/opening">Opening Night</a></p>
        `), WWW_LISTING_URL)
      : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: LISTING_URL } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([LISTING_URL, 'https://www.venue.test/shows/opening']);
  });

  it('keeps the requested URL as the document id', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return redirectedTo(page('<p><a href="/shows/opening">Opening Night</a></p>'), WWW_LISTING_URL);
      }
      return url === 'https://www.venue.test/shows/opening'
        ? redirectedTo(page('<p>Opening Night, 7:30pm.</p>'), 'https://www.venue.test/shows/opening/')
        : undefined;
    });

    const { docs } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(docs.map(d => [d.externalId, d.uri])).toEqual([
      [LISTING_URL, LISTING_URL],
      ['https://www.venue.test/shows/opening', 'https://www.venue.test/shows/opening'],
    ]);
  });

  it('judges same-origin by the landed host only', async () => {
    const fetchFn = stubFetch(url => url === LISTING_URL
      ? redirectedTo(page(`
          <p><a href="https://venue.test/shows/apex-only">Apex only</a></p>
          <p><a href="/shows/opening">Opening Night</a></p>
        `), WWW_LISTING_URL)
      : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: LISTING_URL } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([LISTING_URL, 'https://www.venue.test/shows/opening']);
  });

  it('keeps the page set when the listing moves within its own origin', async () => {
    const seedUrl = 'https://venue.test/shows/';
    const fetchFn = stubFetch(url => url === seedUrl
      ? redirectedTo(page(`
          <nav><a href="/about">About</a></nav>
          <p><a href="/events/opening">Opening Night</a></p>
          <p><a href="/events/second">Second Show</a></p>
        `), 'https://venue.test/shows-at-venue/')
      : page('<p>A show.</p>'));

    const { docs } = await run({ crawl: { startUrl: seedUrl } });
    const expected = [
      seedUrl,
      'https://venue.test/about',
      'https://venue.test/events/opening',
      'https://venue.test/events/second',
    ];

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual(expected);
    expect(docs.map(d => d.externalId)).toEqual(expected);
  });

  it('keeps the requested URL as the base when the response did not redirect', async () => {
    const fetchFn = stubFetch(url => url === LISTING_URL
      ? page(`
          <p><a href="https://www.venue.test/shows/opening">Opening Night</a></p>
          <p><a href="/shows/second">Second Show</a></p>
        `)
      : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: LISTING_URL } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([LISTING_URL, 'https://venue.test/shows/second']);
  });

  it('builds the text, the stored links and the id exactly as it would without the redirect', async () => {
    const body = `
      <p><a href="/shows/opening">Opening Night</a> <img src="poster.jpg" alt="Poster"></p>
      <p><a href="second">Second Show</a></p>
    `;
    stubFetch(() => page(body));
    const { docs: [direct] } = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 0 } });
    stubFetch(() => redirectedTo(page(body), WWW_LISTING_URL));
    const { docs: [redirected] } = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 0 } });

    expect(redirected).toEqual(direct);
    expect(redirected?.externalId).toBe(LISTING_URL);
    expect(redirected?.content).toContain('Opening Night (https://venue.test/shows/opening) [image: Poster](https://venue.test/shows/poster.jpg)');
    expect(redirected?.metadata).toMatchObject({
      links: [
        { url: 'https://venue.test/shows/opening', text: 'Opening Night' },
        { url: 'https://venue.test/shows/second', text: 'Second Show' },
      ],
    });
  });

  it('counts an upgrade to https on the same host as the same site', async () => {
    const seedUrl = 'http://venue.test/shows/';
    const fetchFn = stubFetch(url => url === seedUrl
      ? redirectedTo(page(`
          <p><a href="https://venue.test/shows/opening">Opening Night</a></p>
          <p><a href="/shows/second">Second Show</a></p>
        `), LISTING_URL)
      : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: seedUrl } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([
      seedUrl,
      'https://venue.test/shows/opening',
      'https://venue.test/shows/second',
    ]);
  });

  it('follows the links of a plain text seed from where it landed', async () => {
    const fetchFn = stubFetch(url => url === LISTING_URL
      ? redirectedTo(
          new Response('<a href="/shows/opening">Opening Night</a>', { headers: { 'content-type': 'text/plain' } }),
          WWW_LISTING_URL,
        )
      : page('<p>A show.</p>'));

    await run({ crawl: { startUrl: LISTING_URL } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([LISTING_URL, 'https://www.venue.test/shows/opening']);
  });
});

describe('a detail page that redirects within its site', () => {
  it('is never ingested a second time under the URL it landed on', async () => {
    const opening = 'https://venue.test/shows/opening';
    const encore = 'https://venue.test/shows/encore';
    const fetchFn = stubFetch((url) => {
      if (url === LISTING_URL) {
        return page(`
          <p><a href="/shows/opening">Opening Night</a></p>
          <p><a href="/shows/opening-night">Opening Night, again</a></p>
          <p><a href="/shows/encore-tickets">Encore tickets</a></p>
          <p><a href="/shows/encore">Encore</a></p>
        `);
      }
      if (url === 'https://venue.test/shows/opening-night') {
        return redirectedTo(page('<p>Opening Night, 7:30pm.</p>'), opening);
      }
      if (url === 'https://venue.test/shows/encore-tickets') {
        return redirectedTo(page('<p>Encore, 9pm.</p>'), encore);
      }
      return page('<p>A show.</p>');
    });

    const { docs } = await run({ crawl: { startUrl: LISTING_URL } });
    const expected = [LISTING_URL, opening, 'https://venue.test/shows/opening-night', 'https://venue.test/shows/encore-tickets'];

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual(expected);
    expect(docs.map(d => d.externalId)).toEqual(expected);
  });

  it.each([
    ['the www host', 'https://venue.test', 'https://www.venue.test/shows/a'],
    ['https', 'http://venue.test', 'https://venue.test/shows/a'],
  ])('keeps the requested URL as the base when it lands on %s, off the seed\'s origin', async (_what, origin, landedUrl) => {
    const fetchFn = stubFetch((url) => {
      if (url === `${origin}/shows/`) {
        return page('<p><a href="/shows/a">A</a></p>');
      }
      return url === `${origin}/shows/a`
        ? redirectedTo(page('<p><a href="/shows/b">B</a></p>'), landedUrl)
        : page('<p>A show.</p>');
    });

    await run({ crawl: { startUrl: `${origin}/shows/`, maxDepth: 2 } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([`${origin}/shows/`, `${origin}/shows/a`, `${origin}/shows/b`]);
  });
});

describe('a redirect to another site', () => {
  it.each([
    ['another registrable domain', 'https://tickets.example'],
    ['another port', 'https://venue.test:8443'],
    ['plain http', 'http://venue.test'],
  ])('keeps the requested URL as the base of a seed that lands on %s', async (_what, landedOrigin) => {
    const fetchFn = stubFetch(url => url === LISTING_URL
      ? redirectedTo(page(`
          <p><a href="${landedOrigin}/venue/opening">Opening Night</a></p>
          <p><a href="/venue/second">Second Show</a></p>
          <p><a href="https://venue.test/shows/third">Third Show</a></p>
        `), `${landedOrigin}/venue/`)
      : page('<p>A show.</p>'));

    const { docs } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([
      LISTING_URL,
      'https://venue.test/shows/third',
      'https://venue.test/venue/second',
    ]);
    expect(docs[0]?.externalId).toBe(LISTING_URL);
    expect(docs[0]?.content).toContain('Second Show (https://venue.test/venue/second)');
  });

  it('keeps the requested URL as the base of a detail page that lands on another site', async () => {
    const fetchFn = stubFetch((url) => {
      if (url === LISTING_URL) {
        return page('<p><a href="/shows/opening">Opening Night</a></p>');
      }
      if (url === 'https://venue.test/shows/opening') {
        return redirectedTo(page(`
          <p><a href="https://tickets.example/e/opening/seats">Seats</a></p>
          <p><a href="/shows/after-party">After party</a></p>
        `), 'https://tickets.example/e/opening');
      }
      return page('<p>A show.</p>');
    });

    await run({ crawl: { startUrl: LISTING_URL, maxDepth: 2 } });

    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([
      LISTING_URL,
      'https://venue.test/shows/opening',
      'https://venue.test/shows/after-party',
    ]);
  });
});
