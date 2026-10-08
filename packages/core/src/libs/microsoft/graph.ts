/**
 * Microsoft Graph, as the Microsoft 365 connectors, tools and actions call it:
 * the token a call spends, one request with Graph's throttling honoured, and
 * paging over `@odata.nextLink`.
 *
 * The token is always the workspace's own Microsoft login (or a pasted OAuth
 * client and refresh token), resolved per call and never cached across orgs:
 * a login grant refreshes through `usableLoginGrant`, which saves Microsoft's
 * rotated refresh token to the row it was read from. A pasted client mints an
 * access token from its refresh token and keeps it in memory, keyed by that
 * refresh token, until shortly before it expires.
 *
 * Errors come back as sentences a person can act on, naming the Graph status
 * and error code but never the vendor's free text, which can echo a token.
 */

import type { GrantPersistence } from '@/libs/connect/loginGrant';
import { Buffer } from 'node:buffer';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { MICROSOFT_TOKEN_URL, refreshMicrosoftGrant } from '@/libs/connect/providers/microsoft';
import { postTokenRequest, refusalFix, TokenRequestError } from '@/libs/connect/tokenRequest';
import { logger } from '@/libs/Logger';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** How many times a throttled (429) or briefly unavailable (503/504) call is tried again. */
const THROTTLE_RETRIES = 3;
/** The longest a single Retry-After is honoured, so a sync never stalls for minutes on one call. */
const MAX_RETRY_AFTER_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
const SAFE_CODE = /^[\w.-]{1,80}$/;

/** A Graph call that did not succeed, with the status and Graph's short error code. */
export class GraphError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Pause, overridable in tests through a request's `sleep`.
 * @param ms - How long to wait.
 */
function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * How long Graph asked us to wait, from `Retry-After` (seconds), capped.
 * @param response - The throttled response.
 * @param attempt - Which retry this is, for a backoff when Graph names no wait.
 */
function retryAfterMs(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'));
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 1000 * 2 ** attempt;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/**
 * The sentence a failed Graph call ends with: what failed and the one fix.
 * @param what - What was being read or written, e.g. "Outlook messages".
 * @param status - The HTTP status.
 * @param code - Graph's short error code, when safe.
 */
export function graphFailure(what: string, status: number, code: string | null): string {
  const tag = code ? `${status} ${code}` : String(status);
  if (status === 401) {
    return `Microsoft refused the login while reading ${what} (${tag}). An admin needs to log in with Microsoft again on the Connectors page.`;
  }
  if (status === 403) {
    return `Microsoft 365 says this login may not read ${what} (${tag}). Log in with Microsoft again for this connector so it asks for the permission; Teams channel messages also need an admin to grant consent for the organization.`;
  }
  if (status === 404) {
    return `Microsoft 365 could not find ${what} (${tag}). Check the connector's settings.`;
  }
  if (status === 429 || status >= 500) {
    return `Microsoft 365 is busy or unavailable while reading ${what} (${tag}). Nothing was lost; try again in a few minutes.`;
  }
  return `Microsoft 365 refused the request for ${what} (${tag}).`;
}

/**
 * Graph's short error code from a failed response, when it is safe to show.
 * @param response - The failed response.
 */
async function errorCodeOf(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    const code = body?.error?.code;
    return typeof code === 'string' && SAFE_CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export type GraphRequest = {
  /** A path under `/v1.0` (`/me/messages`) or a full Graph URL (an `@odata.nextLink`). */
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Extra headers, e.g. `Prefer` or `ConsistencyLevel`. */
  headers?: Record<string, string>;
  /** What is being read or written, for the error sentence. */
  what: string;
  /** Overrides the Graph base, for tests. */
  baseUrl?: string;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * The full URL a request goes to. Only Graph's own host is followed, so a
 * `@odata.nextLink` can never send the token anywhere else.
 * @param path - A path or a full Graph URL.
 * @param baseUrl - The Graph base.
 */
function urlFor(path: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    const base = new URL(baseUrl);
    if (url.host !== base.host) {
      throw new GraphError(`Microsoft Graph pointed at another host (${url.host}); the request was not sent.`, 0, null);
    }
    return url.toString();
  }
  return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * One Graph call. Throttling (429) and brief unavailability (503, 504) are
 * waited out per `Retry-After`, a few times; anything else that fails throws
 * a `GraphError` whose message names the fix.
 * @param token - The access token.
 * @param request - What to call.
 * @returns The response, still unread, for a caller that wants bytes or headers.
 */
export async function graphFetch(token: string, request: GraphRequest): Promise<Response> {
  const sleep = request.sleep ?? pause;
  const url = urlFor(request.path, request.baseUrl ?? GRAPH_BASE);
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...request.headers,
        },
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt < THROTTLE_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new GraphError(`Microsoft 365 did not answer while reading ${request.what} (${error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable'}). Try again in a few minutes.`, 0, null);
    }
    if ((response.status === 429 || response.status === 503 || response.status === 504) && attempt < THROTTLE_RETRIES) {
      await sleep(retryAfterMs(response, attempt));
      continue;
    }
    if (!response.ok) {
      const code = await errorCodeOf(response);
      throw new GraphError(graphFailure(request.what, response.status, code), response.status, code);
    }
    return response;
  }
}

/**
 * One Graph call, its JSON body parsed. A 204 parses to an empty object.
 * @param token - The access token.
 * @param request - What to call.
 */
export async function graphJson<T>(token: string, request: GraphRequest): Promise<T> {
  const response = await graphFetch(token, request);
  if (response.status === 204) {
    return {} as T;
  }
  return await response.json() as T;
}

/**
 * Every item of a Graph collection, page by page over `@odata.nextLink`.
 * @param token - The access token.
 * @param request - The first page.
 * @param maxPages - A ceiling, so a runaway listing ends.
 * @yields {T} Each item, in Graph's order.
 */
export async function* graphPages<T>(token: string, request: GraphRequest, maxPages = 500): AsyncIterable<T> {
  let path: string | undefined = request.path;
  for (let page = 0; path && page < maxPages; page += 1) {
    const body: { 'value'?: T[]; '@odata.nextLink'?: string } = await graphJson(token, { ...request, path });
    for (const item of body.value ?? []) {
      yield item;
    }
    path = body['@odata.nextLink'];
  }
}

/** Access tokens minted from a pasted refresh token, keyed by it. */
const pastedCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * An access token from a pasted OAuth client and refresh token. Kept in memory
 * until five minutes before it expires; a rotated refresh token is not saved
 * (Microsoft does not revoke the one used), which is why a login is the
 * durable path and pasting the stopgap.
 * @param bag - The pasted values.
 * @param bag.clientId - The app's client ID.
 * @param bag.clientSecret - The app's client secret.
 * @param bag.refreshToken - The refresh token the app was issued.
 */
async function pastedAccessToken(bag: { clientId: string; clientSecret: string; refreshToken: string }): Promise<string> {
  const cached = pastedCache.get(bag.refreshToken);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
    return cached.token;
  }
  let body: Record<string, unknown>;
  try {
    body = await postTokenRequest({
      vendor: 'Microsoft',
      url: MICROSOFT_TOKEN_URL,
      encoding: 'form',
      params: { grant_type: 'refresh_token', client_id: bag.clientId, client_secret: bag.clientSecret, refresh_token: bag.refreshToken, scope: 'https://graph.microsoft.com/.default offline_access' },
    });
  } catch (error) {
    if (!(error instanceof TokenRequestError)) {
      throw error;
    }
    logger.warn('microsoft pasted refresh refused', { code: error.code });
    const fix = refusalFix(error);
    throw new Error(fix === 'try-later'
      ? `Microsoft could not refresh the access token just now (${error.code}). Try again in a few minutes.`
      : `Microsoft refused the pasted OAuth client or refresh token (${error.code}). An admin needs to paste them again, or log in with Microsoft, on the Connectors page.`);
  }
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('Microsoft answered the token refresh without an access token. Try again in a few minutes.');
  }
  const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  pastedCache.set(bag.refreshToken, { token: body.access_token, expiresAt: Date.now() + lifetime * 1000 });
  return body.access_token;
}

/**
 * The Graph access token a call spends, from the stored credential bag: a
 * Microsoft login (refreshed and saved when expiring, per `persistence`), a
 * pasted OAuth client with its refresh token, or a bare pasted access token.
 * @param credentials - The decrypted bag.
 * @param persistence - Where a refreshed login is saved, or `never` (Test connection on typed values).
 * @param connectorSlug - The connector calling, for the refresh's bookkeeping.
 */
export async function resolveGraphToken(credentials: Record<string, unknown> | undefined, persistence: GrantPersistence, connectorSlug: string): Promise<string> {
  if (isLoginGrant(credentials)) {
    const grant = await usableLoginGrant({ vendor: 'Microsoft', provider: 'microsoft', connectorSlug, grant: credentials, persistence, refresh: refreshMicrosoftGrant });
    return grant.accessToken;
  }
  const clientId = typeof credentials?.clientId === 'string' ? credentials.clientId.trim() : '';
  const clientSecret = typeof credentials?.clientSecret === 'string' ? credentials.clientSecret.trim() : '';
  const refreshToken = typeof credentials?.refreshToken === 'string' ? credentials.refreshToken.trim() : '';
  if (clientId && clientSecret && refreshToken) {
    return pastedAccessToken({ clientId, clientSecret, refreshToken });
  }
  const raw = typeof credentials?.token === 'string' ? credentials.token : '';
  if (raw) {
    return raw;
  }
  throw new Error('This Microsoft 365 connector has no login. An admin needs to log in with Microsoft on the Connectors page.');
}

/**
 * Where a refreshed login is saved when a sync, an agent tool or an action
 * spends it: the source it was read through. Warnings go to the log, since a
 * tool or an action has no progress channel.
 * @param orgId - The workspace.
 * @param sourceId - The source whose credential is being spent.
 * @param warn - Where a "could not save" warning goes; the log by default.
 */
export function persistTo(orgId: string, sourceId: number, warn?: (message: string) => void): GrantPersistence {
  return { kind: 'persist', orgId, sourceId, warn: warn ?? (message => logger.warn('microsoft login refresh warning', { orgId, sourceId, message })) };
}

/**
 * Plain text from an HTML body, for an index or a model. Tags dropped, the
 * common entities decoded, whitespace folded.
 * @param html - An HTML fragment.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, '\'')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The bytes of a Graph response, for file content.
 * @param response - A successful response.
 */
export async function responseBytes(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}
