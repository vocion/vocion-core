/**
 * A GET that can only ever connect to a public address, closing the gap
 * between "we checked the host" and "we connected to it".
 *
 * `resolvesPublicly` (`./publicUrl.ts`) resolves a name and checks every
 * address, but a plain `fetch` afterwards resolves the name again, and a
 * hostile DNS server can answer a public address the first time and a private
 * one the second (DNS rebinding). Here the check and the connection share one
 * lookup: Node's `https.request` takes a `lookup` function, and ours resolves
 * every address, refuses the whole name if any of them is private, and hands
 * back only vetted addresses. The address dialed is the address checked,
 * while the TLS SNI and the Host header stay the hostname.
 *
 * Address literals never reach a lookup (Node connects to them directly), so
 * they are checked before the request is built.
 *
 * It follows no redirects: a 3xx comes back as a response for the caller to
 * judge, because the next hop would need the same vetting.
 */

import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { once } from 'node:events';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { PublicFetchError } from './publicFetch';
import { isPrivateAddress } from './publicUrl';

/** Statuses whose responses carry no body, so a `Response` must be built with a null one. */
const STATUSES_WITHOUT_BODY = new Set([204, 205, 304]);

export type VettedAddresses
  = | { ok: true; addresses: LookupAddress[] }
    | { ok: false; reason: string };

/** What `sendGet` needs from the outside, so a test can point it at a local server. */
export type SendGetDeps = {
  /** Defaults to `https.request`. */
  requestFn?: typeof httpsRequest;
  /** Defaults to `vettedLookup`. */
  lookup?: LookupFunction;
};

/**
 * Decide which of a name's resolved addresses may be dialed: none if any one
 * of them is private (a mixed answer is a rebinding tactic, not a mistake to
 * route around), otherwise those of the requested family.
 * @param hostname - The name that was resolved, for the message.
 * @param resolved - Every address DNS returned.
 * @param family - What the socket asked for: 4, 6, 'IPv4', 'IPv6', or 0 / undefined for either.
 */
export function vetResolvedAddresses(hostname: string, resolved: LookupAddress[], family?: number | string): VettedAddresses {
  if (resolved.length === 0) {
    return { ok: false, reason: `${hostname} does not resolve.` };
  }
  const privateOne = resolved.find(entry => isPrivateAddress(entry.address));
  if (privateOne) {
    return { ok: false, reason: `${hostname} resolves to ${privateOne.address}, a private address.` };
  }
  const wanted = family === 'IPv4' ? 4 : family === 'IPv6' ? 6 : Number(family ?? 0);
  const addresses = wanted === 4 || wanted === 6 ? resolved.filter(entry => entry.family === wanted) : resolved;
  if (addresses.length === 0) {
    return { ok: false, reason: `${hostname} has no IPv${wanted} address.` };
  }
  return { ok: true, addresses };
}

/**
 * Resolve a name and return only addresses that passed `vetResolvedAddresses`.
 * @param hostname - The name to resolve.
 * @param family - The family the socket asked for.
 * @throws {PublicFetchError} With code `blocked` when any address is private.
 */
async function resolveVetted(hostname: string, family?: number | string): Promise<LookupAddress[]> {
  const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
  const verdict = vetResolvedAddresses(hostname, resolved, family);
  if (!verdict.ok) {
    throw new PublicFetchError(verdict.reason, 'blocked');
  }
  return verdict.addresses;
}

/**
 * Hand a lookup's answer to the socket in the shape it asked for: the whole
 * list when `options.all` is set (Node's happy-eyeballs asks for that),
 * otherwise the first address and its family.
 * @param options - The lookup options the socket passed.
 * @param options.all - Whether to answer with the whole list.
 * @param addresses - Vetted addresses, at least one.
 * @param callback - The socket's callback.
 */
function answerLookup(options: { all?: boolean }, addresses: LookupAddress[], callback: (...args: unknown[]) => void): void {
  if (options.all) {
    callback(null, addresses);
    return;
  }
  callback(null, addresses[0]!.address, addresses[0]!.family);
}

/**
 * The `lookup` option for `https.request`: resolves every address, refuses
 * the name if any is private, and answers with vetted addresses only.
 * @param hostname - The name the socket is about to dial.
 * @param options - Lookup options: `all` (answer with a list) and `family`.
 * @param callback - The socket's callback.
 */
export const vettedLookup: LookupFunction = (hostname, options, callback) => {
  const answer = callback as unknown as (...args: unknown[]) => void;
  resolveVetted(hostname, options.family).then(addresses => answerLookup(options, addresses, answer), error => answer(error));
};

/**
 * Copy Node's response headers into a WHATWG `Headers`, keeping repeated ones
 * (`set-cookie`) as separate entries.
 * @param raw - The incoming message's headers.
 */
function headersFrom(raw: IncomingMessage['headers']): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    for (const piece of Array.isArray(value) ? value : [value]) {
      if (piece !== undefined) {
        headers.append(name, piece);
      }
    }
  }
  return headers;
}

/**
 * A WHATWG `Response` over a Node response: status, headers, and the body
 * streamed (null for 204, 205 and 304, which have none).
 * @param incoming - The Node response.
 */
export function responseFromIncoming(incoming: IncomingMessage): Response {
  const status = incoming.statusCode ?? 502;
  const init = { status, statusText: incoming.statusMessage ?? '', headers: headersFrom(incoming.headers) };
  if (STATUSES_WITHOUT_BODY.has(status)) {
    incoming.resume();
    return new Response(null, init);
  }
  return new Response(Readable.toWeb(incoming) as unknown as ReadableStream, init);
}

/**
 * One GET with an injectable request function and lookup. Aborting the signal
 * destroys the request, and with it the body stream.
 * @param url - The URL to fetch.
 * @param init - Headers and an abort signal; the rest of `RequestInit` is ignored.
 * @param deps - Request function and lookup, defaulted for production.
 */
export async function sendGet(url: URL, init: RequestInit, deps: SendGetDeps = {}): Promise<Response> {
  const send = deps.requestFn ?? httpsRequest;
  const request = send({
    method: 'GET',
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port === '' ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    lookup: deps.lookup ?? vettedLookup,
    signal: init.signal ?? undefined,
  });
  request.end();
  const [incoming] = await once(request, 'response') as [IncomingMessage];
  // A request error after the headers arrived (an abort, a reset) must end the body stream, not crash the process.
  request.once('error', error => incoming.destroy(error));
  return responseFromIncoming(incoming);
}

/**
 * GET a public https URL without ever dialing a private address, however DNS
 * answers.
 * @param rawUrl - An https URL.
 * @param init - Headers and an abort signal.
 * @throws {PublicFetchError} With code `blocked` for a non-https URL, a private address literal, or a name with any private address.
 */
export async function publicOnlyFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') {
    throw new PublicFetchError(`${url.protocol}// is not fetched here, only https.`, 'blocked');
  }
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) !== 0 && isPrivateAddress(literal)) {
    throw new PublicFetchError(`${literal} is a private or loopback address, not the public internet.`, 'blocked');
  }
  return sendGet(url, init);
}
