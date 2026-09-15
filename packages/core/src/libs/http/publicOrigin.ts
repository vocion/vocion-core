import type { NextRequest } from 'next/server';

/**
 * The PUBLIC origin to redirect a browser to.
 *
 * Behind a reverse proxy (Caddy) the server binds 0.0.0.0:3000, so
 * `request.url` / `request.nextUrl.origin` carry that internal address — a
 * redirect built from it sends the browser to `http://0.0.0.0:3000/...`,
 * which is unreachable and blanks the app. Prefer an explicitly configured
 * public URL, then the proxy's forwarded headers, and only fall back to the
 * request origin for local/dev where they already match. Shared by the auth
 * proxy and the `/w/[workspace]` entry route so both redirect the same way.
 * @param request - The incoming request.
 */
export function publicOrigin(request: Pick<NextRequest, 'headers' | 'nextUrl'>): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // ignore a malformed env value and fall through to headers
    }
  }
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}
