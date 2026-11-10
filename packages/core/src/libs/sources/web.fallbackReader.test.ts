/**
 * `fallbackReader: 'firecrawl'`: a page the site refused us as a bot is read
 * once more through Firecrawl and then read exactly like a page we fetched.
 * Without the setting, and for anything that is not a block, nothing changes:
 * the message a run records is the one it recorded before the setting existed.
 *
 * Every fetch is stubbed, Firecrawl's included, and the key lookup is mocked.
 */
import type { CrawlPoliteness } from './robots';
import type { SourceContext, SourceProgressEvent } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();

vi.mock('@/libs/tools/orgKey', () => ({
  resolveToolProviderKey: (provider: string, orgId: string) => resolveToolProviderKey(provider, orgId),
}));

const { webConnector } = await import('./web');

const FIRECRAWL = 'https://api.firecrawl.dev/v2/scrape';
const SHOWS = 'https://bellwater.test/shows';
const DETAIL = 'https://bellwater.test/shows/quartet-night';
/** Byte for byte what a run without the setting has always recorded for the block page below. */
const TODAYS_MESSAGE = 'HTTP 403 · server: edge-proxy · cf-mitigated: challenge · title: Just a moment...';

const originalApiKey = process.env.FIRECRAWL_API_KEY;

/** Every request the connector made: the site's URL, or Firecrawl's with the page it asked for. */
type Call = { url: string; scraped?: string };
const calls: Call[] = [];

/** A bot wall as an edge network serves it. */
function blockPage(): Response {
  return new Response('<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>', {
    status: 403,
    headers: { 'content-type': 'text/html; charset=UTF-8', 'server': 'edge-proxy', 'cf-mitigated': 'challenge' },
  });
}

/** The listing as Firecrawl renders it: a sidebar the source ignores, and one show it links to. */
const RENDERED_LISTING = `<html><head><title>Shows at Bellwater Hall</title></head><body>
  <aside class="promo">Members save 10% <a href="/shows/members-only">members</a></aside>
  <main><h1>Shows</h1><p>Quartet Night, Friday 8pm.</p><a href="/shows/quartet-night">Quartet Night</a></main>
</body></html>`;
const RENDERED_DETAIL = '<html><head><title>Quartet Night</title></head><body><main><p>Quartet Night, doors 7:30pm.</p></main></body></html>';

/**
 * A Firecrawl v2 scrape answer.
 * @param rawHtml - the rendered DOM.
 * @param statusCode - the rendered page's own status.
 */
function scraped(rawHtml: string, statusCode = 200): Response {
  return new Response(JSON.stringify({ success: true, data: { rawHtml, metadata: { statusCode, creditsUsed: 1 } } }), {
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A Firecrawl v2 scrape answer carrying the type and landed URL it reported.
 * @param rawHtml - the body Firecrawl returned.
 * @param contentType - the page's own content type.
 * @param url - where the page landed after redirects.
 */
function scrapedAs(rawHtml: string, contentType: string, url: string): Response {
  return new Response(JSON.stringify({ success: true, data: { rawHtml, metadata: { statusCode: 200, creditsUsed: 1, contentType, url } } }), {
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Answer the site's URLs from `site` and Firecrawl's from `firecrawl`.
 * @param site - the site's answer for a URL, or undefined for an unexpected one.
 * @param firecrawl - Firecrawl's answer for the page it was asked to read.
 */
function stubFetch(site: (url: string) => Response | undefined, firecrawl: (page: string) => Response = () => scraped(RENDERED_LISTING)): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === FIRECRAWL) {
      const { url: page } = JSON.parse(String(init?.body)) as { url: string };
      calls.push({ url, scraped: page });
      return firecrawl(page);
    }
    calls.push({ url });
    const res = site(url);
    if (!res) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return res;
  }));
}

const firecrawlCalls = (): Call[] => calls.filter(call => call.url === FIRECRAWL);

/**
 * Run one sync to completion, keeping its documents and progress events.
 * @param config - the connector config under test.
 * @param politeness - robots.txt and pacing, when the case needs them.
 */
async function run(config: Record<string, unknown>, politeness?: CrawlPoliteness): Promise<{ docs: IngestDoc[]; events: SourceProgressEvent[] }> {
  const events: SourceProgressEvent[] = [];
  const ctx: SourceContext = { sourceId: 1, orgId: 'org_bellwater', config, politeness, onProgress: e => events.push(e) };
  const docs = await Array.fromAsync(webConnector.sync(ctx));
  return { docs, events };
}

const errors = (events: SourceProgressEvent[]): SourceProgressEvent[] => events.filter(e => e.kind === 'error');

beforeEach(() => {
  calls.length = 0;
  resolveToolProviderKey.mockReset();
  resolveToolProviderKey.mockResolvedValue('fc-bellwater');
  process.env.FIRECRAWL_API_KEY = 'fc-server';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) {
    delete process.env.FIRECRAWL_API_KEY;
  } else {
    process.env.FIRECRAWL_API_KEY = originalApiKey;
  }
});

describe('a source without the setting', () => {
  it('absent setting: one fetch, today\'s message', async () => {
    stubFetch(url => url === SHOWS ? blockPage() : undefined);

    const { events } = await run({ urls: [SHOWS] });

    expect(calls).toEqual([{ url: SHOWS }]);
    expect(errors(events)).toEqual([{
      kind: 'error',
      uri: SHOWS,
      message: TODAYS_MESSAGE,
      detail: { status: 403, headers: { 'server': 'edge-proxy', 'cf-mitigated': 'challenge' }, title: 'Just a moment...' },
    }]);
    expect(resolveToolProviderKey).not.toHaveBeenCalled();
  });

  it('refuses a fallback reader it does not know', () => {
    expect(webConnector.configSchema.safeParse({ urls: [SHOWS], fallbackReader: 'always' }).success).toBe(false);
    expect(webConnector.configSchema.safeParse({ urls: [SHOWS], fallbackReader: 'firecrawl' }).success).toBe(true);
  });
});

describe('a blocked page with the setting on', () => {
  it('a page read via Firecrawl says so, and is read like a fetched page', async () => {
    stubFetch(url => url === SHOWS ? blockPage() : undefined);

    const { docs, events } = await run({ urls: [SHOWS], fallbackReader: 'firecrawl', ignore: ['aside.promo'] });

    expect(firecrawlCalls()).toEqual([{ url: FIRECRAWL, scraped: SHOWS }]);
    expect(errors(events)).toEqual([]);
    expect(events).toContainEqual({ kind: 'fetched', uri: SHOWS, reader: 'firecrawl', blockedBy: 'HTTP 403', creditsUsed: 1 });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ externalId: SHOWS, title: 'Shows at Bellwater Hall', metadata: { contentType: 'text/html', readVia: 'firecrawl' } });
    expect(docs[0]!.content).toContain('Quartet Night, Friday 8pm.');
    // `ignore` reaches the rendered page the same as a fetched one.
    expect(docs[0]!.content).not.toContain('Members save');
  });

  it('crawls the links of the rendered listing, and reads a detail page directly when it answers', async () => {
    stubFetch((url) => {
      if (url === SHOWS) {
        return blockPage();
      }
      if (url === DETAIL) {
        return new Response(RENDERED_DETAIL, { headers: { 'content-type': 'text/html' } });
      }
      return undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: SHOWS, maxDepth: 1 }, fallbackReader: 'firecrawl', ignore: ['aside.promo'] });

    expect(firecrawlCalls()).toHaveLength(1);
    expect(docs.map(doc => doc.externalId)).toEqual([SHOWS, DETAIL]);
    expect(docs[1]!.metadata).not.toHaveProperty('readVia');
    expect(events).toContainEqual({ kind: 'fetched', uri: DETAIL });
    // The link only the ignored sidebar held is never followed.
    expect(calls.map(call => call.url)).not.toContain('https://bellwater.test/shows/members-only');
  });

  it('both fail: message carries both', async () => {
    stubFetch(url => url === SHOWS ? blockPage() : undefined, () => scraped('<html><title>Just a moment...</title></html>', 403));

    const { docs, events } = await run({ urls: [SHOWS], fallbackReader: 'firecrawl' });

    expect(docs).toEqual([]);
    expect(errors(events)).toEqual([{
      kind: 'error',
      uri: SHOWS,
      message: `${TODAYS_MESSAGE} · firecrawl: still blocked (HTTP 403)`,
      detail: {
        status: 403,
        headers: { 'server': 'edge-proxy', 'cf-mitigated': 'challenge' },
        title: 'Just a moment...',
        fallback: { reader: 'firecrawl', outcome: 'still blocked (HTTP 403)', status: 403, creditsUsed: 1 },
      },
    }]);
  });

  it('says Firecrawl is not set up, beside the block, when nobody has a key', async () => {
    resolveToolProviderKey.mockResolvedValue(null);
    delete process.env.FIRECRAWL_API_KEY;
    stubFetch(url => url === SHOWS ? blockPage() : undefined);

    const { events } = await run({ urls: [SHOWS], fallbackReader: 'firecrawl' });

    expect(firecrawlCalls()).toEqual([]);
    expect(errors(events).map(e => e.message)).toEqual([`${TODAYS_MESSAGE} · firecrawl: not set up for this workspace`]);
  });

  it('spends at most 60 reads in one sync, and the next sync starts again at zero', async () => {
    const urls = Array.from({ length: 61 }, (_, page) => `https://bellwater.test/shows/${page}`);
    stubFetch(url => urls.includes(url) ? blockPage() : undefined, () => scraped(RENDERED_DETAIL));

    const first = await run({ urls, fallbackReader: 'firecrawl' });

    expect(firecrawlCalls()).toHaveLength(60);
    expect(first.docs).toHaveLength(60);
    expect(errors(first.events).map(e => [e.uri, e.message])).toEqual([[urls[60], `${TODAYS_MESSAGE} · firecrawl: run ceiling reached (60 per run)`]]);

    calls.length = 0;
    const second = await run({ urls: urls.slice(0, 1), fallbackReader: 'firecrawl' });

    expect(firecrawlCalls()).toHaveLength(1);
    expect(errors(second.events)).toEqual([]);
  });
});

describe('what Firecrawl returned is read as what it is', () => {
  it('a blocked feed is still split into its events, each saying how it was read', async () => {
    const feedUrl = 'https://bellwater.test/events.ics';
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:quartet-night@bellwater.test',
      'SUMMARY:Quartet Night',
      'DTSTART:20261204T200000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:open-stage@bellwater.test',
      'SUMMARY:Open Stage',
      'DTSTART:20261211T200000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    stubFetch(url => url === feedUrl ? blockPage() : undefined, () => scrapedAs(ics, 'text/calendar; charset=utf-8', feedUrl));

    const { docs, events } = await run({ feedUrl, crawl: { startUrl: SHOWS }, fallbackReader: 'firecrawl' });

    expect(errors(events)).toEqual([]);
    expect(docs.map(doc => doc.title)).toEqual(['Quartet Night', 'Open Stage']);

    for (const doc of docs) {
      expect(doc.metadata).toMatchObject({ contentType: 'text/calendar; charset=utf-8', feedUrl, readVia: 'firecrawl' });
    }
  });

  it('resolves the rendered page\'s links against where it landed after a redirect', async () => {
    const listing = '<html><head><title>Shows</title></head><body><main><p>Quartet Night, Friday 8pm.</p><a href="quartet-night">Quartet Night</a></main></body></html>';
    stubFetch((url) => {
      if (url === SHOWS) {
        return blockPage();
      }
      return url === DETAIL ? new Response(RENDERED_DETAIL, { headers: { 'content-type': 'text/html' } }) : undefined;
    }, () => scrapedAs(listing, 'text/html; charset=UTF-8', `${SHOWS}/`));

    const { docs } = await run({ crawl: { startUrl: SHOWS, maxDepth: 1 }, fallbackReader: 'firecrawl' });

    // Against the requested `/shows` the link would be `/quartet-night`; it landed on `/shows/`.
    expect(docs.map(doc => doc.externalId)).toEqual([SHOWS, DETAIL]);
    expect(calls.map(call => call.url)).not.toContain('https://bellwater.test/quartet-night');
  });

  it('a type the connector cannot read is skipped as a direct fetch of it is', async () => {
    stubFetch(url => url === SHOWS ? blockPage() : undefined, () => scrapedAs('%PDF-1.7', 'application/pdf', SHOWS));

    const { docs, events } = await run({ urls: [SHOWS], fallbackReader: 'firecrawl' });

    expect(docs).toEqual([]);
    expect(errors(events)).toEqual([]);
    expect(events).toContainEqual({ kind: 'skipped', uri: SHOWS, message: 'unsupported content-type: application/pdf', reader: 'firecrawl', blockedBy: 'HTTP 403', creditsUsed: 1 });
  });
});

describe('what never reaches Firecrawl', () => {
  it('a probe never reaches Firecrawl', async () => {
    const ics = 'https://bellwater.test/events.ics';
    stubFetch((url) => {
      if (url === SHOWS) {
        return new Response('<html><head><title>Shows</title><link rel="alternate" type="text/calendar" href="/events.ics"></head><body><main><p>Our shows.</p></main></body></html>', { headers: { 'content-type': 'text/html' } });
      }
      return url === ics ? blockPage() : undefined;
    });

    const { events } = await run({ crawl: { startUrl: SHOWS, maxDepth: 0 }, fallbackReader: 'firecrawl' });

    expect(firecrawlCalls()).toEqual([]);
    expect(events.find(e => e.uri === ics)).toEqual({ kind: 'skipped', uri: ics, message: 'HTTP 403' });
  });

  it.each([
    ['a 404', () => new Response('<html><head><title>Not found</title></head></html>', { status: 404, headers: { 'content-type': 'text/html', 'server': 'edge-proxy' } }), 'HTTP 404 · server: edge-proxy · title: Not found'],
    ['a bare 500', () => new Response(null, { status: 500 }), 'HTTP 500'],
  ])('%s is reported as today, with no Firecrawl read', async (_case, answer, message) => {
    stubFetch(url => url === SHOWS ? answer() : undefined);

    const { events } = await run({ urls: [SHOWS], fallbackReader: 'firecrawl' });

    expect(firecrawlCalls()).toEqual([]);
    expect(errors(events).map(e => e.message)).toEqual([message]);
  });

  it('a timeout or network failure is reported as today, with no Firecrawl read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push({ url: String(input) });
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }));

    const { events } = await run({ urls: [SHOWS], fallbackReader: 'firecrawl' });

    expect(firecrawlCalls()).toEqual([]);
    expect(errors(events).map(e => e.message)).toEqual(['The operation was aborted due to timeout']);
  });

  it('an unsupported content type is skipped as today, with no Firecrawl read', async () => {
    stubFetch(url => url === SHOWS ? new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }) : undefined);

    const { events } = await run({ urls: [SHOWS], fallbackReader: 'firecrawl' });

    expect(firecrawlCalls()).toEqual([]);
    expect(events).toContainEqual({ kind: 'skipped', uri: SHOWS, message: 'unsupported content-type: application/pdf' });
  });

  it('a URL robots.txt disallows is fetched by neither reader', async () => {
    stubFetch(url => url === 'https://bellwater.test/robots.txt'
      ? new Response('User-agent: *\nDisallow: /shows', { headers: { 'content-type': 'text/plain' } })
      : undefined);

    const { events } = await run({ urls: [SHOWS], fallbackReader: 'firecrawl' }, { robots: true, minDelayMs: 0, maxDelayMs: 0 });

    expect(calls).toEqual([{ url: 'https://bellwater.test/robots.txt' }]);
    expect(events).toContainEqual({ kind: 'skipped', uri: SHOWS, message: 'disallowed by robots.txt' });
  });
});
