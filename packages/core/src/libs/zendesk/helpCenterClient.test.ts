import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
/**
 * The anonymous Help Center client against a stubbed Zendesk: no network, no
 * real account. Each test pins a rule that a plausible edit would break: every
 * page is walked, the page cap says so, no credential ever goes out, a
 * transient failure is retried exactly once, and a missing article does not
 * hide the others.
 */
import type { HelpCenterDeps } from './helpCenterClient';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicFetchError } from '@/libs/net/publicFetch';
import { sendGet } from '@/libs/net/publicOnlyFetch';
import { listHelpCenterArticles, MAX_LIST_PAGES, MAX_RESPONSE_BYTES, readHelpCenterArticles } from './helpCenterClient';

const TARGET = { origin: 'https://help.example.com', locale: 'en-us' };

type Call = { url: string; init: RequestInit };

/**
 * A response with a JSON body.
 * @param status - HTTP status.
 * @param body - JSON body.
 * @param headers - Response headers.
 */
function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * One article as Zendesk sends it, with fields the client ignores.
 * @param id - Article id.
 * @param body - HTML body.
 */
function zendeskArticle(id: number, body = `<p>Body ${id}</p>`) {
  return { id, title: `Title ${id}`, body, html_url: `https://help.example.com/hc/en-us/articles/${id}`, updated_at: '2026-11-01T00:00:00Z', draft: false, author_id: 7 };
}

/**
 * Three pages: 100, 100 and 50 articles, 250 in all.
 * @param url - A list URL.
 */
function answerThreePages(url: string): Response {
  const page = pageOf(url);
  const articles = Array.from({ length: page === 3 ? 50 : 100 }, (_, i) => zendeskArticle(page * 1000 + i));
  return jsonResponse(200, { articles, count: 250, next_page: page === 3 ? null : `https://help.example.com/next?page=${page + 1}` });
}

/** How many article reads are open at once, and the most there ever were. */
const readConcurrency = { inFlight: 0, mostInFlight: 0 };

/**
 * Answers an article read after 10 ms, counting how many overlap.
 * @param url - An article URL ending in its id.
 */
async function answerSlowly(url: string): Promise<Response> {
  readConcurrency.inFlight += 1;
  readConcurrency.mostInFlight = Math.max(readConcurrency.mostInFlight, readConcurrency.inFlight);
  await new Promise(resolve => setTimeout(resolve, 10));
  readConcurrency.inFlight -= 1;
  return jsonResponse(200, { article: zendeskArticle(Number(url.split('/').pop())) });
}

/**
 * Deps that record every call and answer from a function.
 * @param answer - Builds the response for a call.
 */
function stubDeps(answer: (url: string, callNumber: number, init: RequestInit) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const deps: HelpCenterDeps = {
    fetch: (url, init) => recordAndAnswer(calls, answer, url, init),
    sleep: ms => recordSleep(sleeps, ms),
    checkHost: async () => ({ ok: true }),
    timeoutMs: 50,
  };
  return { deps, calls, sleeps };
}

/**
 * Records a call, then answers it.
 * @param calls - Every call so far, added to.
 * @param answer - Builds the response.
 * @param url - The requested URL.
 * @param init - The request init.
 */
async function recordAndAnswer(calls: Call[], answer: (url: string, callNumber: number, init: RequestInit) => Promise<Response> | Response, url: string, init: RequestInit): Promise<Response> {
  calls.push({ url, init });
  return answer(url, calls.length, init);
}

/**
 * Records a wait without waiting.
 * @param sleeps - Every wait so far, added to.
 * @param ms - The wait asked for.
 */
async function recordSleep(sleeps: number[], ms: number): Promise<void> {
  sleeps.push(ms);
}

/**
 * A fetch that never answers until its request is aborted, like a hung server.
 * @param _url - Ignored.
 * @param init - Carries the abort signal.
 */
function hangUntilAborted(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => rejectOnAbort(init.signal, reject));
}

/**
 * Rejects with an AbortError once the signal aborts.
 * @param signal - The request's abort signal.
 * @param reject - The promise's reject.
 */
function rejectOnAbort(signal: AbortSignal | null | undefined, reject: (reason: unknown) => void): void {
  signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
}

/**
 * The page number a list URL asks for.
 * @param url - A list URL.
 */
function pageOf(url: string): number {
  return Number(new URL(url).searchParams.get('page'));
}

/** Connections the counting server accepted. */
const connectionCounter = { count: 0 };

/**
 * Count a connection and drop it.
 * @param socket - The accepted socket.
 * @param socket.destroy - Closes it.
 */
function countAndDestroy(socket: { destroy: () => void }): void {
  connectionCounter.count += 1;
  socket.destroy();
}

/** What the slow local server saw: when the client's connection closed, and the servers to close. */
const slowServer: { closedAt: number; servers: Server[] } = { closedAt: 0, servers: [] };

/**
 * Notes that the client's connection closed and stops the drip.
 * @param drip - The interval that keeps sending the body.
 */
function recordConnectionClosed(drip: ReturnType<typeof setInterval>): void {
  clearInterval(drip);
  slowServer.closedAt = Date.now();
}

/**
 * Declares a 400 MB body, then sends a few bytes every 10 ms, like a server
 * that would keep a connection busy for minutes.
 * @param _request - Unused.
 * @param response - The response.
 */
function dripHugeBody(_request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(100 * MAX_RESPONSE_BYTES) });
  const drip = setInterval(() => response.write('x'.repeat(512)), 10);
  response.once('close', () => recordConnectionClosed(drip));
}

/**
 * Starts a local http server and returns its origin.
 * @param handler - Answers each request.
 */
async function serveLocally(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createHttpServer(handler);
  slowServer.servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * The real request code (`sendGet`) over plain http, so a local server can answer.
 * @param url - The full URL.
 * @param init - Request init, with the abort signal.
 */
function fetchOverLocalHttp(url: string, init: RequestInit): Promise<Response> {
  return sendGet(new URL(url), init, { requestFn: httpRequest as never, lookup: undefined as never });
}

afterEach(() => {
  vi.useRealTimers();
  for (const server of slowServer.servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  slowServer.closedAt = 0;
});

describe('listHelpCenterArticles', () => {
  it('walks every page, 100 at a time, and returns all of them', async () => {
    const { deps, calls } = stubDeps(answerThreePages);

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(result).toMatchObject({ ok: true, truncated: false, totalCount: 250 });
    expect(result.ok && result.articles).toHaveLength(250);
    expect(calls.map(call => call.url)).toEqual([1, 2, 3].map(page => `https://help.example.com/api/v2/help_center/en-us/articles?per_page=100&page=${page}`));
  });

  it('stops at the page cap and says it is truncated when more pages remain', async () => {
    const { deps, calls } = stubDeps(url => jsonResponse(200, { articles: [zendeskArticle(pageOf(url))], count: 5000, next_page: 'https://help.example.com/more' }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(MAX_LIST_PAGES);
    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(result.ok && result.articles).toHaveLength(MAX_LIST_PAGES);
  });

  it('stops at exactly 10 pages, the number the list tool promises', async () => {
    const { deps, calls } = stubDeps(url => jsonResponse(200, { articles: [zendeskArticle(pageOf(url))], next_page: 'https://help.example.com/more' }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(10);
    expect(calls.at(-1)!.url).toContain('page=10');
    expect(result).toMatchObject({ ok: true, truncated: true });
  });

  it('is not truncated when the last allowed page is also the last page', async () => {
    const { deps } = stubDeps(url => jsonResponse(200, { articles: [zendeskArticle(pageOf(url))], next_page: pageOf(url) === MAX_LIST_PAGES ? null : 'https://help.example.com/more' }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(result).toMatchObject({ ok: true, truncated: false });
  });

  it('fails the whole walk when a later page fails, rather than returning a list that looks complete', async () => {
    const { deps } = stubDeps(url => pageOf(url) === 1
      ? jsonResponse(200, { articles: [zendeskArticle(1)], next_page: 'https://help.example.com/more' })
      : jsonResponse(503, {}));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(result).toMatchObject({ ok: false, error: 'help_center_server_error', status: 503 });
  });

  it('refuses an answer with no articles list', async () => {
    const { deps } = stubDeps(() => jsonResponse(200, { results: [] }));

    expect(await listHelpCenterArticles(TARGET, deps)).toMatchObject({ ok: false, error: 'help_center_bad_response' });
  });
});

describe('what goes out on the wire', () => {
  it('sends no Authorization header and no other credential, on the list or on a read', async () => {
    const { deps, calls } = stubDeps(url => url.includes('per_page')
      ? jsonResponse(200, { articles: [zendeskArticle(1)], next_page: null })
      : jsonResponse(200, { article: zendeskArticle(1) }));

    await listHelpCenterArticles(TARGET, deps);
    await readHelpCenterArticles(TARGET, ['1'], deps);

    expect(calls).toHaveLength(2);

    for (const call of calls) {
      const headers = new Headers(call.init.headers);

      expect([...headers.keys()]).toEqual(['accept']);
      expect(call.init.method).toBe('GET');
    }
  });

  it('refuses redirects, so a 3xx cannot move the call to another host', async () => {
    const { deps, calls } = stubDeps(() => new Response(null, { status: 301, headers: { location: 'https://evil.example/' } }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls[0]!.init.redirect).toBe('manual');
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: false, error: 'help_center_redirected' });
  });

  it('makes no request at all to a host that does not resolve to a public address', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(200, { articles: [] }));

    const result = await listHelpCenterArticles(TARGET, { ...deps, checkHost: async () => ({ ok: false, reason: 'help.example.com resolves to 10.0.0.5, a private address.' }) });

    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, error: 'help_center_blocked_host' });
    expect(!result.ok && result.message).not.toContain('10.0.0.5');
  });
});

describe('the up-front host check', () => {
  it('gives up on a lookup that never answers, with a timeout error and no request', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(200, { articles: [] }));
    const neverResolves = () => new Promise<{ ok: true }>(() => {});

    const listed = await listHelpCenterArticles(TARGET, { ...deps, checkHost: neverResolves });
    const read = await readHelpCenterArticles(TARGET, ['5'], { ...deps, checkHost: neverResolves });

    expect(calls).toHaveLength(0);
    expect(listed).toMatchObject({ ok: false, error: 'help_center_timeout' });
    expect(!listed.ok && listed.message).toContain('Try again later; say it could not be read rather than guessing.');
    expect(read).toMatchObject({ ok: false, error: 'help_center_timeout' });
  });

  it('does not time out a lookup that answers in time', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(200, { articles: [], next_page: null }));

    const result = await listHelpCenterArticles(TARGET, { ...deps, checkHost: async () => ({ ok: true }) });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: true });
  });
});

describe('failure messages give a next step', () => {
  it('ends every transient failure with the same instruction as its siblings, and says a timeout was already retried', async () => {
    const timedOut = await listHelpCenterArticles(TARGET, stubDeps((url, _call, init) => hangUntilAborted(url, init)).deps);
    const unreachable = await listHelpCenterArticles(TARGET, stubDeps(() => Promise.reject(new Error('socket hang up'))).deps);

    for (const failure of [timedOut, unreachable]) {
      expect(!failure.ok && failure.message).toContain('Try again later; say it could not be read rather than guessing.');
    }

    expect(!timedOut.ok && timedOut.message).toContain('even after one retry');
  });

  it('says an over-size answer will not shrink on a retry and who to ask, instead of "try again later"', async () => {
    const tooLarge = await listHelpCenterArticles(TARGET, { ...stubDeps(() => jsonResponse(200, { articles: [zendeskArticle(1, 'x'.repeat(5000))] })).deps, maxResponseBytes: 1000 });

    expect(!tooLarge.ok && tooLarge.message).not.toContain('Try again later');
    expect(!tooLarge.ok && tooLarge.message).toContain('will not shrink on a retry');
  });

  it('does not tell the user to shorten "the article" when the oversize answer is the list of 100 articles; it asks for the article number instead', async () => {
    const tooLarge = await listHelpCenterArticles(TARGET, { ...stubDeps(() => jsonResponse(200, { articles: [zendeskArticle(1, 'x'.repeat(5000))] })).deps, maxResponseBytes: 1000 });

    expect(!tooLarge.ok && tooLarge.message).toContain('ask the user for the number of the article they want');
    expect(!tooLarge.ok && tooLarge.message).toContain('zendesk_get_help_center_articles');
    expect(!tooLarge.ok && tooLarge.message).not.toContain('shorten');
  });

  it('names the article and asks whoever runs the Help Center to shorten it when one article read is over the cap', async () => {
    const [outcome] = await readHelpCenterArticles(TARGET, ['42'], { ...stubDeps(() => jsonResponse(200, { article: zendeskArticle(42, 'x'.repeat(5000)) })).deps, maxResponseBytes: 1000 }) as Array<{ status: string; failure: { error: string; message: string } }>;

    expect(outcome!.status).toBe('error');
    expect(outcome!.failure.error).toBe('help_center_too_large');
    expect(outcome!.failure.message).toContain('Article 42 is too big to read');
    expect(outcome!.failure.message).toContain('ask whoever runs the Help Center to shorten it');
  });

  it('sends a connect-time DNS refusal to the admin as help_center_blocked_host, once, without the resolved private address', async () => {
    const refusal = new PublicFetchError('help.example.com resolves to 10.0.0.5, a private address.', 'blocked');
    const { deps, calls, sleeps } = stubDeps(() => Promise.reject(refusal));
    const result = await listHelpCenterArticles(TARGET, deps);

    expect(!result.ok && result.error).toBe('help_center_blocked_host');
    expect(!result.ok && result.message).toContain('A workspace admin must fix helpCenter.host on the zendesk source.');
    expect(!result.ok && result.message).not.toContain('10.0.0.5');
    expect(!result.ok && result.message).not.toContain('Try again later');
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('tells the model to report the failure and name the locale setting for an admin when the list endpoint answers 404', async () => {
    const result = await listHelpCenterArticles(TARGET, stubDeps(() => jsonResponse(404, {})).deps);

    expect(!result.ok && result.message).toBe('The Help Center has no articles endpoint for locale en-us (404). Tell the user the Help Center could not be read. A workspace admin must fix helpCenter.locale on the zendesk source.');
  });

  it('tells the model where to get an article id when the one it passed is not a number', async () => {
    const [outcome] = await readHelpCenterArticles(TARGET, ['abc'], stubDeps(() => jsonResponse(200, {})).deps) as Array<{ failure: { message: string } }>;

    expect(outcome!.failure.message).toContain('Take the id from zendesk_list_help_center_articles');
  });

  it('tells the model to report the failure and name the host setting for an admin when the host is blocked', async () => {
    const { deps } = stubDeps(() => jsonResponse(200, {}));

    const result = await listHelpCenterArticles(TARGET, { ...deps, checkHost: async () => ({ ok: false, reason: 'help.example.com resolves to 10.0.0.5, a private address.' }) });

    expect(!result.ok && result.message).toBe('The Help Center host is not called: it does not resolve to a public address. Tell the user the Help Center could not be read. A workspace admin must fix helpCenter.host on the zendesk source.');
    expect(!result.ok && result.message).not.toContain('10.0.0.5');
  });

  it('tells the model to report the failure and name the host setting for an admin on an unexpected status', async () => {
    const { deps } = stubDeps(() => jsonResponse(400, {}));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(!result.ok && result.message).toBe('The Help Center answered 400. Tell the user the Help Center could not be read. A workspace admin must fix helpCenter.host on the zendesk source.');
  });

  it('tells the model what to do about JSON that is not an object, a list without articles, and an article without an id', async () => {
    const notObject = await listHelpCenterArticles(TARGET, stubDeps(() => jsonResponse(200, [1, 2])).deps);
    const noList = await listHelpCenterArticles(TARGET, stubDeps(() => jsonResponse(200, { results: [] })).deps);
    const noId = await listHelpCenterArticles(TARGET, stubDeps(() => jsonResponse(200, { articles: [{ title: 'x' }] })).deps);
    const [noArticle] = await readHelpCenterArticles(TARGET, ['5'], stubDeps(() => jsonResponse(200, {})).deps) as Array<{ failure: { message: string } }>;

    for (const failure of [notObject, noList, noId]) {
      expect(!failure.ok && failure.message).toContain('Tell the user the Help Center could not be read. A workspace admin must fix helpCenter.host on the zendesk source.');
    }

    expect(noArticle!.failure.message).toContain('Tell the user the Help Center could not be read. A workspace admin must fix helpCenter.host on the zendesk source.');
  });
});

describe('retries', () => {
  it('retries a 5xx once and returns the second answer', async () => {
    const { deps, calls, sleeps } = stubDeps((_url, callNumber) => callNumber === 1 ? jsonResponse(502, {}) : jsonResponse(200, { articles: [zendeskArticle(9)], next_page: null }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(result).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });

  it('gives a typed error after exactly one retry of a persistent 5xx', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(503, {}));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: false, error: 'help_center_server_error', status: 503 });
  });

  it('retries a timeout once, then reports it as a timeout', async () => {
    const { deps, calls } = stubDeps((url, _callNumber, init) => hangUntilAborted(url, init));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: false, error: 'help_center_timeout' });
  });

  it('recovers when the retry after a timeout answers', async () => {
    const { deps, calls } = stubDeps((url, callNumber, init) => callNumber === 1 ? hangUntilAborted(url, init) : jsonResponse(200, { articles: [zendeskArticle(4)], next_page: null }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: true });
  });

  it('waits out a short Retry-After on a 429 before its one retry', async () => {
    const { deps, sleeps } = stubDeps((_url, callNumber) => callNumber === 1 ? jsonResponse(429, {}, { 'retry-after': '2' }) : jsonResponse(200, { articles: [], next_page: null }));

    await listHelpCenterArticles(TARGET, deps);

    expect(sleeps).toEqual([2000]);
  });

  it('does not retry a 429 whose Retry-After is over 5 seconds, and says how long Zendesk asked to wait', async () => {
    const { deps, calls, sleeps } = stubDeps(() => jsonResponse(429, {}, { 'retry-after': '30' }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(result).toMatchObject({ ok: false, error: 'help_center_rate_limited', status: 429 });
    expect(!result.ok && result.message).toContain('asked to wait 30 seconds');
  });

  it('says "at least" when Retry-After is beyond what the header reader keeps', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(429, {}, { 'retry-after': '3600' }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(1);
    expect(!result.ok && result.message).toContain('at least 60 seconds');
  });

  it('waits out a Retry-After of exactly 5 seconds and retries once', async () => {
    const { deps, calls, sleeps } = stubDeps((_url, callNumber) => callNumber === 1 ? jsonResponse(429, {}, { 'retry-after': '5' }) : jsonResponse(200, { articles: [], next_page: null }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(sleeps).toEqual([5000]);
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a Retry-After one second over the cap', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(429, {}, { 'retry-after': '6' }));

    await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(1);
  });

  it('waits 1 second and retries once when a 429 names no Retry-After', async () => {
    const { deps, calls, sleeps } = stubDeps(() => jsonResponse(429, {}));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(sleeps).toEqual([1000]);
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: false, error: 'help_center_rate_limited' });
  });

  it('does not retry a 403, which retrying cannot fix', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(403, {}));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: false, error: 'help_center_not_public' });
  });
});

describe('the time limit', () => {
  it('is 10 seconds per request: still open at 9,999 ms, aborted at 10,000 ms', async () => {
    vi.useFakeTimers();
    const { deps, calls } = stubDeps((url, _callNumber, init) => hangUntilAborted(url, init));
    const { timeoutMs: _injected, ...withoutTimeout } = deps;

    const pending = listHelpCenterArticles(TARGET, withoutTimeout);
    await vi.advanceTimersByTimeAsync(9999);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.signal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(calls[0]!.init.signal!.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(await pending).toMatchObject({ ok: false, error: 'help_center_timeout' });
  });
});

describe('the default transport', () => {
  it('refuses a name that resolves to a private address at connect time, even when the up-front check passed', async () => {
    connectionCounter.count = 0;
    const server = createServer();
    server.on('connection', socket => countAndDestroy(socket));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `https://localhost:${(server.address() as AddressInfo).port}`;

    const { deps } = stubDeps(() => jsonResponse(200, {}));
    const { fetch: _stubbedFetch, ...withDefaultTransport } = deps;
    const result = await listHelpCenterArticles({ origin, locale: 'en-us' }, withDefaultTransport);

    await new Promise<void>(resolve => server.close(() => resolve()));

    expect(connectionCounter.count).toBe(0);
    expect(result).toMatchObject({ ok: false, error: 'help_center_blocked_host' });
    expect(!result.ok && result.message).toContain('does not resolve to a public address');
    expect(!result.ok && result.message).not.toContain('127.0.0.1');
  });
});

describe('answer size', () => {
  it('abandons an answer over the byte cap with a typed error, and does not retry it', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(200, { articles: [zendeskArticle(1, 'x'.repeat(5000))], next_page: null }));

    const result = await listHelpCenterArticles(TARGET, { ...deps, maxResponseBytes: 1000 });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: false, error: 'help_center_too_large' });
  });

  it('refuses an answer whose declared length is over the cap', async () => {
    const { deps } = stubDeps(() => jsonResponse(200, { articles: [], next_page: null }, { 'content-length': String(MAX_RESPONSE_BYTES + 1) }));

    const result = await listHelpCenterArticles(TARGET, deps);

    expect(result).toMatchObject({ ok: false, error: 'help_center_too_large' });
  });

  it('closes the connection after refusing an answer whose declared length is over the cap, instead of leaving the server streaming', async () => {
    const origin = await serveLocally(dripHugeBody);
    const deps: HelpCenterDeps = { fetch: fetchOverLocalHttp, checkHost: async () => ({ ok: true }), timeoutMs: 5000 };
    const refusedAt = Date.now();

    const result = await listHelpCenterArticles({ origin, locale: 'en-us' }, deps);

    expect(result).toMatchObject({ ok: false, error: 'help_center_too_large' });

    await vi.waitFor(() => expect(slowServer.closedAt).toBeGreaterThan(0), { timeout: 2000 });

    expect(slowServer.closedAt - refusedAt).toBeLessThan(2000);
  });

  it('reads an answer exactly at the cap', async () => {
    const text = JSON.stringify({ articles: [zendeskArticle(1)], next_page: null });
    const { deps } = stubDeps(() => new Response(text, { status: 200 }));

    const result = await listHelpCenterArticles(TARGET, { ...deps, maxResponseBytes: new TextEncoder().encode(text).byteLength });

    expect(result).toMatchObject({ ok: true, articles: [{ id: 1 }] });
  });

  it('treats a 404 with no body as not_found, not as a failed read', async () => {
    const { deps } = stubDeps(() => new Response(null, { status: 404 }));

    const results = await readHelpCenterArticles(TARGET, ['11'], deps);

    expect(results).toMatchObject([{ id: '11', status: 'not_found' }]);
  });
});

describe('readHelpCenterArticles', () => {
  it('fetches all the ids at once, not one after another', async () => {
    readConcurrency.inFlight = 0;
    readConcurrency.mostInFlight = 0;
    const { deps } = stubDeps(answerSlowly);

    const results = await readHelpCenterArticles(TARGET, ['11', '22', '33'], deps);

    expect(readConcurrency.mostInFlight).toBe(3);
    expect(results).toMatchObject([{ id: '11', status: 'found' }, { id: '22', status: 'found' }, { id: '33', status: 'found' }]);
  });

  it('returns a missing article as not_found while the others still come back', async () => {
    const { deps } = stubDeps(url => url.endsWith('/22') ? jsonResponse(404, { error: 'RecordNotFound' }) : jsonResponse(200, { article: zendeskArticle(Number(url.split('/').pop())) }));

    const results = await readHelpCenterArticles(TARGET, ['11', '22', '33'], deps);

    expect(results).toMatchObject([{ id: '11', status: 'found' }, { id: '22', status: 'not_found' }, { id: '33', status: 'found' }]);
  });

  it('keeps one article\'s failure from hiding the others', async () => {
    const { deps } = stubDeps(url => url.endsWith('/22') ? jsonResponse(500, {}) : jsonResponse(200, { article: zendeskArticle(Number(url.split('/').pop())) }));

    const results = await readHelpCenterArticles(TARGET, ['11', '22'], deps);

    expect(results).toMatchObject([{ id: '11', status: 'found' }, { id: '22', status: 'error', failure: { error: 'help_center_server_error' } }]);
  });

  it('refuses an id of 16 digits, which a JavaScript number may not hold exactly, and takes one of 15', async () => {
    const { deps, calls } = stubDeps(url => jsonResponse(200, { article: zendeskArticle(Number(url.split('/').pop())) }));

    const results = await readHelpCenterArticles(TARGET, ['1234567890123456', '123456789012345'], deps);

    expect(calls).toHaveLength(1);
    expect(results).toMatchObject([{ status: 'error', failure: { error: 'help_center_bad_article_id' } }, { id: '123456789012345', status: 'found' }]);
  });

  it('refuses an id that is not a number, without a request', async () => {
    const { deps, calls } = stubDeps(() => jsonResponse(200, {}));

    const results = await readHelpCenterArticles(TARGET, ['1/../../users'], deps);

    expect(calls).toHaveLength(0);
    expect(results).toMatchObject([{ status: 'error', failure: { error: 'help_center_bad_article_id' } }]);
  });
});
