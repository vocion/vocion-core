import type { NextFetchEvent, NextRequest } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import { routing } from './libs/I18nRouting';

const handleI18nRouting = createMiddleware(routing);

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/:locale/dashboard(.*)',
  '/onboarding(.*)',
  '/:locale/onboarding(.*)',
  '/rpc(.*)',
  '/:locale/rpc(.*)',
]);

// /api/v1 runs Clerk middleware to populate the auth context, but the
// route handler decides how to respond (returns 401 JSON instead of 307
// redirect to the sign-in page). So it's NOT on the protected-route
// matcher — we don't want auth.protect() to kick in.
const isApiRoute = createRouteMatcher(['/api/v1(.*)']);

const isAuthPage = createRouteMatcher([
  '/sign-in(.*)',
  '/:locale/sign-in(.*)',
  '/sign-up(.*)',
  '/:locale/sign-up(.*)',
]);

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  // API routes: populate Clerk context so the route handler can call
  // auth(), but don't run i18n or auth.protect() — return JSON errors
  // from the handler instead.
  if (isApiRoute(request)) {
    return clerkMiddleware(async () => NextResponse.next())(request, event);
  }

  // Clerk keyless mode doesn't work with i18n, this is why we need to run the middleware conditionally
  if (
    isAuthPage(request) || isProtectedRoute(request)
  ) {
    return clerkMiddleware(async (auth, req) => {
      // Check if the current route is protected and requires authentication
      // If user is not authenticated, redirect them to the sign-in page with proper locale
      if (isProtectedRoute(req)) {
        const locale = req.nextUrl.pathname.match(/(\/.*)\/dashboard/)?.at(1) ?? '';

        const signInUrl = new URL(`${locale}/sign-in`, req.url);

        await auth.protect({
          unauthenticatedUrl: signInUrl.toString(),
        });
      }

      const authObj = await auth();

      // Redirect authenticated users without an organization to the organization selection page
      // This ensures users are properly associated with an organization before accessing the dashboard
      if (
        authObj.userId
        && !authObj.orgId
        && req.nextUrl.pathname.includes('/dashboard')
        && !req.nextUrl.pathname.endsWith('/organization-selection')
      ) {
        const orgSelection = new URL(
          '/onboarding/organization-selection',
          req.url,
        );

        return NextResponse.redirect(orgSelection);
      }

      return handleI18nRouting(req);
    })(request, event);
  }

  return handleI18nRouting(request);
}

export const config = {
  // Match all pathnames except for
  // - … if they start with `/_next`, `/_vercel`, `monitoring`, or `/api` (REST API routes handle their own auth)
  // - … the ones containing a dot (e.g. `favicon.ico`)
  // - … App Router metadata files (`icon`, `apple-icon`, `opengraph-image`,
  //   `twitter-image`, `manifest`, `robots`, `sitemap`). Without this, the
  //   i18n proxy 307-redirects them to `/en/icon` etc. and they 404.
  matcher: [
    '/((?!_next|_vercel|monitoring|api|icon|apple-icon|opengraph-image|twitter-image|manifest|robots|sitemap|.*\\..*).*)',
    '/api/v1/:path*', // run Clerk middleware on /api/v1 for auth
  ],
};
