/**
 * Feeds: the content types the connector will read, the scheme rewrite that
 * keeps a calendar URL from failing the run, the silent discovery probes, and
 * the per-event split.
 *
 * The split is a TEXT split and the tests hold it to that: components come out
 * on `BEGIN:VEVENT` … `END:VEVENT`, the UID line is the only field unfolded,
 * and nothing expands an RRULE or does TZID arithmetic. Ids are the feed's own
 * keys, never the item's position in the feed, because one reorder or one
 * removal mid-feed would then rewrite every id after it and cost a re-embed
 * and a model call per document.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webConnector } from './web';

type Progress = { kind: string; uri?: string; message?: string };

const ICS_URL = 'https://venue.test/events.ics';
const LISTING_URL = 'https://venue.test/shows/';
const CALENDAR_URL = 'https://venue.test/calendar/';

const TWO_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Venue//EN
BEGIN:VEVENT
UID:evt-1@venue.test
SUMMARY:Opening Night
DTSTART;TZID=America/New_York:20261101T193000
RRULE:FREQ=WEEKLY;COUNT=4
END:VEVENT
BEGIN:VEVENT
UID:evt-1@venue.test
RECURRENCE-ID;TZID=America/New_York:20261108T193000
SUMMARY:Opening Night, moved
END:VEVENT
END:VCALENDAR`;

const FOLDED_UID_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-with-a-very-long-identifier-tha
 t-the-feed-folded
SUMMARY:Folded
END:VEVENT
END:VCALENDAR`;

const NO_UID_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Nothing to key on
DTSTART:20261101T193000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:Nor here
END:VEVENT
END:VCALENDAR`;

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Shows</title>
<item><title>Opening Night</title><link>https://venue.test/shows/opening</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Shows</title>
<entry><title>Opening Night</title></entry></feed>`;

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
 * A response with an explicit content type.
 * @param body - the body text.
 * @param contentType - the Content-Type header to answer with.
 */
function typed(body: string, contentType: string): Response {
  return new Response(body, { headers: { 'content-type': contentType } });
}

/**
 * A listing page.
 * @param head - extra markup for the head, usually a feed alternate.
 * @param body - extra markup for the body.
 */
function listing(head = '', body = '<p>Our shows.</p>'): Response {
  return typed(
    `<!doctype html><html><head><title>Shows</title>${head}</head><body><main>${body}</main></body></html>`,
    'text/html; charset=utf-8',
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
 * The id a keyless JSON item gets.
 * @param item - the item, as it will be serialised into the document.
 */
function hashKey(item: unknown): string {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 16);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('content types the connector will read', () => {
  it('reads an RSS feed instead of skipping it as unsupported', async () => {
    stubFetch(() => typed(RSS, 'application/rss+xml'));

    const { docs, events } = await run({ urls: ['https://venue.test/feed.xml'] });

    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toContain('<rss');
    expect(events.some(e => e.message?.includes('unsupported content-type'))).toBe(false);
  });

  it('reads an Atom feed too', async () => {
    stubFetch(() => typed(ATOM, 'application/atom+xml'));

    const { docs, events } = await run({ urls: ['https://venue.test/atom.xml'] });

    expect(docs).toHaveLength(1);
    expect(errors(events)).toEqual([]);
  });

  it('still refuses a type it cannot read', async () => {
    stubFetch(() => typed('%PDF-1.7', 'application/pdf'));

    const { docs, events } = await run({ urls: ['https://venue.test/flyer.pdf'] });

    expect(docs).toEqual([]);
    expect(events.some(e => e.kind === 'skipped' && e.message?.includes('unsupported content-type'))).toBe(true);
  });
});

describe('webcal://', () => {
  it('is rewritten to https before the fetch, and the document carries the rewritten URL', async () => {
    const fetchFn = stubFetch(url => url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined);

    const { docs, events } = await run({ urls: ['webcal://venue.test/events.ics'] });

    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(ICS_URL);
    expect(docs[0]?.externalId.startsWith(ICS_URL)).toBe(true);
    expect(errors(events)).toEqual([]);
  });
});

describe('the ICS per-event split', () => {
  it('yields one document per VEVENT, keyed by UID and RECURRENCE-ID', async () => {
    stubFetch(() => typed(TWO_EVENT_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs.map(d => d.externalId)).toEqual([
      `${ICS_URL}#evt-1@venue.test`,
      `${ICS_URL}#evt-1@venue.test#20261108T193000`,
    ]);
    expect(docs.map(d => d.title)).toEqual(['Opening Night', 'Opening Night, moved']);
  });

  it('keeps each component verbatim and expands nothing', async () => {
    stubFetch(() => typed(TWO_EVENT_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.content).toContain('RRULE:FREQ=WEEKLY;COUNT=4');
    expect(docs[0]?.content).toContain('DTSTART;TZID=America/New_York:20261101T193000');
    expect(docs[0]?.content.startsWith('BEGIN:VEVENT')).toBe(true);
    expect(docs[0]?.content.endsWith('END:VEVENT')).toBe(true);
    expect(docs[0]?.content).not.toContain('BEGIN:VCALENDAR');
  });

  it('unfolds the UID line, and only the UID line', async () => {
    stubFetch(() => typed(FOLDED_UID_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs.map(d => d.externalId)).toEqual([
      `${ICS_URL}#evt-with-a-very-long-identifier-that-the-feed-folded`,
    ]);
  });

  it('falls back to the whole file when a component has no UID, never to an index', async () => {
    stubFetch(() => typed(NO_UID_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs.map(d => d.externalId)).toEqual([ICS_URL]);
    expect(docs[0]?.content).toContain('BEGIN:VCALENDAR');
  });
});

describe('the JSON per-event split', () => {
  it('keys each item by @id, id or slug', async () => {
    const items = [
      { '@id': 'https://venue.test/e/1', 'name': 'One' },
      { id: 7, title: 'Two' },
      { slug: 'three', summary: 'Three' },
    ];
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs.map(d => d.externalId)).toEqual([
      'https://venue.test/events.json#https://venue.test/e/1',
      'https://venue.test/events.json#7',
      'https://venue.test/events.json#three',
    ]);
    expect(docs.map(d => d.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('hashes the item when it publishes no key, and never uses its index', async () => {
    const items = [{ when: '2026-11-01' }, { when: '2026-11-08' }];
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs.map(d => d.externalId)).toEqual([
      `https://venue.test/events.json#${hashKey(items[0])}`,
      `https://venue.test/events.json#${hashKey(items[1])}`,
    ]);
    expect(docs.some(d => d.externalId.endsWith('#0') || d.externalId.endsWith('#1'))).toBe(false);
  });

  it('keeps an empty array as one whole-file document', async () => {
    stubFetch(() => Response.json([]));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs.map(d => d.externalId)).toEqual(['https://venue.test/events.json']);
  });
});

describe('feed discovery', () => {
  it('reads the calendar the listing advertises, and says which source it used', async () => {
    const fetchFn = stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing('<link rel="alternate" type="text/calendar" href="/events.ics">');
      }
      return url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(docs.map(d => d.externalId)).toEqual([
      `${ICS_URL}#evt-1@venue.test`,
      `${ICS_URL}#evt-1@venue.test#20261108T193000`,
    ]);
    expect(events.some(e => e.message?.startsWith('source: discovered ics feed'))).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('prefers the calendar over an RSS alternate declared first', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        // Under the listing path, so the scope rule keeps it and the only
        // thing deciding between the two is KIND_ORDER.
        return listing(
          '<link rel="alternate" type="application/rss+xml" href="/shows/feed.xml">'
          + '<link rel="alternate" type="text/calendar" href="/events.ics">',
        );
      }
      if (url === ICS_URL) {
        return typed(TWO_EVENT_ICS, 'text/calendar');
      }
      return url === 'https://venue.test/shows/feed.xml' ? typed(RSS, 'application/rss+xml') : undefined;
    });

    const { events } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(events.some(e => e.message === 'source: discovered ics feed, 2 documents')).toBe(true);
    expect(events.some(e => e.message?.includes('rss'))).toBe(false);
  });

  it('finds an .ics linked from the body, entities and all', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing('', '<p><a href="/events.ics?src=cal">Add to calendar</a></p>');
      }
      return url === 'https://venue.test/events.ics?src=cal' ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined;
    });

    const { docs } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(docs).toHaveLength(2);
  });

  it('probes silently: a feed that 404s reports no error and falls back to the crawl', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing(
          '<link rel="alternate" type="text/calendar" href="/events.ics">',
          '<p><a href="/shows/opening">Opening Night</a></p>',
        );
      }
      if (url === ICS_URL) {
        return new Response('not here', { status: 404 });
      }
      return url === 'https://venue.test/shows/opening' ? listing('', '<p>Opening Night, 7:30pm.</p>') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 1 } });

    expect(errors(events)).toEqual([]);
    expect(docs.map(d => d.externalId)).toEqual([LISTING_URL, 'https://venue.test/shows/opening']);
    expect(events.some(e => e.kind === 'skipped' && e.uri === ICS_URL && e.message === 'HTTP 404')).toBe(true);
    expect(events.some(e => e.message?.startsWith('source: listing + depth-1 crawl'))).toBe(true);
  });

  it('refuses a 200 that is not the feed it claimed to be', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing('<link rel="alternate" type="text/calendar" href="/events.ics">');
      }
      // The site's own soft-404 page, served with a 200.
      return url === ICS_URL ? listing('', '<p>Page not found.</p>') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 0 } });

    expect(errors(events)).toEqual([]);
    expect(events.some(e => e.message === 'not a ics feed')).toBe(true);
    expect(docs.map(d => d.externalId)).toEqual([LISTING_URL]);
  });

  it('asks a Squarespace listing for its JSON', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing('', '<p>Shows.</p><img src="https://static1.squarespace.com/x.jpg" alt="x">');
      }
      return url === `${LISTING_URL}?format=json` ? Response.json({ items: [{ title: 'Opening Night' }] }) : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(events.some(e => e.message?.startsWith('source: discovered json feed'))).toBe(true);
    expect(docs.map(d => d.externalId)).toEqual([`${LISTING_URL}?format=json`]);
  });

  it('skips discovery entirely when the config names a feed', async () => {
    const fetchFn = stubFetch(url => url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined);

    const { docs, events } = await run({ feedUrl: 'webcal://venue.test/events.ics', crawl: { startUrl: LISTING_URL } });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(docs).toHaveLength(2);
    expect(events.some(e => e.message === 'source: configured feed')).toBe(true);
  });
});

/**
 * A feed declared in the head of every page on a site describes the site, not
 * the listing. Higher Ground's `/calendar/` declares the WordPress blog feed
 * at `/feed/`, and taking it replaced 60-odd shows with 1,460 characters of
 * blog posts. A calendar is exempt: it cannot be about anything but events.
 */
describe('feed discovery is scoped to the listing path', () => {
  it('a site-wide rss feed is not a candidate for a listing under /calendar/', async () => {
    const fetchFn = stubFetch(url => url === CALENDAR_URL
      ? listing('<link rel="alternate" type="application/rss+xml" href="/feed/">', '<p>Tonight: Opening Night.</p>')
      : undefined);

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL, maxDepth: 0 } });

    expect(events.some(e => e.message === 'source: skipped rss feed outside the listing path https://venue.test/feed/')).toBe(true);
    // Not even probed: the rule is decided on the URL, before any fetch.
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([CALENDAR_URL]);
    expect(docs.map(d => d.externalId)).toEqual([CALENDAR_URL]);
  });

  it('an rss feed under the listing path is a candidate', async () => {
    stubFetch((url) => {
      if (url === CALENDAR_URL) {
        return listing('<link rel="alternate" type="application/rss+xml" href="/calendar/feed/">');
      }
      return url === 'https://venue.test/calendar/feed/' ? typed(RSS, 'application/rss+xml') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL } });

    expect(events.some(e => e.message === 'source: discovered rss feed, 1 document')).toBe(true);
    expect(docs.map(d => d.externalId)).toEqual(['https://venue.test/calendar/feed/']);
  });

  it('an ics feed anywhere on the origin is a candidate', async () => {
    stubFetch((url) => {
      if (url === CALENDAR_URL) {
        return listing('<link rel="alternate" type="text/calendar" href="/events.ics">');
      }
      return url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL } });

    expect(events.some(e => e.message === 'source: discovered ics feed, 2 documents')).toBe(true);
    expect(events.some(e => e.message?.includes('outside the listing path'))).toBe(false);
    expect(docs).toHaveLength(2);
  });

  it('with no eligible feed the listing falls back to listing plus crawl', async () => {
    const fetchFn = stubFetch((url) => {
      if (url === CALENDAR_URL) {
        return listing(
          '<link rel="alternate" type="application/rss+xml" href="/feed/">'
          + '<link rel="alternate" type="application/rss+xml" href="/comments/feed/">',
          '<p><a href="/calendar/opening">Opening Night</a></p>',
        );
      }
      return url === 'https://venue.test/calendar/opening' ? listing('', '<p>Opening Night, 7:30pm.</p>') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL, maxDepth: 1 } });

    expect(errors(events)).toEqual([]);
    expect(docs.map(d => d.externalId)).toEqual([CALENDAR_URL, 'https://venue.test/calendar/opening']);
    expect(events.some(e => e.message?.startsWith('source: listing + depth-1 crawl'))).toBe(true);
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([CALENDAR_URL, 'https://venue.test/calendar/opening']);
  });
});
