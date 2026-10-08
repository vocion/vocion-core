/**
 * The address a request came from, for per-IP rate limits.
 *
 * The app always sits behind a reverse proxy (Caddy on a box, a load balancer
 * on Cloud), so the socket address is the proxy's and the client is in
 * `X-Forwarded-For`. That header is a list each hop APPENDS to, and its left
 * end is whatever the client chose to send: reading the first entry lets anyone
 * pick a fresh IP per request and walk past every per-IP limit. So the address
 * is counted from the RIGHT, skipping the hops this deployment put there
 * itself: `VOCION_TRUSTED_PROXY_COUNT` (default 1, one proxy in front of the
 * app). Two proxies (a CDN in front of a load balancer) set it to 2.
 *
 * `X-Real-IP` is the fallback for a proxy that sets that instead. No header at
 * all answers null — and a null address skips per-IP limits rather than
 * pooling every caller into one bucket, because one shared bucket would let a
 * single noisy client lock everyone out (`libs/rateLimit`).
 */

import process from 'node:process';

/** How many proxies this deployment runs in front of the app. */
function trustedProxyCount(): number {
  const raw = Number.parseInt(process.env.VOCION_TRUSTED_PROXY_COUNT ?? '', 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
}

/**
 * The client's address as the nearest trusted proxy saw it, or null when the
 * request carries no forwarding header.
 * @param headers - The request's headers.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map(hop => hop.trim()).filter(Boolean);
    if (hops.length > 0) {
      // The last `trusted` entries were written by our own proxies; the one
      // they recorded as their client is `trusted` from the end. A shorter
      // chain than configured means the request reached a proxy directly, and
      // its left end is the best there is.
      const index = Math.max(0, hops.length - trustedProxyCount());
      return hops[index] ?? null;
    }
  }
  const real = headers.get('x-real-ip')?.trim();
  return real || null;
}
