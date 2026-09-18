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
