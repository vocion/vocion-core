/**
 * Zendesk API client — the one place that knows how to get an OAuth token for
 * a Zendesk account and call its API with it.
 *
 * Auth is an OAuth client the account's admin makes in Admin Center (Apps and
 * integrations → APIs → OAuth clients, kind Confidential), used with the
 * client credentials grant. API tokens are not offered: Zendesk stopped
 * existing accounts making new ones on October 27, 2026 and deactivates the
 * rest on April 30, 2027
 * (developer.zendesk.com/documentation/authentication/oauth-migration/).
 *
 * Facts this file depends on
 * (developer.zendesk.com/api-reference/ticketing/oauth/grant_type_tokens/):
 *   POST https://{subdomain}.zendesk.com/oauth/tokens, JSON body
 *     { grant_type: 'client_credentials', client_id, client_secret, scope, expires_in }
 *   `scope` is space-separated `resource:action` values. One the client is not
 *     allowed answers 400 `invalid_scope` and no token is made; one Zendesk does
 *     not recognise still makes a token whose API calls answer 403.
 *   `expires_in` must be 300 to 172,800 seconds. Clients made on or after
 *     April 30, 2026 default to 1,800 when none is asked for.
 *   The grant returns no refresh token, so an expired token is replaced by
 *     minting a new one.
 *   The token acts as the admin who made the OAuth client, and its calls fail
 *     once that admin loses access (support.zendesk.com/hc/en-us/articles/4408845965210).
 * The error body for a refused client id or secret is not documented, so
 * Zendesk's words are read from whichever of `error_description`, `error`,
 * `description` or `message` it sends.
 *
 * Every call goes to `https://{subdomain}.zendesk.com` and nowhere else: the
 * subdomain is parsed down to one DNS label, and redirects are refused, so a
 * pasted value or a 3xx can never send the client secret to another host.
 * No message this file builds contains the client secret or a token.
 */

import { createHash } from 'node:crypto';
import { retryAfterMs } from '@/libs/http/retryAfter';

export type ZendeskCredentials = {
  /** The account's subdomain, already normalized to one label (`acme`). */
  subdomain: string;
  clientId: string;
  clientSecret: string;
};

/**
 * A Zendesk OAuth scope, `resource:action`. Each caller asks only for what it
 * uses, because a client its admin limited to some scopes refuses a token for
 * any other.
 */
export type ZendeskScope = `${string}:${'read' | 'write'}`;

export type ZendeskFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The network, the clock and the wait, injected in tests. */
export type ZendeskDeps = {
  fetch?: ZendeskFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** One API call. The body is a string so a retry after a 401 can send it again. */
export type ZendeskRequest = {
  /** Path under the account, starting `/api/v2/`. */
  path: string;
  scopes: readonly ZendeskScope[];
  method?: 'GET' | 'POST' | 'PUT';
  body?: string;
  /**
   * Sent as `Idempotency-Key`. Zendesk keeps a key for two hours and answers a
   * repeat with the first response; the same key with a different body is
   * refused with a 400 (developer.zendesk.com/api-reference/ticketing/introduction/#idempotency).
   */
  idempotencyKey?: string;
};

type CachedToken = {
  accessToken: string;
  /** When to stop handing this token out and mint a new one, epoch ms. */
  refreshAt: number;
  /** The scopes Zendesk says it granted, or null when it did not say. */
  grantedScopes: string[] | null;
};

/** One call's limit, per attempt, so a wait for a 429 never eats it. */
const REQUEST_TIMEOUT_MS = 15_000;
/** The lifetime asked for. One hour keeps mints rare without holding a token for days. */
const REQUESTED_LIFETIME_SECONDS = 3600;
/** The lifetime assumed when Zendesk's answer leaves `expires_in` out: its documented default. */
const ASSUMED_LIFETIME_SECONDS = 1800;
/** Stop using a token this long before it expires, as Zoom's client does. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** The longest Retry-After waited out inside one call; anything longer is reported. */
const MAX_RATE_LIMIT_WAIT_MS = 10_000;
/** How much of Zendesk's own error text a message quotes. */
const VENDOR_MESSAGE_CHARS = 300;

/**
 * Tokens in hand, per account, client, secret and scope set. Per server
 * process: a second process mints its own, which Zendesk allows.
 */
const tokenCache = new Map<string, CachedToken>();
/** Mints in flight, so callers that miss the cache together share one. */
const tokenMints = new Map<string, Promise<CachedToken>>();

/** A Zendesk call that failed, with the sentence to show. */
export class ZendeskError extends Error {
  /** Zendesk's HTTP status, or null when Zendesk was never reached. */
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ZendeskError';
    this.status = status;
  }
}

/**
 * The account's subdomain from whatever was pasted, or null if it names
 * anything other than one `*.zendesk.com` account.
 *
 * Accepts `acme`, `acme.zendesk.com` and `https://acme.zendesk.com/`. Refuses
 * other hosts, ports, paths, credentials in the URL and host-mapped custom
 * domains (`support.acme.com`): the server calls whatever this returns, so
 * anything it cannot prove is a Zendesk account is refused, not guessed at.
 * @param raw - The value as typed.
 */
export function normalizeZendeskSubdomain(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  // Only letters, digits, dots and hyphens between an optional scheme and an
  // optional trailing slash: a port, path, query, `user@` or backslash fails
  // here before anything is read as a host.
  const host = /^(?:https?:\/\/)?([a-z0-9.-]+)\/?$/.exec(raw.trim().toLowerCase())?.[1];
  if (!host) {
    return null;
  }
  const label = host.endsWith('.zendesk.com') ? host.slice(0, -'.zendesk.com'.length) : host;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? label : null;
}

/**
 * The origin every call for this account goes to.
 * @param subdomain - A normalized subdomain.
 */
export function zendeskOrigin(subdomain: string): string {
  return `https://${subdomain}.zendesk.com`;
}

/**
 * The vaulted credential, or why it cannot be used. The field names are the
 * storage contract with the `zendesk` platform descriptor.
 * @param values - The decrypted credential bag, or values as typed.
 */
export function zendeskCredentialsFrom(values?: Record<string, unknown> | null): { ok: true; credentials: ZendeskCredentials } | { ok: false; message: string } {
  const rawSubdomain = typeof values?.subdomain === 'string' ? values.subdomain.trim() : '';
  const clientId = typeof values?.clientId === 'string' ? values.clientId.trim() : '';
  const clientSecret = typeof values?.clientSecret === 'string' ? values.clientSecret.trim() : '';
  const missing = [
    rawSubdomain ? null : 'subdomain',
    clientId ? null : 'client ID',
    clientSecret ? null : 'client secret',
  ].filter(name => name !== null);
  if (missing.length > 0) {
    return { ok: false, message: `The Zendesk credential needs the account's ${missing.join(', ')}.` };
  }
  const subdomain = normalizeZendeskSubdomain(rawSubdomain);
  if (!subdomain) {
    return { ok: false, message: 'The Zendesk subdomain is the part of your Zendesk address before .zendesk.com, like acme or acme.zendesk.com. Custom domains are not supported.' };
  }
  return { ok: true, credentials: { subdomain, clientId, clientSecret } };
}

/**
 * The cache key for one account, client, secret and scope set. The secret
 * enters as a fingerprint, so saving a regenerated secret mints a new token
 * instead of reusing one the old secret got.
 * @param credentials - The client.
 * @param scopes - The scopes asked for.
 */
function tokenKey(credentials: ZendeskCredentials, scopes: readonly ZendeskScope[]): string {
  const secretFingerprint = createHash('sha256').update(credentials.clientSecret).digest('hex').slice(0, 16);
  return [credentials.subdomain, credentials.clientId, secretFingerprint, [...scopes].sort().join(' ')].join('\n');
}

/**
 * A token for these scopes: the cached one while it has more than the margin
 * left, else a new one. Callers that miss together share one mint.
 * @param credentials - The client.
 * @param scopes - The scopes the caller's calls need.
 * @param deps - Injected for tests.
 * @param options - `fresh` skips the cache, for Test connection, which must
 *   prove the client works now rather than when the cached token was minted.
 * @param options.fresh - Whether to skip a cached token.
 */
export async function getZendeskToken(
  credentials: ZendeskCredentials,
  scopes: readonly ZendeskScope[],
  deps: ZendeskDeps = {},
  options: { fresh?: boolean } = {},
): Promise<CachedToken> {
  if (scopes.length === 0) {
    // Zendesk needs a scope, and its refusal of an empty one would read as a
    // bad client ID or secret, so say what is actually wrong before asking.
    throw new ZendeskError('A Zendesk token needs at least one OAuth scope, and none was asked for.', null);
  }
  const key = tokenKey(credentials, scopes);
  const now = (deps.now ?? Date.now)();
  const cached = tokenCache.get(key);
  if (cached && !options.fresh && now < cached.refreshAt) {
    return cached;
  }
  const inFlight = tokenMints.get(key);
  if (inFlight) {
    return inFlight;
  }
  const mint = mintAndCache(key, credentials, scopes, deps).finally(() => tokenMints.delete(key));
  tokenMints.set(key, mint);
  return mint;
}

/**
 * Mint a token and keep it, dropping any entry already past its refresh time
 * so a rotated secret does not leave a dead token in memory for good.
 * @param key - The cache key.
 * @param credentials - The client.
 * @param scopes - The scopes to ask for.
 * @param deps - Injected for tests.
 */
async function mintAndCache(key: string, credentials: ZendeskCredentials, scopes: readonly ZendeskScope[], deps: ZendeskDeps): Promise<CachedToken> {
  const token = await mintZendeskToken(credentials, scopes, deps);
  const now = (deps.now ?? Date.now)();
  for (const [otherKey, other] of tokenCache) {
    if (other.refreshAt <= now) {
      tokenCache.delete(otherKey);
    }
  }
  tokenCache.set(key, token);
  return token;
}

/**
 * Forget a token Zendesk refused, but only if it is still the cached one: a
 * concurrent caller may already have replaced it, and dropping that newer
 * token would cost another mint for nothing.
 * @param key - The cache key.
 * @param refusedToken - The access token Zendesk answered 401 to.
 */
function dropRefusedToken(key: string, refusedToken: string): void {
  if (tokenCache.get(key)?.accessToken === refusedToken) {
    tokenCache.delete(key);
  }
}

/**
 * POST the client credentials grant and read the token out of the answer.
 * @param credentials - The client.
 * @param scopes - The scopes to ask for.
 * @param deps - Injected for tests.
 */
async function mintZendeskToken(credentials: ZendeskCredentials, scopes: readonly ZendeskScope[], deps: ZendeskDeps): Promise<CachedToken> {
  const origin = zendeskOrigin(credentials.subdomain);
  const scope = scopes.join(' ');
  const response = await sendToZendesk(`${origin}/oauth/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope,
      expires_in: REQUESTED_LIFETIME_SECONDS,
    }),
  }, credentials, deps);
  const text = await readText(response) ?? '';
  const body = parseJson(text);
  if (!response.ok) {
    const vendor = vendorMessage(body, text, [credentials.clientSecret], 'token');
    throw new ZendeskError(mintFailureMessage(response.status, body, vendor, credentials.subdomain, scope), response.status);
  }
  const accessToken = typeof body?.access_token === 'string' ? body.access_token : '';
  if (!accessToken) {
    throw new ZendeskError(`Zendesk answered ${origin}/oauth/tokens with no access token.`, response.status);
  }
  const lifetimeSeconds = typeof body?.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : ASSUMED_LIFETIME_SECONDS;
  const lifetimeMs = lifetimeSeconds * 1000;
  // A 300-second token would be "expiring" from the moment it arrived under a
  // flat five-minute margin, so a short token keeps the last tenth instead.
  // "Short" means under 50 minutes: exactly where a tenth of the token's life
  // drops below five minutes, so the margin shrinks smoothly with the token
  // rather than jumping at an arbitrary cut-off. A one-hour token (what this
  // client asks for) keeps the full five minutes; the assumed 30-minute
  // token keeps its last three.
  const marginMs = Math.min(REFRESH_MARGIN_MS, lifetimeMs / 10);
  const grantedScopes = typeof body?.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : null;
  return { accessToken, refreshAt: (deps.now ?? Date.now)() + lifetimeMs - marginMs, grantedScopes };
}

/**
 * The sentence for a token request Zendesk refused.
 * @param status - Zendesk's HTTP status.
 * @param body - The parsed answer, if it was JSON.
 * @param vendor - Zendesk's own words, redacted, or null.
 * @param subdomain - The account.
 * @param scope - The scopes asked for.
 */
function mintFailureMessage(status: number, body: Record<string, unknown> | null, vendor: string | null, subdomain: string, scope: string): string {
  const said = vendor ? `: ${vendor}` : '';
  // Admin Center path and "Leave this field empty to allow all scopes":
  // https://support.zendesk.com/hc/en-us/articles/4408845965210 (Registering your application with Zendesk).
  if (body?.error === 'invalid_scope') {
    return `Zendesk would not grant the scopes this needs (${scope})${said}. Add them to the OAuth client's Scopes in Admin Center (Apps and integrations → APIs → OAuth clients), or leave Scopes empty to allow all.`;
  }
  if (status === 400 || status === 401 || status === 403) {
    return `Zendesk refused the OAuth client for ${subdomain}.zendesk.com${said}. Check the client ID and secret, and that the client's kind is Confidential.`;
  }
  if (status === 429) {
    return 'Zendesk\'s rate limit for this account is spent. Try again in a minute.';
  }
  return `Zendesk answered HTTP ${status} when asked for a token${said}.`;
}

/**
 * Call the Zendesk API as the OAuth client and return the parsed JSON object.
 * A success with an empty body (a 204, or a write Zendesk confirms with no
 * body) comes back as an empty object, because the call worked. A success
 * whose body is something other than a JSON object (an HTML page from
 * something in the way) or could not be read to the end is reported, never
 * handed back as an empty answer the caller could mistake for data.
 *
 * A 401 means the token was refused before any work was done, so it is safe to
 * mint one fresh token and send the same request once more, writes included.
 * Nothing else is retried here except a short 429: a timeout or a 5xx on a
 * write may already have done the work, and only the caller knows whether
 * sending it again could do it twice.
 * @param credentials - The client.
 * @param request - The call.
 * @param deps - Injected for tests.
 */
export async function zendeskRequest(credentials: ZendeskCredentials, request: ZendeskRequest, deps: ZendeskDeps = {}): Promise<Record<string, unknown>> {
  const url = zendeskApiUrl(credentials.subdomain, request.path);
  const key = tokenKey(credentials, request.scopes);
  let token = await getZendeskToken(credentials, request.scopes, deps);
  let response = await sendWithToken(url, request, token.accessToken, credentials, deps);
  if (response.status === 401) {
    await discardBody(response);
    dropRefusedToken(key, token.accessToken);
    token = await getZendeskToken(credentials, request.scopes, deps);
    response = await sendWithToken(url, request, token.accessToken, credentials, deps);
  }
  const text = await readText(response);
  const body = parseJson(text ?? '');
  if (!response.ok) {
    const vendor = vendorMessage(body, text ?? '', [credentials.clientSecret, token.accessToken], 'api');
    throw new ZendeskError(apiFailureMessage(response.status, vendor, request), response.status);
  }
  const call = `${request.method ?? 'GET'} ${request.path}`;
  if (text === null) {
    throw new ZendeskError(`Zendesk answered ${call} with HTTP ${response.status}, but the body could not be read to the end.`, response.status);
  }
  if (text === '') {
    return {};
  }
  if (body === null) {
    throw new ZendeskError(`Zendesk answered ${call} with HTTP ${response.status} but no JSON object, so there was nothing to read.`, response.status);
  }
  return body;
}

/**
 * The full URL for an API path, checked AFTER the URL is resolved: the
 * resolver turns `..` and `%2e%2e` into steps up, so a path that starts with
 * /api/v2/ as typed could still leave it, bearer token and all.
 * @param subdomain - The account.
 * @param path - The API path, like `/api/v2/users/me.json`.
 */
function zendeskApiUrl(subdomain: string, path: string): string {
  const origin = zendeskOrigin(subdomain);
  const url = new URL(path, origin);
  if (!path.startsWith('/api/v2/') || url.origin !== origin || !url.pathname.startsWith('/api/v2/')) {
    throw new ZendeskError(`Zendesk API paths start with /api/v2/ and stay under it, so ${path} was not sent.`, null);
  }
  return url.href;
}

/**
 * Let go of an answer that will not be read, so its connection is freed now
 * rather than when the timeout or the garbage collector gets to it.
 * @param response - The answer being dropped.
 */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel();
}

/**
 * Send one API call with this token.
 * @param url - The checked URL from {@link zendeskApiUrl}.
 * @param request - The call.
 * @param accessToken - The bearer token.
 * @param credentials - The client, for the host in an error.
 * @param deps - Injected for tests.
 */
function sendWithToken(url: string, request: ZendeskRequest, accessToken: string, credentials: ZendeskCredentials, deps: ZendeskDeps): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (request.idempotencyKey !== undefined) {
    headers['idempotency-key'] = request.idempotencyKey;
  }
  return sendToZendesk(url, {
    method: request.method ?? 'GET',
    headers,
    body: request.body,
  }, credentials, deps);
}

/**
 * The sentence for an API call Zendesk refused.
 * @param status - Zendesk's HTTP status.
 * @param vendor - Zendesk's own words, redacted, or null.
 * @param request - The call.
 */
function apiFailureMessage(status: number, vendor: string | null, request: ZendeskRequest): string {
  const said = vendor ? `: ${vendor}` : '';
  if (status === 401) {
    return `Zendesk refused the OAuth token${said}. Its tokens act as the admin who made the OAuth client, so check that admin is still active and the client still exists.`;
  }
  if (status === 403) {
    return `Zendesk did not let the OAuth token do this${said}. Check the client allows ${request.scopes.join(' ')}, and that the admin who made it still has access.`;
  }
  if (status === 429) {
    return 'Zendesk\'s rate limit for this account is spent. Try again in a minute.';
  }
  return `Zendesk answered HTTP ${status} for ${request.path}${said}.`;
}

/**
 * `fetch` with a fresh timeout per attempt, redirects refused, and one short
 * 429 waited out when Zendesk says how long.
 * @param url - Where to send it, always on the account's origin.
 * @param init - Method, headers and body.
 * @param credentials - The client, for the host in the error.
 * @param deps - Injected for tests.
 */
async function sendToZendesk(url: string, init: RequestInit, credentials: ZendeskCredentials, deps: ZendeskDeps): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? sleepFor;
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new ZendeskError(`Zendesk could not be reached at ${credentials.subdomain}.zendesk.com (${err instanceof Error ? err.name : 'network error'}).`, null);
    }
    if (response.status !== 429 || attempt > 0) {
      return response;
    }
    const waitMs = retryAfterMs(response.headers);
    if (waitMs === null || waitMs > MAX_RATE_LIMIT_WAIT_MS) {
      return response;
    }
    await discardBody(response);
    await sleep(waitMs);
  }
}

/**
 * Wait this long.
 * @param ms - Milliseconds.
 */
function sleepFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The response body as text, or null when it could not be read to the end
 * (the timeout or a dropped connection cut it off), which is not the same as
 * an empty body.
 * @param response - Zendesk's answer.
 */
async function readText(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * The body as a JSON object, or null when it is not one.
 * @param text - The raw body.
 */
function parseJson(text: string): Record<string, unknown> | null {
  if (!text) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Zendesk's own words about a failure, short and with every secret blanked
 * out, since some APIs echo the request back in their errors. The token
 * endpoint follows OAuth, where `error` is a code and `error_description` the
 * sentence. The API puts a code in `error` too (`RecordInvalid`) and the
 * sentence in `description`, or nests both in `error` as `{ title, message }`,
 * so the sentence is read first there and the bare code last.
 * @param body - The parsed body, if it was JSON.
 * @param text - The raw body.
 * @param secrets - Values that must never appear in a message.
 * @param endpoint - `token` for the OAuth token endpoint, `api` for an API call.
 */
function vendorMessage(body: Record<string, unknown> | null, text: string, secrets: readonly string[], endpoint: 'token' | 'api'): string | null {
  const nested = typeof body?.error === 'object' && body.error !== null ? body.error as Record<string, unknown> : null;
  const fields = endpoint === 'token'
    ? [body?.error_description, body?.error, body?.description, body?.message]
    : [body?.description, nested?.message, body?.message, body?.error];
  const said = fields.find(field => typeof field === 'string' && field.trim()) as string | undefined;
  let message = (said ?? text).trim();
  for (const secret of secrets) {
    if (secret) {
      message = message.replaceAll(secret, '[redacted]');
    }
  }
  return message ? message.slice(0, VENDOR_MESSAGE_CHARS) : null;
}
