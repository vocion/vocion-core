/**
 * What the start and callback routes share: where the callback is, where the
 * person lands afterwards, and how a refusal is spelled in the URL.
 *
 * The callback URL is derived from `NEXT_PUBLIC_APP_URL` and nothing else. A
 * redirect_uri built from a forwarded Host header is a redirect_uri an
 * attacker can choose, so where `publicOrigin` falls back to headers elsewhere,
 * connect fails closed instead: no configured origin, no connect.
 */

import { Env } from '@/libs/Env';

/**
 * The deployment's public origin for connect, or null when it is not
 * configured.
 */
export function connectOrigin(): string | null {
  const configured = Env.NEXT_PUBLIC_APP_URL;
  if (!configured) {
    return null;
  }
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

/**
 * The callback URL a vendor is told to return to, for one provider.
 * @param origin - The configured public origin, from {@link connectOrigin}.
 * @param provider - The provider id, e.g. `slack`.
 */
export function callbackUri(origin: string, provider: string): string {
  return `${origin}/api/connect/${provider}/callback`;
}

/**
 * Where the person lands when the connect is over. Carries only a short code,
 * never anything the vendor sent verbatim.
 * @param origin - The configured public origin; `''` gives a relative URL.
 * @param outcome - `ok`, or the short refusal code.
 * @param sourceSlug - The source the person was connecting, when known.
 */
export function returnUrl(
  origin: string,
  outcome: { ok: true } | { ok: false; reason: string },
  sourceSlug?: string,
): string {
  const url = new URL(`${origin || 'http://relative.invalid'}/dashboard/sources`);
  url.searchParams.set('connect', outcome.ok ? 'ok' : 'error');
  if (!outcome.ok) {
    url.searchParams.set('reason', outcome.reason.replace(/[^\w.-]/g, '_').slice(0, 64));
  }
  if (sourceSlug) {
    url.searchParams.set('source', sourceSlug);
  }
  return origin ? url.toString() : `${url.pathname}${url.search}`;
}
