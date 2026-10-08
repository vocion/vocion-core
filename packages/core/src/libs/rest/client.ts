/**
 * The one HTTP client behind every call a `rest` source makes — the read
 * tools, the `rest.request` action and Test connection all go through here,
 * so the auth header, the timeout, the error shaping and the response
 * trimming exist exactly once.
 *
 * Failures are DATA, never throws (the same contract as `libs/hubspot/client.ts`
 * and `libs/apollo/client.ts`): a tool hands the failure object straight back
 * to the model, which can then say "the token was refused" instead of eating
 * an opaque exception. The action, whose contract is throw-on-failure,
 * unwraps and throws itself.
 *
 * The token is used for the auth header and nowhere else — never in a
 * message, a log line, a result or a thrown error. The header is
 * `Authorization: Bearer <token>` unless the credential names another
 * (`headerName`, `scheme`): `X-Auth-Token: <token>`, `Authorization: Token
 * <token>`. One header, built in one place (`authHeaderFor`).
 */

import type { RestMethod } from './spec';
import { AUTH_SCHEME_PATTERN, HEADER_NAME_PATTERN } from './authHeader';

/**
 * What the `rest` credential platform stores: the API and the token, plus
 * how the token is sent when it is not `Authorization: Bearer <token>`.
 */
export type RestCredentials = {
  baseUrl: string;
  token: string;
  /** The header the token goes in. Absent: `Authorization`. */
  headerName?: string;
  /**
   * The word before the token. Absent: `Bearer` on `Authorization`, nothing on
   * any other header. `none` sends the token bare on `Authorization` too.
   */
  scheme?: string;
};

/**
 * Why a call did not produce data. Each code is one sentence the model or a
 * reviewer acts on; `http_401` and `http_403` say out loud that the token may
 * have expired or lack rights, since that is the fix and it is not the model's.
 */
export type RestErrorCode
  = | 'no_credentials'
    | 'http_401'
    | 'http_403'
    | 'http_404'
    | 'http_4xx'
    | 'http_5xx'
    | 'timeout'
    | 'invalid_json'
    | 'network_error';

export type RestFailure = {
  ok: false;
  error: RestErrorCode;
  /** The HTTP status, or null when no response arrived. */
  status: number | null;
  message: string;
  /** The response body, parsed when it was JSON, else its leading text. */
  body?: unknown;
};

export type RestResult = { ok: true; status: number; data: unknown } | RestFailure;

/** How long a call may take before it is reported as `timeout`. */
export const REST_TIMEOUT_MS = 15_000;

/** How much of an error body rides in a failure message. */
const ERROR_BODY_CHARS = 500;

/**
 * The credential out of a vault document, or undefined when the base URL or
 * the token is missing, or the header or scheme it names is not one HTTP
 * allows (the registry refuses those at save, so this is the backstop).
 * @param credentials - The decrypted `rest` credential, if any.
 */
export function restCredentialsOf(credentials?: Record<string, unknown> | null): RestCredentials | undefined {
  const baseUrl = credentials?.baseUrl;
  const token = credentials?.token;
  // A control character would make the header invalid, and the transport's
  // error for that quotes the value: refused here, before any header is built.
  // eslint-disable-next-line no-control-regex
  if (typeof baseUrl !== 'string' || !/^https?:\/\/\S+$/i.test(baseUrl.trim()) || typeof token !== 'string' || token.trim() === '' || /[\u0000-\u001F\u007F]/.test(token.trim())) {
    return undefined;
  }
  const headerName = optionalText(credentials?.headerName);
  const scheme = optionalText(credentials?.scheme);
  if ((headerName !== undefined && !HEADER_NAME_PATTERN.test(headerName)) || (scheme !== undefined && !AUTH_SCHEME_PATTERN.test(scheme))) {
    return undefined;
  }
  return {
    baseUrl: baseUrl.trim(),
    token: token.trim(),
    ...(headerName !== undefined ? { headerName } : {}),
    ...(scheme !== undefined ? { scheme } : {}),
  };
}

/**
 * A stored optional field: its trimmed text, or undefined when blank or absent.
 * @param value - The vault's value.
 */
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * The header the token goes out in, as `[name, value]`.
 * @param credentials - The resolved credential.
 */
export function authHeaderFor(credentials: RestCredentials): [string, string] {
  const name = credentials.headerName ?? 'Authorization';
  const onAuthorization = name.toLowerCase() === 'authorization';
  const scheme = credentials.scheme ?? (onAuthorization ? 'Bearer' : undefined);
  const prefix = scheme === undefined || scheme.toLowerCase() === 'none' ? '' : `${scheme} `;
  return [name, `${prefix}${credentials.token}`];
}

/**
 * How the token is sent, in words, with no part of the token: "Bearer token
 * in Authorization", "X-Auth-Token header".
 * @param credentials - The resolved credential.
 */
export function describeAuth(credentials: Partial<RestCredentials>): string {
  const name = credentials.headerName ?? 'Authorization';
  const onAuthorization = name.toLowerCase() === 'authorization';
  const scheme = credentials.scheme ?? (onAuthorization ? 'Bearer' : undefined);
  if (scheme === undefined || scheme.toLowerCase() === 'none') {
    return `${name} header`;
  }
  return `${scheme} token in ${name}`;
}

/**
 * The failure for a source with nothing in the vault, naming the fix.
 * @param sourceSlug - The source the call was for.
 */
export function noRestCredentials(sourceSlug: string): RestFailure {
  return {
    ok: false,
    error: 'no_credentials',
    status: null,
    message: `No credential is connected for the "${sourceSlug}" source, so its API cannot be called. Connect a base URL and token for it on the Connectors page. Say that rather than guessing.`,
  };
}

/**
 * The full URL for a call: the base with any trailing slash removed, the
 * rendered path, and the query parameters that resolved to something.
 * @param baseUrl - From the credential.
 * @param path - Already rendered (`renderPath`).
 * @param query - Already rendered (`renderQuery`).
 */
export function buildUrl(baseUrl: string, path: string, query: Record<string, string> = {}): string {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const params = new URLSearchParams(query).toString();
  return params ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url;
}

/**
 * Walk a dotted path into a JSON document. Undefined when any step is
 * missing — the caller says so rather than returning the whole document.
 * @param data - The parsed response.
 * @param path - `data.items`, or undefined for the whole document.
 */
export function pickPath(data: unknown, path: string | undefined): unknown {
  if (!path) {
    return data;
  }
  let cursor: unknown = data;
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * A response as compact JSON text, cut at `maxChars` with a notice that says
 * the total length — so the model knows it is reading a prefix, and can ask
 * for a narrower call instead of treating the cut as the end of the list.
 *
 * Compact, not pretty: indentation doubled every payload against the cap and
 * against the model's context (a 29-row project page was ~26k characters
 * pretty and ~13k compact), and the model reads either. The cap measures
 * this form.
 * @param data - What to render.
 * @param maxChars - The cap.
 */
export function capJson(data: unknown, maxChars: number): string {
  const text = data === undefined ? 'null' : JSON.stringify(data);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n… [truncated: the response is ${text.length} characters; the first ${maxChars} are shown. Narrow the call to see the rest.]`;
}

/**
 * A response body as data: JSON when it parses, else its leading text.
 * @param text - The raw body.
 */
function bodyOf(text: string): unknown {
  if (text.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, ERROR_BODY_CHARS);
  }
}

/**
 * The failure for a non-2xx status, with the body the API sent.
 * @param status - The HTTP status.
 * @param text - The raw body.
 */
function httpFailure(status: number, text: string): RestFailure {
  const body = bodyOf(text);
  const excerpt = typeof body === 'string' ? body : JSON.stringify(body).slice(0, ERROR_BODY_CHARS);
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: status === 401 ? 'http_401' : 'http_403',
      status,
      message: `The API answered ${status}: the connected token was refused. It may have expired or lack the rights this endpoint needs — reconnect the credential on the Connectors page. Response: ${excerpt}`,
      body,
    };
  }
  if (status === 404) {
    return { ok: false, error: 'http_404', status, message: `The API answered 404: nothing exists at that path. Check the identifier. Response: ${excerpt}`, body };
  }
  if (status >= 500) {
    return { ok: false, error: 'http_5xx', status, message: `The API answered ${status}: it failed on its side. Try again later. Response: ${excerpt}`, body };
  }
  return { ok: false, error: 'http_4xx', status, message: `The API answered ${status}: it rejected the request. Response: ${excerpt}`, body };
}

/**
 * One call to the API, with the token on it (`authHeaderFor`).
 * @param req - The call.
 * @param req.credentials - Where and as whom.
 * @param req.method - HTTP method.
 * @param req.path - The path, already rendered.
 * @param req.query - Query parameters, already rendered.
 * @param req.body - A JSON body, already rendered; sent for every method but GET.
 * @param req.timeoutMs - Override for tests.
 */
export async function restCall(req: {
  credentials: RestCredentials;
  method: RestMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<RestResult> {
  const url = buildUrl(req.credentials.baseUrl, req.path, req.query);
  const [authName, authValue] = authHeaderFor(req.credentials);
  const headers: Record<string, string> = {
    [authName]: authValue,
    Accept: 'application/json',
  };
  const hasBody = req.method !== 'GET' && req.body !== undefined;
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? REST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (controller.signal.aborted || name === 'AbortError' || name === 'TimeoutError') {
      return { ok: false, error: 'timeout', status: null, message: `The API did not answer within ${Math.round((req.timeoutMs ?? REST_TIMEOUT_MS) / 1000)}s. Try again, or narrow the call.` };
    }
    return { ok: false, error: 'network_error', status: null, message: `The API could not be reached: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    return httpFailure(response.status, text);
  }
  if (text.trim() === '') {
    return { ok: true, status: response.status, data: null };
  }
  try {
    return { ok: true, status: response.status, data: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      error: 'invalid_json',
      status: response.status,
      message: `The API answered ${response.status} but the body is not JSON. It starts: ${text.slice(0, 200)}`,
      body: text.slice(0, ERROR_BODY_CHARS),
    };
  }
}
