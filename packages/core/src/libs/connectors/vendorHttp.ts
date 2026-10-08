/**
 * One HTTP call to a vendor's API, for the finance and people connectors:
 * a timeout, a single polite retry when the vendor says to slow down, and a
 * failure that is a sentence a person acts on — never the request, the
 * token or the vendor's raw body.
 *
 * Every call is built per request with the caller's own credential (the
 * org's), so nothing here caches a client or a token.
 */

/** The network, injectable so tests answer from fixtures and never go out. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A vendor call that failed, worded for the fix. */
export class VendorRequestError extends Error {
  readonly status: number | null;
  /**
   * True when every other call with this credential would fail the same way
   * (a refused key, a rate limit), so a sync stops rather than reporting the
   * same sentence for every slice.
   */
  readonly fatal: boolean;

  constructor(message: string, status: number | null, fatal: boolean) {
    super(message);
    this.name = 'VendorRequestError';
    this.status = status;
    this.fatal = fatal;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** The longest a 429's Retry-After is waited out before the call gives up. */
const MAX_RETRY_WAIT_MS = 5_000;

/**
 * Seconds a 429 asks to wait, from `Retry-After`, capped; a default when it
 * says nothing usable.
 * @param header - The header's value.
 */
function retryWaitMs(header: string | null): number {
  const seconds = header ? Number(header) : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : 1_000;
}

/**
 * The vendor's own short error message out of a JSON body, when it has one.
 * Read from the common shapes (`error.message`, `message`, `errors[0].message`,
 * `Message`, `detail`), cut to 200 characters.
 * @param body - The parsed body.
 */
export function vendorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const b = body as Record<string, unknown>;
  const nested = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>) : null;
  const firstError = Array.isArray(b.errors) && b.errors[0] && typeof b.errors[0] === 'object' ? (b.errors[0] as Record<string, unknown>) : null;
  const candidates = [nested?.message, b.message, b.Message, b.detail, b.error_description, firstError?.message, firstError?.detail, typeof b.error === 'string' ? b.error : undefined];
  const found = candidates.find(c => typeof c === 'string' && c.trim());
  return typeof found === 'string' ? found.trim().slice(0, 200) : null;
}

/**
 * The failure for a non-2xx answer.
 * @param vendor - The vendor's name, as a person knows it.
 * @param what - What was being read, e.g. `invoices`.
 * @param status - The HTTP status.
 * @param body - The parsed body, if it parsed.
 */
export function vendorFailure(vendor: string, what: string, status: number, body: unknown): VendorRequestError {
  const detail = vendorMessage(body);
  const said = detail ? ` ${vendor} said: ${detail}` : '';
  if (status === 401) {
    return new VendorRequestError(`${vendor} refused the credential (401). An admin needs to replace it, or log in again, on the Connectors page.${said}`, status, true);
  }
  if (status === 403) {
    return new VendorRequestError(`${vendor} would not let this credential read ${what} (403): it was not granted that access.${said}`, status, false);
  }
  if (status === 404) {
    return new VendorRequestError(`${vendor} has no such ${what} (404).${said}`, status, false);
  }
  if (status === 429) {
    return new VendorRequestError(`${vendor} is rate-limiting this account (429). Try again in a minute.${said}`, status, true);
  }
  if (status >= 500) {
    return new VendorRequestError(`${vendor} failed on its side reading ${what} (${status}). Try again later.${said}`, status, false);
  }
  return new VendorRequestError(`${vendor} rejected the request for ${what} (${status}).${said}`, status, false);
}

/**
 * Call a vendor and return its JSON body.
 * @param input - The call.
 * @param input.vendor - The vendor's name, for the error sentence.
 * @param input.what - What is being read or written, for the error sentence.
 * @param input.url - The full URL.
 * @param input.init - Method, headers and body.
 * @param input.fetch - The network; the global one when left out.
 * @param input.timeoutMs - How long to wait for an answer.
 * @param input.sleep - Injected for tests: how a retry waits.
 * @throws {VendorRequestError} On a timeout, an unreachable host or a non-2xx answer.
 */
export async function vendorJson<T = unknown>(input: {
  vendor: string;
  what: string;
  url: string;
  init?: RequestInit;
  fetch?: FetchLike;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  const doFetch = input.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = input.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await doFetch(input.url, { ...input.init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new VendorRequestError(timedOut ? `${input.vendor} did not answer within ${timeoutMs / 1000}s reading ${input.what}. Try again later.` : `${input.vendor} could not be reached. Try again later.`, null, true);
    }
    if (response.status === 429 && attempt === 0) {
      await sleep(retryWaitMs(response.headers?.get?.('retry-after') ?? null));
      continue;
    }
    let body: unknown = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON: the status says what happened.
      }
    }
    if (!response.ok) {
      throw vendorFailure(input.vendor, input.what, response.status, body);
    }
    return body as T;
  }
}

/**
 * Whether `next` is a URL on the same host as `base` — the check before
 * following a vendor's own "next page" link, so a credential is never sent
 * anywhere a response pointed.
 * @param next - The next-page URL the vendor returned.
 * @param base - The API base the credential belongs to.
 */
export function sameHost(next: string, base: string): boolean {
  try {
    const a = new URL(next);
    const b = new URL(base);
    return a.protocol === 'https:' && a.host === b.host;
  } catch {
    return false;
  }
}
