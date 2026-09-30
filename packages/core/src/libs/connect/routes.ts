/**
 * What the start and callback routes share: where the callback is, where the
 * person lands afterwards, and how a refusal is spelled in the URL.
 */

import type { NextRequest } from 'next/server';
import { publicOrigin } from '@/libs/http/publicOrigin';

/**
 * The callback URL a vendor is told to return to, for one provider.
 * @param req
 * @param provider
 */
export function callbackUri(req: Pick<NextRequest, 'headers' | 'nextUrl'>, provider: string): string {
  return `${publicOrigin(req)}/api/connect/${provider}/callback`;
}

/**
 * Where the person lands when the connect is over. Carries only a short code,
 * never anything the vendor sent.
 * @param req - The request, for the origin.
 * @param outcome - `ok`, or the short refusal code.
 * @param sourceSlug - The source the person was connecting, when known.
 */
export function returnUrl(
  req: Pick<NextRequest, 'headers' | 'nextUrl'>,
  outcome: { ok: true } | { ok: false; reason: string },
  sourceSlug?: string,
): string {
  const url = new URL(`${publicOrigin(req)}/dashboard/sources`);
  url.searchParams.set('connect', outcome.ok ? 'ok' : 'error');
  if (!outcome.ok) {
    url.searchParams.set('reason', outcome.reason.replace(/[^\w.-]/g, '_').slice(0, 64));
  }
  if (sourceSlug) {
    url.searchParams.set('source', sourceSlug);
  }
  return url.toString();
}
