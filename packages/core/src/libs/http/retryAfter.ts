/**
 * Retry-After handling for outbound HTTP, in one place.
 *
 * Three callers wanted the same two things and were about to hold three copies:
 * read the wait a 429 asked for, and sleep exactly that long before trying
 * again. Retrying early is worse than waiting — several APIs (Jira, Apollo)
 * extend the penalty for it — so the header wins over our own backoff whenever
 * the server sent one.
 *
 * The cap is the reason this is not a one-liner: a strange or hostile
 * `Retry-After` would otherwise park a sync for an hour.
 */

/** Longest wait a server can ask us for. Anything above is clamped to it. */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * The wait this response asked for, in milliseconds, or null if it asked for
 * none. A whole number of seconds is the common form; an HTTP date is also
 * legal there and parses as NaN, in which case the caller falls back to its
 * own backoff.
 * @param headers - Response headers, or anything with a `get`.
 */
export function retryAfterMs(headers: { get?: (name: string) => string | null } | undefined): number | null {
  const raw = headers?.get?.('retry-after');
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * How long to wait before attempt `attempt + 1`: what the server asked for,
 * else exponential backoff from one second.
 * @param headers - Response headers from the 429.
 * @param attempt - Zero-based number of the attempt that just failed.
 */
function backoffMs(headers: { get?: (name: string) => string | null } | undefined, attempt: number): number {
  return retryAfterMs(headers) ?? 2 ** attempt * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * `fetch`, retrying a 429 for as long as the server keeps asking and the
 * attempt budget lasts. Every other status — including a 5xx — comes back
 * untouched, because only the caller knows which of those are worth a second
 * try and which are data.
 * @param url - Where to send it.
 * @param init - Request options, passed through.
 * @param opts - Attempt budget and wait hook.
 * @param opts.maxRetries - How many 429s to ride out before returning the last one.
 * @param opts.onWait - Called with each wait taken, so a test can see it.
 * @param opts.maxRetries
 * @param opts.onWait
 */
export async function fetchRetryingRateLimits(
  url: string,
  init: RequestInit,
  opts?: { maxRetries?: number; onWait?: (ms: number, attempt: number) => void },
): Promise<Response> {
  const maxRetries = opts?.maxRetries ?? 5;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= maxRetries) {
      return res;
    }
    const waitMs = backoffMs(res.headers, attempt);
    opts?.onWait?.(waitMs, attempt);
    await sleep(waitMs);
  }
}
