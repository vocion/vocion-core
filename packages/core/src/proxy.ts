import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import { auth } from './libs/Auth';
import { routing } from './libs/I18nRouting';

const handleI18nRouting = createMiddleware(routing);

const PROTECTED_PATH = /^\/(?:[^/]+\/)?(?:dashboard|onboarding|rpc)(?:$|\/|\?)/;
const AUTH_PATH = /^\/(?:[^/]+\/)?(?:sign-in|sign-up|setup|invite)(?:$|\/|\?)/;

export default async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/auth/* is owned by auth.js — let it handle its own routing
  if (path.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Protected routes: must have an auth.js session, else redirect to sign-in
  if (PROTECTED_PATH.test(path)) {
    const session = await auth();
    if (!session?.user?.id) {
      const locale = path.match(/^\/([^/]+)\//)?.[1] ?? '';
      const signInUrl = new URL(`/${locale ? `${locale}/` : ''}sign-in`, request.url);
      signInUrl.searchParams.set('callbackUrl', request.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  // Sign-in / sign-up pages: if already signed in, redirect to dashboard
  if (AUTH_PATH.test(path) && !path.includes('/setup') && !path.includes('/invite')) {
    const session = await auth();
    if (session?.user?.id) {
      const locale = path.match(/^\/([^/]+)\//)?.[1] ?? '';
      return NextResponse.redirect(new URL(`/${locale ? `${locale}/` : ''}dashboard`, request.url));
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
