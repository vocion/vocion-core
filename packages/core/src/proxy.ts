import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import { auth } from './libs/Auth';
import { routing } from './libs/I18nRouting';

const handleI18nRouting = createMiddleware(routing);

const PROTECTED_PATH = /^\/(?:[^/]+\/)?(?:dashboard|onboarding|rpc)(?:$|\/|\?)/;
const AUTH_PATH = /^\/(?:[^/]+\/)?(?:sign-in|sign-up|setup|invite)(?:$|\/|\?)/;

// Resolve the PUBLIC origin for redirects. Behind a reverse proxy (Caddy) the
// server binds 0.0.0.0:3000, so `request.url` / `request.nextUrl.origin` carry
// that internal address — using it for a redirect sends the browser to
// `http://0.0.0.0:3000/...`, which is unreachable and blanks the app. Prefer an
// explicitly configured public URL, then the proxy's forwarded headers, and
// only fall back to the request origin for local/dev where they already match.
function publicOrigin(request: NextRequest): string {
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

// Extract the locale prefix from a path — but ONLY if the first segment is an
// actual configured locale. With `as-needed` prefixing, unprefixed paths like
// `/dashboard/teams` have no locale; the naive regex would capture `dashboard`
// and build `/dashboard/sign-in`, which loops. Returns '' when there's no locale.
function localeOf(path: string): string {
  const seg = path.match(/^\/([^/]+)(?:\/|$)/)?.[1];
  return seg && (routing.locales as readonly string[]).includes(seg) ? seg : '';
}

export default async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // All /api/* routes own their own routing — no locale prefixes, no
  // redirects. Letting next-intl touch them rewrites `/api/v1/foo` to
  // `/en/api/v1/foo`, which doesn't match the route file at
  // `app/api/v1/foo/route.ts` and 404s. Auth, v1 API, webhooks, signup
  // all live under /api/ and need to be handled by Next's own route
  // matcher unchanged.
  if (path.startsWith('/api/')) {
    return NextResponse.next();
  }

  const origin = publicOrigin(request);

  // Protected routes: must have an auth.js session, else redirect to sign-in
  if (PROTECTED_PATH.test(path)) {
    const session = await auth();
    if (!session?.user?.id) {
      const locale = localeOf(path);
      const signInUrl = new URL(`/${locale ? `${locale}/` : ''}sign-in`, origin);
      // callbackUrl points back at the requested page on the PUBLIC origin.
      signInUrl.searchParams.set('callbackUrl', new URL(request.nextUrl.pathname + request.nextUrl.search, origin).toString());
      return NextResponse.redirect(signInUrl);
    }
  }

  // Sign-in / sign-up pages: if already signed in, redirect to dashboard
  if (AUTH_PATH.test(path) && !path.includes('/setup') && !path.includes('/invite')) {
    const session = await auth();
    if (session?.user?.id) {
      const locale = localeOf(path);
      return NextResponse.redirect(new URL(`/${locale ? `${locale}/` : ''}dashboard`, origin));
    }
  }

  // Everything else: hand to next-intl for i18n routing
  return handleI18nRouting(request);
}

export const config = {
  matcher: [
    // Skip Next internals + assets + App Router metadata + API auth handler
    '/((?!_next|_vercel|monitoring|api/auth|icon|apple-icon|opengraph-image|twitter-image|manifest|robots|sitemap|.*\\..*).*)',
  ],
};
