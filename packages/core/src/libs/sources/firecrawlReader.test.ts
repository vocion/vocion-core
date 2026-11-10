/**
 * A blocked page's second read through Firecrawl: which key it spends, what it
 * asks Firecrawl for, how every failure reads, and the per-run ceiling.
 *
 * Firecrawl and the credential lookup are both mocked; no test here makes a
 * network call or touches the database.
 */
import type { FirecrawlRun } from './firecrawlReader';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();

vi.mock('@/libs/tools/orgKey', () => ({
  resolveToolProviderKey: (provider: string, orgId: string) => resolveToolProviderKey(provider, orgId),
}));

const { FIRECRAWL_READS_PER_RUN, readThroughFirecrawl } = await import('./firecrawlReader');
const { ToolProviderKeyUnavailableError } = await import('@/libs/tools/types');

const PAGE_URL = 'https://bellwater.test/shows';
const RENDERED = '<html><head><title>Shows</title></head><body><main>Bellwater Hall, Friday 8pm</main></body></html>';
const originalApiKey = process.env.FIRECRAWL_API_KEY;

type Sent = { url: string; authorization: string | undefined; body: Record<string, unknown> };
const sent: Sent[] = [];

/**
 * Answer every Firecrawl call with one response, keeping what was sent.
 * @param answer - builds the response for each call.
 */
function stubFirecrawl(answer: () => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url: String(input), authorization: headers.get('authorization') ?? undefined, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return answer();
  }));
}

/**
 * A v2 scrape answer as JSON.
 * @param body - the answer's body.
 * @param status - the HTTP status Firecrawl answered with.
 */
function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A successful scrape of the rendered page.
 * @param statusCode - the rendered page's own status.
 */
function rendered(statusCode = 200): Response {
  return answer({ success: true, data: { rawHtml: RENDERED, metadata: { statusCode, creditsUsed: 1, proxyUsed: 'basic' } } });
}

const fresh = (): FirecrawlRun => ({ reads: 0 });

beforeEach(() => {
  sent.length = 0;
  resolveToolProviderKey.mockReset();
  resolveToolProviderKey.mockResolvedValue(null);
  process.env.FIRECRAWL_API_KEY = 'fc-server';
  stubFirecrawl(() => rendered());
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) {
    delete process.env.FIRECRAWL_API_KEY;
  } else {
    process.env.FIRECRAWL_API_KEY = originalApiKey;
  }
});

describe('the key a read spends', () => {
  it('uses the workspace\'s stored key in preference to the server\'s', async () => {
    resolveToolProviderKey.mockResolvedValue('fc-workspace');

    await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(resolveToolProviderKey).toHaveBeenCalledWith('firecrawl', 'org_bellwater');
    expect(sent[0]?.authorization).toBe('Bearer fc-workspace');
  });

  it('falls back to the server\'s key for a workspace that stored none', async () => {
    await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(sent[0]?.authorization).toBe('Bearer fc-server');
  });

  it('two orgs in sequence get their own key', async () => {
    resolveToolProviderKey.mockImplementation(async (_provider, orgId) => orgId === 'org_northwind' ? 'fc-northwind' : 'fc-kestrel');
    const run = fresh();

    await readThroughFirecrawl(PAGE_URL, 'org_northwind', run);
    await readThroughFirecrawl(PAGE_URL, 'org_kestrel', run);
    await readThroughFirecrawl(PAGE_URL, 'org_northwind', run);

    expect(sent.map(call => call.authorization)).toEqual(['Bearer fc-northwind', 'Bearer fc-kestrel', 'Bearer fc-northwind']);
    expect(resolveToolProviderKey).toHaveBeenCalledTimes(3);
  });

  it('says it is not set up, and calls nothing, when nobody has a key', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const run = fresh();

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', run);

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'not set up for this workspace' } });
    expect(sent).toHaveLength(0);
    expect(run.reads).toBe(0);
  });

  it('stops with a safe line, and never spends the server\'s key, when the stored key cannot be read', async () => {
    resolveToolProviderKey.mockRejectedValue(new ToolProviderKeyUnavailableError('firecrawl'));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'the workspace\'s stored Firecrawl key could not be read' } });
    expect(sent).toHaveLength(0);
  });
});

describe('what a read asks Firecrawl for', () => {
  it('posts to /v2/scrape with rawHtml, waitFor 5000, maxAge 0', async () => {
    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(sent[0]?.url).toBe('https://api.firecrawl.dev/v2/scrape');
    expect(sent[0]?.body).toEqual({ url: PAGE_URL, formats: ['rawHtml'], waitFor: 5000, maxAge: 0, timeout: 30000 });
    expect(read).toEqual({ ok: true, html: RENDERED, creditsUsed: 1 });
  });
});

describe('a read that fails', () => {
  it('reports Firecrawl\'s own HTTP refusal with its code and error', async () => {
    stubFirecrawl(() => answer({ success: false, code: 'PAYMENT_REQUIRED', error: 'Insufficient credits to perform this request.' }, 402));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'HTTP 402 PAYMENT_REQUIRED: Insufficient credits to perform this request.', status: 402 } });
  });

  it('reports a bare HTTP status when the refusal is not JSON', async () => {
    stubFirecrawl(() => new Response('<html>bad gateway</html>', { status: 502 }));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'HTTP 502', status: 502 } });
  });

  it('reports success:false as its code and error', async () => {
    stubFirecrawl(() => answer({ success: false, code: 'SCRAPE_ACTION_ERROR', error: 'Element not found' }));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'SCRAPE_ACTION_ERROR: Element not found', status: 200 } });
  });

  it('a rendered block is still a block', async () => {
    stubFirecrawl(() => rendered(403));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'still blocked (HTTP 403)', status: 403, creditsUsed: 1 } });
  });

  it('a rendered page that is gone is a failure with its status', async () => {
    stubFirecrawl(() => rendered(404));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'the rendered page answered HTTP 404', status: 404, creditsUsed: 1 } });
  });

  it('an empty rendered page is a failure, never an empty success', async () => {
    stubFirecrawl(() => answer({ success: true, data: { rawHtml: '   ', metadata: { statusCode: 200, creditsUsed: 1 } } }));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'empty page', status: 200, creditsUsed: 1 } });
  });

  it('a request that times out says so', async () => {
    stubFirecrawl(() => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'timed out after 35s' } });
  });

  it('a network failure says so without the error\'s own text', async () => {
    stubFirecrawl(() => Promise.reject(new TypeError('fetch failed')));

    const read = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(read).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'fetch failed' } });
  });
});

describe('the per-run ceiling', () => {
  it(`spends at most ${FIRECRAWL_READS_PER_RUN} reads in one run, and a new run starts at zero`, async () => {
    const run = fresh();
    const reads = [];
    for (let page = 0; page < FIRECRAWL_READS_PER_RUN + 1; page += 1) {
      reads.push(await readThroughFirecrawl(`${PAGE_URL}/${page}`, 'org_bellwater', run));
    }

    expect(FIRECRAWL_READS_PER_RUN).toBe(60);
    expect(sent).toHaveLength(60);
    expect(reads.slice(0, 60).every(read => read.ok)).toBe(true);
    expect(reads[60]).toEqual({ ok: false, failure: { reader: 'firecrawl', outcome: 'run ceiling reached (60 per run)' } });

    const next = await readThroughFirecrawl(PAGE_URL, 'org_bellwater', fresh());

    expect(next.ok).toBe(true);
    expect(sent).toHaveLength(61);
  });

  it('counts a read that failed at Firecrawl, since it may have cost a credit', async () => {
    stubFirecrawl(() => rendered(403));
    const run = fresh();

    await readThroughFirecrawl(PAGE_URL, 'org_bellwater', run);

    expect(run.reads).toBe(1);
  });
});
