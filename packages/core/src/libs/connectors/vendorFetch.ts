/**
 * One JSON request to a vendor's API, its failure shaped for a person.
 *
 * The CRM and meeting-recorder connectors (Salesforce, Pipedrive, Attio,
 * Gong, Fireflies, Google Meet) all talk to an HTTP API the same way: send a
 * request with the workspace's credential, wait a bounded time, back off when
 * the vendor says it is rate limiting, and turn a refusal into a sentence
 * that names the fix instead of an opaque exception. That is this module,
 * once, so each client only knows its own paths and payloads.
 *
 * Errors are DATA, never throws, as the Sentry and HubSpot clients have it:
 * a tool hands the failure to the model as its answer, a Test connection puts
 * it on the checklist, and a sync — whose contract is throw-on-failure —
 * calls `orThrow`. No message ever carries a credential: the request is never
 * echoed, only the vendor's own short message.
 */

import { setTimeout as sleep } from 'node:timers/promises';

export type VendorFailureCode = 'unauthorized' | 'not_found' | 'rate_limited' | 'bad_request' | 'vendor_error' | 'unreachable';

export type VendorFailure = { ok: false; error: VendorFailureCode; status: number | null; message: string };

export type VendorResult<T> = { ok: true; status: number; data: T } | VendorFailure;

export type VendorRequest = {
  /** The vendor's name, as a person knows it: `Salesforce`. */
  vendor: string;
  url: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** A JSON body. */
  json?: unknown;
  /** A form-encoded body, for token endpoints. */
  form?: Record<string, string>;
  /** Read the body as text rather than JSON (a document export). */
  text?: boolean;
  /** What to do about a refused credential, appended to the 401/403 sentence. */
  authHint?: string;
  /** How many times a 429 or 503 is retried before it is returned. Default 3. */
  retries?: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 3;
/** Never wait longer than this on one Retry-After, whatever the vendor asks. */
const MAX_BACKOFF_MS = 30_000;

/**
 * How long a vendor asked to wait, from `Retry-After` (seconds or an HTTP
 * date), else a short growing pause.
 * @param header - The `Retry-After` header, if sent.
 * @param attempt - The retry this wait precedes, from 1.
 * @param now - Injected for tests.
 */
export function backoffMs(header: string | null | undefined, attempt: number, now: number = Date.now()): number {
  if (header !== null && header !== undefined && header.trim() !== '') {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
    const at = Date.parse(header);
    if (!Number.isNaN(at)) {
      return Math.min(Math.max(at - now, 0), MAX_BACKOFF_MS);
    }
  }
  return Math.min(1000 * attempt, MAX_BACKOFF_MS);
}

/**
 * The vendor's own short message out of an error body, whichever shape it
 * uses: `{ message }`, `{ error: "…" }`, `{ error: { message } }`,
 * `{ errors: [{ message }] }`, or Salesforce's `[{ message, errorCode }]`.
 * @param raw - The response body as text.
 */
export function vendorMessage(raw: string): string {
  let said = raw;
  try {
    const body = JSON.parse(raw) as unknown;
    const first = Array.isArray(body) ? body[0] : body;
    if (first && typeof first === 'object') {
      const b = first as Record<string, unknown>;
      const nested = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>).message : undefined;
      const listed = Array.isArray(b.errors) && b.errors[0] && typeof b.errors[0] === 'object' ? (b.errors[0] as Record<string, unknown>).message : undefined;
      const candidate = [b.message, nested, listed, b.error, b.error_description, b.errorCode].find(v => typeof v === 'string' && v.trim() !== '');
      if (typeof candidate === 'string') {
        said = candidate;
      }
    }
  } catch {
    // Not JSON: the text itself is the message.
  }
  return said.replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * Send one request and shape the answer. 429 and 503 are retried after the
 * wait the vendor asked for; everything else returns at once.
 * @param req - The request.
 */
export async function vendorRequest<T>(req: VendorRequest): Promise<VendorResult<T>> {
  const retries = req.retries ?? DEFAULT_RETRIES;
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
  let body: string | undefined;
  if (req.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.json);
  } else if (req.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(req.form).toString();
  }
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await globalThis.fetch(req.url, { method: req.method ?? 'GET', headers, body, signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, error: 'unreachable', status: null, message: `${req.vendor} did not answer (${reason.slice(0, 120)}). Try again in a minute.` };
    }
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      await sleep(backoffMs(res.headers.get('retry-after'), attempt + 1));
      continue;
    }
    if (res.ok) {
      if (res.status === 204) {
        return { ok: true, status: res.status, data: undefined as T };
      }
      const raw = await res.text().catch(() => '');
      if (req.text) {
        return { ok: true, status: res.status, data: raw as T };
      }
      try {
        return { ok: true, status: res.status, data: (raw === '' ? undefined : JSON.parse(raw)) as T };
      } catch {
        return { ok: false, error: 'vendor_error', status: res.status, message: `${req.vendor} answered with something that is not JSON.` };
      }
    }
    const said = vendorMessage(await res.text().catch(() => ''));
    const detail = said ? `: ${said}` : '';
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'unauthorized', status: res.status, message: `${req.vendor} refused the credential (HTTP ${res.status}${detail}).${req.authHint ? ` ${req.authHint}` : ''}` };
    }
    if (res.status === 404) {
      return { ok: false, error: 'not_found', status: 404, message: `${req.vendor} has nothing there (HTTP 404${detail}). Check the id.` };
    }
    if (res.status === 429) {
      return { ok: false, error: 'rate_limited', status: 429, message: `${req.vendor} is rate limiting this workspace's credential${detail}. Try again in a minute.` };
    }
    if (res.status >= 400 && res.status < 500) {
      return { ok: false, error: 'bad_request', status: res.status, message: `${req.vendor} refused the request (HTTP ${res.status}${detail}).` };
    }
    return { ok: false, error: 'vendor_error', status: res.status, message: `${req.vendor} answered HTTP ${res.status}${detail}. Try again in a few minutes.` };
  }
}

/**
 * The data, or a thrown `Error` carrying the failure's sentence — for a sync,
 * whose contract is throw-on-failure, and a family provider, whose callers
 * catch and hand the sentence on.
 * @param result - What `vendorRequest` returned.
 */
export function orThrow<T>(result: VendorResult<T>): T {
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}

/**
 * A credential value as a trimmed string, or empty.
 * @param bag - The decrypted credential bag.
 * @param key - The field name, as the platform descriptor stores it.
 */
export function credentialString(bag: Record<string, unknown> | undefined | null, key: string): string {
  const value = bag?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A pause between requests to a vendor with a per-second limit.
 * @param ms - How long.
 */
export async function pace(ms: number): Promise<void> {
  if (ms > 0) {
    await sleep(ms);
  }
}
