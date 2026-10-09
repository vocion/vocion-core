/**
 * robots.txt and pacing: the web connector as a guest on someone else's site.
 */
import type { CrawlPoliteness } from './robots';
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crawlPoliteness, DEFAULT_CRAWL_POLITENESS, fetchRobots, parseRobots, productToken } from './robots';
import { USER_AGENT, webConnector } from './web';

type Progress = { kind: string; uri?: string; message?: string };

const TOKEN = productToken(USER_AGENT);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function page(title: string): Response {
  return new Response(
    `<!doctype html><html><head><title>${title}</title></head><body><main><p>${title}</p></main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

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

async function run(urls: string[], politeness?: CrawlPoliteness): Promise<{ docs: IngestDoc[]; events: Progress[] }> {
  const events: Progress[] = [];
  const ctx: SourceContext = {
    sourceId: 1,
    orgId: 'org_test',
    config: { urls },
    politeness,
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

const PROMPT: CrawlPoliteness = { robots: true, minDelayMs: 0, maxDelayMs: 0 };

describe('productToken', () => {
  it('is the name before the version, lower case', () => {
    expect(TOKEN).toBe('vocionbot');
  });
});

describe('parseRobots', () => {
  it('allows everything when no group applies', () => {
    const policy = parseRobots('User-agent: SomeoneElse\nDisallow: /', TOKEN);

    expect(policy.allows('/anything')).toBe(true);
  });

  it('obeys the * group', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /private', TOKEN);

    expect(policy.allows('/private/page')).toBe(false);
    expect(policy.allows('/public')).toBe(true);
  });

  it('prefers a group naming the crawler over *', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: VocionBot\nAllow: /', TOKEN);

    expect(policy.allows('/events/')).toBe(true);
  });

  it('reads several user-agent lines as one group', () => {
    const policy = parseRobots('User-agent: OtherBot\nUser-agent: VocionBot\nDisallow: /admin', TOKEN);

    expect(policy.allows('/admin/x')).toBe(false);
  });

  it('lets the longest matching rule decide, and Allow win a tie', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /events\nAllow: /events/public\nAllow: /a\nDisallow: /a', TOKEN);

    expect(policy.allows('/events/public/show')).toBe(true);
    expect(policy.allows('/events/members')).toBe(false);
    expect(policy.allows('/a')).toBe(true);
  });

  it('understands * and the $ end anchor, and counts the query string', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?print=', TOKEN);

    expect(policy.allows('/files/menu.pdf')).toBe(false);
    expect(policy.allows('/files/menu.pdf?v=2')).toBe(true);
    expect(policy.allows('/shows?print=1')).toBe(false);
  });

  it('treats an empty Disallow as allowing everything, and ignores comments', () => {
    const policy = parseRobots('# house rules\nUser-agent: *  # everyone\nDisallow:\n', TOKEN);

    expect(policy.allows('/')).toBe(true);
  });

  it('reads the chosen group\'s Crawl-delay', () => {
    const policy = parseRobots('User-agent: *\nCrawl-delay: 10\nDisallow: /tmp', TOKEN);

    expect(policy.crawlDelaySeconds).toBe(10);
  });
});

describe('fetchRobots', () => {
  it('parses a 200 body', async () => {
    stubFetch(() => new Response('User-agent: *\nDisallow: /private'));
    const policy = await fetchRobots('https://venue.test', USER_AGENT);

    expect(policy.allows('/private')).toBe(false);
  });

  it('reads a 4xx as no rules', async () => {
    stubFetch(() => new Response('not here', { status: 404 }));

    expect((await fetchRobots('https://venue.test', USER_AGENT)).allows('/anything')).toBe(true);
  });

  it('keeps off the whole site on a 5xx, and says why', async () => {
    stubFetch(() => new Response('down', { status: 503 }));
    const policy = await fetchRobots('https://venue.test', USER_AGENT);

    expect(policy.allows('/')).toBe(false);
    expect(policy.refusedBecause).toContain('HTTP 503');
  });

  it('keeps off the whole site when the file cannot be reached', async () => {
    stubFetch(() => undefined);
    const policy = await fetchRobots('https://venue.test', USER_AGENT);

    expect(policy.refusedBecause).toContain('robots.txt unreachable');
  });
});

describe('crawlPoliteness', () => {
  it('obeys robots.txt when the process says nothing', () => {
    expect(crawlPoliteness()).toEqual(DEFAULT_CRAWL_POLITENESS);
  });

  it.each(['0', 'false', 'off', ' OFF '])('stops reading robots.txt for VOCION_CRAWL_ROBOTS=%j, and keeps the pacing', (value) => {
    vi.stubEnv('VOCION_CRAWL_ROBOTS', value);

    expect(crawlPoliteness()).toEqual({ ...DEFAULT_CRAWL_POLITENESS, robots: false });
  });

  it('keeps obeying for any other value', () => {
    vi.stubEnv('VOCION_CRAWL_ROBOTS', '1');

    expect(crawlPoliteness().robots).toBe(true);
  });
});

describe('a polite run', () => {
  it('never asks for robots.txt when the run carries no policy', async () => {
    const fetchFn = stubFetch(url => (url.endsWith('/robots.txt') ? undefined : page('Show')));
    const { docs } = await run(['https://venue.test/a']);

    expect(docs).toHaveLength(1);
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual(['https://venue.test/a']);
  });

  it('reads robots.txt once per site and skips what it disallows, saying so', async () => {
    const fetchFn = stubFetch(url => (url.endsWith('/robots.txt')
      ? new Response('User-agent: *\nDisallow: /members')
      : page('Show')));
    const { docs, events } = await run(['https://venue.test/a', 'https://venue.test/members/b', 'https://venue.test/c'], PROMPT);
    const fetched = fetchFn.mock.calls.map(c => String(c[0]));

    expect(fetched.filter(u => u.endsWith('/robots.txt'))).toHaveLength(1);
    expect(fetched).not.toContain('https://venue.test/members/b');
    expect(docs).toHaveLength(2);
    expect(events).toContainEqual({ kind: 'skipped', uri: 'https://venue.test/members/b', message: 'disallowed by robots.txt' });
  });

  it('fetches what robots.txt disallows when the run is told not to read it', async () => {
    const fetchFn = stubFetch(url => (url.endsWith('/robots.txt')
      ? new Response('User-agent: *\nDisallow: /')
      : page('Show')));
    const { docs, events } = await run(['https://venue.test/events?format=json', 'https://venue.test/b'], { ...PROMPT, robots: false });
    const fetched = fetchFn.mock.calls.map(c => String(c[0]));

    expect(fetched).not.toContain('https://venue.test/robots.txt');
    expect(docs).toHaveLength(2);
    expect(events.filter(e => e.message?.includes('robots.txt'))).toHaveLength(0);
  });

  it('skips the site for the run when robots.txt answers a 5xx', async () => {
    const fetchFn = stubFetch(url => (url.endsWith('/robots.txt') ? new Response('down', { status: 503 }) : page('Show')));
    const { docs, events } = await run(['https://venue.test/a', 'https://venue.test/b'], PROMPT);

    expect(docs).toHaveLength(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.kind === 'skipped' && e.message?.includes('HTTP 503'))).toHaveLength(2);
    expect(events.filter(e => e.kind === 'error')).toHaveLength(0);
  });

  it('waits the default gap between two requests to one site', async () => {
    vi.useFakeTimers();
    const stamps: Array<[string, number]> = [];
    stubFetch((url) => {
      stamps.push([url, Date.now()]);
      return url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : page('Show');
    });
    const done = run(['https://venue.test/a', 'https://venue.test/b'], { robots: true, minDelayMs: 1_000, maxDelayMs: 30_000 });
    await vi.runAllTimersAsync();
    await done;
    const times = stamps.map(([, at]) => at);

    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1_000);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(1_000);
  });

  it('honours a longer Crawl-delay, up to the cap', async () => {
    vi.useFakeTimers();
    const stamps: number[] = [];
    stubFetch((url) => {
      stamps.push(Date.now());
      return url.endsWith('/robots.txt') ? new Response('User-agent: *\nCrawl-delay: 120') : page('Show');
    });
    const done = run(['https://venue.test/a', 'https://venue.test/b'], { robots: true, minDelayMs: 1_000, maxDelayMs: 30_000 });
    await vi.runAllTimersAsync();
    await done;

    expect(stamps[2]! - stamps[1]!).toBe(30_000);
  });
});
