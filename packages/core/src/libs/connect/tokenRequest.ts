/**
 * The token request every login shares (#1080): one POST to a vendor's
 * token endpoint, bounded by a timeout, whose refusal keeps only the
 * vendor's short error code. No database here, so a light module such as
 * `libs/sources/googleAuth.ts` can refresh through it without pulling in
 * the storage half that lives in `loginGrant.ts`.
 */

import { Buffer } from 'node:buffer';
import { logger } from '@/libs/Logger';

const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const SAFE_ERROR_CODE = /^[\w.-]{1,64}$/;

/**
 * A token request the vendor refused or never answered. `code` is the
 * vendor's OAuth error code (`invalid_grant`), `http_<status>`, `timeout` or
 * `unreachable`: never the vendor's free text, which can echo what was sent.
 */
export class TokenRequestError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(vendor: string, code: string, status: number | null) {
    super(`${vendor} refused the token request (${code}).`);
    this.name = 'TokenRequestError';
    this.code = code;
    this.status = status;
  }
}

/**
 * The OAuth error code of a refusal body, when it is a safe short code.
 * @param body - The parsed response body, if it parsed.
 */
function vendorErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const fields = body as Record<string, unknown>;
  if (fields.error === 'invalid_request' && saysTheRefreshTokenIsDead(fields)) {
    return 'invalid_grant';
  }
  return typeof fields.error === 'string' && SAFE_ERROR_CODE.test(fields.error) ? fields.error : null;
}

/**
 * Whether an `invalid_request` refusal really means the refresh token is
 * dead, which RFC 6749 calls `invalid_grant`. HubSpot and Zoom answer a dead
 * refresh token with `invalid_request` and name the cause in a field of their
 * own. Read as `invalid_grant`, it tells the person to log in again; read as
 * itself, it would promise a retry that can never succeed. Only these exact
 * answers count: Zoom also says `invalid_request` for its own internal
 * errors, which must stay retryable.
 * @param fields - The parsed refusal body.
 */
function saysTheRefreshTokenIsDead(fields: Record<string, unknown>): boolean {
  // HubSpot, live 2026-10-06: {"status":"BAD_REFRESH_TOKEN","error":"invalid_request",...}
  if (fields.status === 'BAD_REFRESH_TOKEN') {
    return true;
  }
  // Zoom, as its developer forum reports it: {"reason":"Invalid Token!","error":"invalid_request"}
  return fields.reason === 'Invalid Token!';
}

/**
 * POST to a vendor's token endpoint and return the parsed body. Bounded by a
 * 15 second timeout. The client secret goes in the body or as HTTP Basic, as
 * the vendor asks; it is never logged.
 * @param input - The request.
 * @param input.vendor - The vendor's name, for the error.
 * @param input.url - The token endpoint.
 * @param input.params - The body parameters.
 * @param input.encoding - `form` (application/x-www-form-urlencoded) or `json`.
 * @param input.basicAuth - Client id and secret to send as HTTP Basic instead of in the body.
 * @param input.basicAuth.clientId - The OAuth client id.
 * @param input.basicAuth.clientSecret - The OAuth client secret.
 * @param input.extraHeaders - Headers the vendor requires on its token endpoint, such as Notion's `Notion-Version`.
 */
export async function postTokenRequest(input: {
  vendor: string;
  url: string;
  params: Record<string, string>;
  encoding: 'form' | 'json';
  basicAuth?: { clientId: string; clientSecret: string };
  extraHeaders?: Record<string, string>;
}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    ...input.extraHeaders,
    'accept': 'application/json',
    'content-type': input.encoding === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
  };
  if (input.basicAuth) {
    headers.authorization = `Basic ${Buffer.from(`${input.basicAuth.clientId}:${input.basicAuth.clientSecret}`).toString('base64')}`;
  }
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: 'POST',
      headers,
      body: input.encoding === 'form' ? new URLSearchParams(input.params).toString() : JSON.stringify(input.params),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TokenRequestError(input.vendor, error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable', null);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    // Not JSON: the status below still says what happened.
    logger.warn('postTokenRequest got a body that is not JSON', { vendor: input.vendor, status: response.status, errorName: error instanceof Error ? error.name : 'unknown' });
  }
  if (!response.ok || !body || typeof body !== 'object') {
    throw new TokenRequestError(input.vendor, vendorErrorCode(body) ?? `http_${response.status}`, response.status);
  }
  return body as Record<string, unknown>;
}

/** Vendor answers that mean the login itself is gone, so only logging in again fixes it. */
const LOGIN_IS_GONE = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied', 'http_400', 'http_401', 'http_403']);

/**
 * Whether a refused token request means the grant itself is gone, so only a
 * new login (or a new paste) fixes it, rather than an outage the next sync
 * rides out. For refresh paths that do not go through `refreshLoginGrant`.
 * @param error - A `TokenRequestError` from `postTokenRequest`.
 */
export function refusalMeansLoginIsGone(error: TokenRequestError): boolean {
  return LOGIN_IS_GONE.has(error.code);
}
