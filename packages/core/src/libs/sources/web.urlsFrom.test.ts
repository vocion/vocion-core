/**
 * `urlsFrom`: the web connector reading its URL list from somewhere else.
 *
 * The rules under test are the ones with teeth. A 200 carrying a valid EMPTY
 * array is a registry saying "nothing today", a no-op, one `skipped` event,
 * no failure. Everything else that goes wrong is ONE connector-scope error,
 * because the runner reads a connector error as "a slice we could not fetch"
 * and therefore holds the watermark and suppresses tombstoning: a registry
 * that is down for an hour must never be able to delete a source. And every
 * entry is checked against `^https?:` on top of zod, because zod 4's `.url()`
 * waves `file://` and `javascript:` straight through.
 *
 * The last block here pins what a listed URL MEANS. Alone it is one document,
 * as it always was. Alongside a `crawl` block it is a listing SEED and gets
 * the same feed-first selection `crawl.startUrl` gets, which is the shape a
 * registry-driven source is in: one entry URL per site, and the sites that
 * publish an ics feed must be read from the feed rather than as one 800 KB
 * page of HTML.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webConnector } from './web';

type Progress = { kind: string; uri?: string; message?: string };

const REGISTRY = 'https://registry.test/sources';
const PAGE_HTML = '<!doctype html><html><head><title>A page</title></head><body><main><p>Body text.</p></main></body></html>';

/** The one URL a registry answers with, a site's events listing. */
const SEED = 'https://venue.test/events/';
/** The feed that listing advertises. */
const SEED_ICS = 'https://venue.test/events.ics';
/** A detail page linked from the listing. */
const SEED_DETAIL = 'https://venue.test/shows/opening';
/** A `crawl.startUrl` no test wants read: the listed seeds are what count. */
const START_URL = 'https://venue.test/never-used/';

const TWO_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Venue//EN
BEGIN:VEVENT
UID:evt-1@venue.test
SUMMARY:Opening Night
DTSTART;TZID=America/New_York:20261101T193000
END:VEVENT
BEGIN:VEVENT
UID:evt-2@venue.test
SUMMARY:Second Night
DTSTART;TZID=America/New_York:20261108T193000
END:VEVENT
END:VCALENDAR`;

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

/** A plain HTML page, whatever the URL. */
function htmlPage(): Response {
  return new Response(PAGE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
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

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('urlsFrom, the shapes a registry can answer with', () => {
  it('reads a bare array of URL strings', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json(['https://a.test/one', 'https://a.test/two'])
      : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs.map(d => d.externalId)).toEqual(['https://a.test/one', 'https://a.test/two']);
    expect(errors(events)).toEqual([]);
  });

  it('reads a top-level `urls` array', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json({ urls: ['https://a.test/one'] })
      : htmlPage());

    const { docs } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs.map(d => d.externalId)).toEqual(['https://a.test/one']);
  });

  it('reads objects at a dotted `arrayPath`, keyed by `urlKey`', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json({ data: { items: [{ href: 'https://a.test/one' }, { href: 'https://a.test/two' }] } })
      : htmlPage());

    const { docs } = await run({ urlsFrom: { url: REGISTRY, arrayPath: 'data.items', urlKey: 'href' } });

    expect(docs.map(d => d.externalId)).toEqual(['https://a.test/one', 'https://a.test/two']);
  });
});

describe('urlsFrom, the protocol gate', () => {
  it('keeps http and https, rewrites webcal, and drops every other scheme', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json([
          'https://a.test/keep',
          'http://a.test/keep-too',
          'webcal://a.test/cal.ics',
          'file:///etc/passwd',
          'javascript:alert(1)',
          'data:text/html,<p>x',
          'not a url at all',
          42,
        ])
      : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs.map(d => d.externalId)).toEqual([
      'https://a.test/keep',
      'http://a.test/keep-too',
      'https://a.test/cal.ics',
    ]);
    expect(errors(events)).toEqual([]);
    expect(events.some(e => e.kind === 'skipped' && e.message?.includes('5 unusable'))).toBe(true);
  });

  it('keeps a very long entry, because a registry has no length budget', async () => {
    const long = `https://a.test/${'x'.repeat(2500)}`;
    stubFetch(url => url === REGISTRY ? Response.json([long]) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    // The feed paths cap what a document may DECLARE about itself, because a
    // hostile feed writes that row. A registry is a list a person configured,
    // so it gets no such ceiling and the two must not share one check.
    expect(docs.map(d => d.externalId)).toEqual([long]);
    expect(errors(events)).toEqual([]);
  });
});

describe('urlsFrom, dedupe and cap', () => {
  it('drops repeats, caps at `maxUrls`, and says so once', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json([
          'https://a.test/one',
          'https://a.test/one',
          'https://a.test/two',
          'https://a.test/three',
        ])
      : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY, maxUrls: 2 } });
    const notes = events.filter(e => e.kind === 'skipped' && e.uri === REGISTRY);

    expect(docs.map(d => d.externalId)).toEqual(['https://a.test/one', 'https://a.test/two']);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toBe('URL list: 2 of 4 (1 duplicate, capped at 2)');
  });
});

describe('urlsFrom, a 200 with an empty array', () => {
  it('is a no-op: one skipped event, no error, nothing ingested', async () => {
    const fetchFn = stubFetch(url => url === REGISTRY ? Response.json([]) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toEqual([]);
    expect(events).toEqual([{ kind: 'skipped', uri: REGISTRY, message: 'the URL list is empty' }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('is still a no-op when the empty array sits at `arrayPath`', async () => {
    stubFetch(url => url === REGISTRY ? Response.json({ data: [] }) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY, arrayPath: 'data' } });

    expect(docs).toEqual([]);
    expect(errors(events)).toEqual([]);
  });
});

describe('urlsFrom, failure is one connector-scope error', () => {
  it('reports a fetch that throws', async () => {
    stubFetch(() => undefined);

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toContain('could not be read');
  });

  it('reports a non-2xx', async () => {
    stubFetch(url => url === REGISTRY ? new Response('nope', { status: 503 }) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toBe('the URL list answered HTTP 503');
  });

  it('reports a body that is not JSON', async () => {
    stubFetch(url => url === REGISTRY ? htmlPage() : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toBe('the URL list is not JSON');
  });

  it('reports a body with no array in it', async () => {
    stubFetch(url => url === REGISTRY ? Response.json({ total: 0 }) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY, arrayPath: 'data.items' } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toBe('the URL list holds no array at `data.items`');
  });

  it('reports a non-empty body whose entries are all unusable', async () => {
    stubFetch(url => url === REGISTRY ? Response.json(['file:///etc/passwd', { nope: 1 }]) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toBe('the URL list holds 2 entries and no usable URL');
  });
});

describe('urlsFrom alongside `urls`', () => {
  it('fetches both lists, deduplicated', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json(['https://a.test/one', 'https://a.test/three'])
      : htmlPage());

    const { docs } = await run({
      urls: ['https://a.test/one', 'https://a.test/two'],
      urlsFrom: { url: REGISTRY },
    });

    expect(docs.map(d => d.externalId)).toEqual([
      'https://a.test/one',
      'https://a.test/two',
      'https://a.test/three',
    ]);
  });
});

describe('a listed URL alongside a crawl block', () => {
  it('a listed URL with a crawl block goes through feed discovery and reads the feed', async () => {
    const fetchFn = stubFetch((url) => {
      if (url === REGISTRY) {
        return Response.json([SEED]);
      }
      if (url === SEED) {
        return listing('<link rel="alternate" type="text/calendar" href="/events.ics">');
      }
      return url === SEED_ICS ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined;
    });

    const { docs, events } = await run({
      urlsFrom: { url: REGISTRY },
      crawl: { startUrl: START_URL, maxDepth: 1, maxPages: 60 },
    });

    expect(docs.map(d => d.externalId)).toEqual([
      `${SEED_ICS}#evt-1@venue.test`,
      `${SEED_ICS}#evt-2@venue.test`,
    ]);
    expect(events.some(e => e.message === 'source: discovered ics feed, 2 documents')).toBe(true);
    expect(errors(events)).toEqual([]);
    // The registry, the listing, the feed. `startUrl` is never touched.
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('a listed URL with a crawl block and no feed becomes the listing plus one level of detail pages', async () => {
    stubFetch((url) => {
      if (url === REGISTRY) {
        return Response.json([SEED]);
      }
      if (url === SEED) {
        return listing('', '<p><a href="/shows/opening">Opening Night</a></p>');
      }
      return url === SEED_DETAIL ? listing('', '<p>Opening Night, 7:30pm.</p>') : undefined;
    });

    const { docs, events } = await run({
      urlsFrom: { url: REGISTRY },
      crawl: { startUrl: START_URL, maxDepth: 1 },
    });

    expect(docs.map(d => d.externalId)).toEqual([SEED, SEED_DETAIL]);
    expect(events.some(e => e.message?.startsWith('source: listing + depth-1 crawl'))).toBe(true);
    expect(errors(events)).toEqual([]);
  });

  it('a listed URL without a crawl block is fetched as one document, as before', async () => {
    const fetchFn = stubFetch((url) => {
      if (url === REGISTRY) {
        return Response.json([SEED]);
      }
      return url === SEED
        ? listing(
            '<link rel="alternate" type="text/calendar" href="/events.ics">',
            '<p><a href="/shows/opening">Opening Night</a></p>',
          )
        : undefined;
    });

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    // No crawl block, so no discovery and no crawl: the listing IS the document.
    expect(docs.map(d => d.externalId)).toEqual([SEED]);
    expect(events.some(e => e.message === 'source: 1 listed URL')).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('an empty registry answer with a crawl block still yields nothing and does not crawl startUrl', async () => {
    const fetchFn = stubFetch(url => url === REGISTRY ? Response.json([]) : undefined);

    const { docs, events } = await run({
      urlsFrom: { url: REGISTRY },
      crawl: { startUrl: START_URL, maxDepth: 1 },
    });

    // An empty list is how a source row is switched off. Falling back to
    // `startUrl` here is how a switched-off source spends money.
    expect(docs).toEqual([]);
    expect(errors(events)).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('spends ONE page budget across every seed, not one each', async () => {
    const OTHER_SEED = 'https://other.test/events/';
    const fetchFn = stubFetch((url) => {
      if (url === REGISTRY) {
        return Response.json([SEED, OTHER_SEED]);
      }
      if (url === SEED) {
        return listing('', '<p><a href="/shows/opening">One</a> <a href="/shows/second">Two</a></p>');
      }
      if (url === SEED_DETAIL || url === 'https://venue.test/shows/second') {
        return listing('', '<p>A show.</p>');
      }
      return url === OTHER_SEED ? listing() : undefined;
    });

    const { events } = await run({
      urlsFrom: { url: REGISTRY },
      crawl: { startUrl: START_URL, maxDepth: 1, maxPages: 3 },
    });

    // The registry, then three pages: the first seed's listing and its two
    // detail pages. The second seed never gets read, which is the whole point
    // of one counter: five seeds at 60 pages each is 300 requests a run.
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(events.some(e => e.uri === OTHER_SEED && e.message?.startsWith('source: page budget spent'))).toBe(true);
  });

  it('a configured feedUrl wins over listed URLs', async () => {
    const fetchFn = stubFetch(url => url === SEED_ICS ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined);

    const { docs, events } = await run({
      urls: [SEED],
      feedUrl: SEED_ICS,
      crawl: { startUrl: START_URL },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(docs).toHaveLength(2);
    expect(events.some(e => e.message === 'source: configured feed')).toBe(true);
  });
});
