/**
 * The rebinding guard, tested with no outside network: the vetting decision is
 * pure, and the request path runs against sockets on localhost. The rule under
 * test: the address that gets dialed is one that was checked, so a private
 * address is refused before any connection is made.
 */
import type { LookupAddress } from 'node:dns';
import type { IncomingMessage, RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicFetchError } from './publicFetch';
import { publicOnlyFetch, responseFromIncoming, sendGet, vetResolvedAddresses, vettedLookup } from './publicOnlyFetch';

const V4_PUBLIC: LookupAddress = { address: '93.184.216.34', family: 4 };
const V6_PUBLIC: LookupAddress = { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 };

type LookupAnswer = { error: Error | null; address: unknown; family: unknown };

/** Every server a test opened, closed after each test. */
const openServers: Array<{ close: () => void; closeAllConnections?: () => void }> = [];
/** What the local servers saw, newest last. */
const seenRequests: Array<{ accept: string; url: string }> = [];
/** Connections the counting TCP server accepted. */
const connectionCounter = { count: 0 };

/**
 * Run `vettedLookup` the way a socket does and return what it called back with.
 * @param hostname - The name to look up.
 * @param options - Lookup options.
 * @param options.all - Whether to ask for the whole list.
 * @param options.family - The family to ask for.
 */
function runLookup(hostname: string, options: { all?: boolean; family?: number }): Promise<LookupAnswer> {
  return new Promise<LookupAnswer>(resolve => vettedLookup(hostname, options, (error, address, family) => resolve({ error, address, family })));
}

/**
 * Count a connection and drop it.
 * @param socket - The accepted socket.
 * @param socket.destroy - Closes it.
 */
function countAndDestroy(socket: { destroy: () => void }): void {
  connectionCounter.count += 1;
  socket.destroy();
}

/**
 * A TCP server that counts connections, for proving none was made.
 */
async function listenCountingConnections(): Promise<number> {
  connectionCounter.count = 0;
  const server = createTcpServer();
  server.on('connection', socket => countAndDestroy(socket));
  openServers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/**
 * A local HTTP server running `handler`, and the URL of it.
 * @param handler - The request listener.
 */
async function serve(handler: RequestListener): Promise<URL> {
  const server = createHttpServer(handler);
  openServers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/path?x=1`);
}

/**
 * `sendGet` over plain http to a local server (production uses https and the vetted lookup).
 * @param url - The server's URL.
 * @param init - Request init.
 */
function get(url: URL, init: RequestInit = {}): Promise<Response> {
  return sendGet(url, init, { requestFn: httpRequest as never, lookup: undefined as never });
}

/**
 * Answer 200 JSON with a repeated header, recording what was asked.
 * @param request - The request.
 * @param response - The response.
 */
function answerJson(request: IncomingMessage, response: import('node:http').ServerResponse): void {
  seenRequests.push({ accept: String(request.headers.accept), url: request.url ?? '' });
  response.writeHead(200, { 'content-type': 'application/json', 'x-twice': ['a', 'b'] });
  response.end('{"ok":true}');
}

/**
 * Count the hit and answer a redirect.
 * @param request - The request.
 * @param response - The response.
 */
function answerRedirect(request: IncomingMessage, response: import('node:http').ServerResponse): void {
  seenRequests.push({ accept: '', url: request.url ?? '' });
  response.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
  response.end();
}

/**
 * Answer 204 with no body.
 * @param _request - Unused.
 * @param response - The response.
 */
function answerNoContent(_request: IncomingMessage, response: import('node:http').ServerResponse): void {
  response.writeHead(204);
  response.end();
}

/**
 * Answer 304 with no body.
 * @param _request - Unused.
 * @param response - The response.
 */
function answerNotModified(_request: IncomingMessage, response: import('node:http').ServerResponse): void {
  response.writeHead(304);
  response.end();
}

/**
 * Answer 205 with no body.
 * @param _request - Unused.
 * @param response - The response.
 */
function answerResetContent(_request: IncomingMessage, response: import('node:http').ServerResponse): void {
  response.writeHead(205);
  response.end();
}

/**
 * Never answer, like a hung server.
 */
function answerNever(): void {}

/**
 * Send headers and part of a body, then stall.
 * @param _request - Unused.
 * @param response - The response.
 */
function answerPartialBody(_request: IncomingMessage, response: import('node:http').ServerResponse): void {
  response.writeHead(200);
  response.write('partial');
}

/**
 * Answer 404 with a short body.
 * @param _request - Unused.
 * @param response - The response.
 */
function answerNotFound(_request: IncomingMessage, response: import('node:http').ServerResponse): void {
  response.writeHead(404);
  response.end('nope');
}

/**
 * Open a request and return the raw Node response.
 * @param url - The server's URL.
 */
function rawGet(url: URL): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>(resolve => httpRequest(url, resolve).end());
}

afterEach(() => {
  for (const server of openServers.splice(0)) {
    server.closeAllConnections?.();
    server.close();
  }
  seenRequests.length = 0;
});

describe('vetResolvedAddresses', () => {
  it('refuses the whole name when any one address is private, even beside a public one', () => {
    const verdict = vetResolvedAddresses('rebind.example', [V4_PUBLIC, { address: '169.254.169.254', family: 4 }]);

    expect(verdict).toEqual({ ok: false, reason: 'rebind.example resolves to 169.254.169.254, a private address.' });
  });

  it('refuses a private IPv6 address written in the hex-mapped form', () => {
    const verdict = vetResolvedAddresses('rebind.example', [{ address: '::ffff:7f00:1', family: 6 }]);

    expect(verdict.ok).toBe(false);
  });

  it('refuses a name with no addresses', () => {
    expect(vetResolvedAddresses('empty.example', []).ok).toBe(false);
  });

  it('hands back every vetted address when the socket wants either family', () => {
    expect(vetResolvedAddresses('ok.example', [V4_PUBLIC, V6_PUBLIC])).toEqual({ ok: true, addresses: [V4_PUBLIC, V6_PUBLIC] });
    expect(vetResolvedAddresses('ok.example', [V4_PUBLIC, V6_PUBLIC], 0)).toEqual({ ok: true, addresses: [V4_PUBLIC, V6_PUBLIC] });
  });

  it('honors the family the socket asked for, by number or by name', () => {
    expect(vetResolvedAddresses('ok.example', [V4_PUBLIC, V6_PUBLIC], 4)).toEqual({ ok: true, addresses: [V4_PUBLIC] });
    expect(vetResolvedAddresses('ok.example', [V4_PUBLIC, V6_PUBLIC], 'IPv6')).toEqual({ ok: true, addresses: [V6_PUBLIC] });
  });

  it('refuses rather than falling back to the other family', () => {
    expect(vetResolvedAddresses('v4only.example', [V4_PUBLIC], 6).ok).toBe(false);
  });
});

describe('vettedLookup', () => {
  it('refuses localhost, with the "all" form Node\'s happy-eyeballs uses', async () => {
    const answer = await runLookup('localhost', { all: true });

    expect(answer.error).toBeInstanceOf(PublicFetchError);
    expect((answer.error as PublicFetchError).code).toBe('blocked');
    expect(answer.error?.message).toMatch(/localhost resolves to .*private/);
  });

  it('refuses localhost in the single-address form too', async () => {
    const answer = await runLookup('localhost', { all: false, family: 4 });

    expect((answer.error as PublicFetchError).code).toBe('blocked');
  });
});

describe('publicOnlyFetch', () => {
  it('refuses https://localhost:<port>/ before any connection is made', async () => {
    const port = await listenCountingConnections();

    await expect(publicOnlyFetch(`https://localhost:${port}/`)).rejects.toMatchObject({ code: 'blocked' });
    expect(connectionCounter.count).toBe(0);
  });

  it('refuses a private address literal, which Node would dial without any lookup', async () => {
    const port = await listenCountingConnections();

    await expect(publicOnlyFetch(`https://127.0.0.1:${port}/`)).rejects.toMatchObject({ code: 'blocked' });
    await expect(publicOnlyFetch(`https://[::ffff:7f00:1]:${port}/`)).rejects.toMatchObject({ code: 'blocked' });
    expect(connectionCounter.count).toBe(0);
  });

  it('refuses a URL that is not https', async () => {
    await expect(publicOnlyFetch('http://example.com/')).rejects.toMatchObject({ code: 'blocked' });
  });
});

describe('sendGet and responseFromIncoming, against a local server', () => {
  it('returns status, headers and body as a WHATWG Response, and sends the headers it was given', async () => {
    const url = await serve(answerJson);

    const response = await get(url, { headers: { Accept: 'application/json' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-twice')).toBe('a, b');
    expect(await response.json()).toEqual({ ok: true });
    expect(seenRequests).toEqual([{ accept: 'application/json', url: '/path?x=1' }]);
  });

  it('does not follow a redirect: it returns the 3xx and its location', async () => {
    const url = await serve(answerRedirect);

    const response = await get(url);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:1/elsewhere');
    expect(seenRequests).toHaveLength(1);
  });

  it('gives a null body for 204, 205 and 304, which a Response with a body would reject', async () => {
    for (const handler of [answerNoContent, answerResetContent, answerNotModified]) {
      const response = await get(await serve(handler));

      expect(response.body, String(response.status)).toBeNull();
    }
  });

  it('rejects before the headers arrive when the signal aborts', async () => {
    const url = await serve(answerNever);
    const controller = new AbortController();

    const pending = get(url, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('errors the body stream when the signal aborts mid-body, instead of hanging', async () => {
    const url = await serve(answerPartialBody);
    const controller = new AbortController();

    const response = await get(url, { signal: controller.signal });
    controller.abort();

    await expect(response.text()).rejects.toBeDefined();
  });

  it('builds a Response from a Node response directly', async () => {
    const response = responseFromIncoming(await rawGet(await serve(answerNotFound)));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('nope');
  });
});
