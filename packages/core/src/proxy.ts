import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import { SURFACE_PATH_SEGMENTS } from './features/navigation/surfaces';
import { ACTIVE_PROJECT_COOKIE, ACTIVE_PROJECT_COOKIE_OPTIONS } from './libs/activeProject';
import { publicOrigin } from './libs/http/publicOrigin';
import { routing } from './libs/I18nRouting';
import { parseWorkspacePath, WORKSPACE_ENTRY_SEGMENT, WORKSPACE_HEADER, workspaceUrl } from './libs/links';

const handleI18nRouting = createMiddleware(routing);

// Optional-surface segments (`gtm`, …) come from the registry rather than
// being typed out here, so registering a surface under a new segment protects
// it instead of shipping it readable until someone updates this regex.
// `w` is the canonical workspace segment (`/w/<slug>/…`, libs/links.ts): it
// must be protected so an unsigned reader of a mailed link gets sign-in with a
// `callbackUrl` that round-trips the `/w/…` URL, and lands in the right
// workspace after signing in.
const PROTECTED_SEGMENTS = ['dashboard', 'onboarding', 'rpc', 'api-docs', WORKSPACE_ENTRY_SEGMENT, ...SURFACE_PATH_SEGMENTS];
const PROTECTED_PATH = new RegExp(`^/(?:[^/]+/)?(?:${PROTECTED_SEGMENTS.join('|')})(?:$|/|\\?)`);
const AUTH_PATH = /^\/(?:[^/]+\/)?(?:sign-in|sign-up|setup|invite)(?:$|\/|\?)/;

// The segments a bare URL is rewritten INTO a canonical one for. `/rpc` is the
// oRPC transport and `/onboarding` runs before a workspace exists, so both are
// protected but never redirected; `api-docs` is account-wide, not per
// workspace. Everything a person reads or acts on lives under one of these.
const CANONICALISED_SEGMENTS = ['dashboard', ...SURFACE_PATH_SEGMENTS];
const CANONICALISED_PATH = new RegExp(`^/(?:[^/]+/)?(?:${CANONICALISED_SEGMENTS.join('|')})(?:$|/|\\?)`);

// Extract the locale prefix from a path — but ONLY if the first segment is an
// actual configured locale. With `as-needed` prefixing, unprefixed paths like
// `/dashboard/teams` have no locale; the naive regex would capture `dashboard`
// and build `/dashboard/sign-in`, which loops. Returns '' when there's no locale.
/**
 * Who is asking, for the middleware.
 *
 * Normal deployments call auth() (dynamically imported so the DB client —
 * and, in the demo sandbox, PGlite's wasm bundle — never loads at middleware
 * module init). The demo sandbox (VOCION_DEMO_SEED_DIR set) gates on cookie
 * presence only: PGlite cannot run in the middleware bundle, and every
 * protected page re-checks the session in the Node runtime anyway — so it
 * reports "signed in, user unknown", and workspace resolution is skipped.
 * @param request - incoming request (cookies read in demo mode)
 */
async function sessionUser(request: NextRequest): Promise<{ signedIn: boolean; userId: string | null }> {
  if (process.env.VOCION_DEMO_SEED_DIR) {
    const present = Boolean(
      request.cookies.get('__Secure-authjs.session-token')
      ?? request.cookies.get('authjs.session-token'),
    );
    return { signedIn: present, userId: null };
  }
  const { auth } = await import('./libs/Auth');
  const session = await auth();
  return { signedIn: Boolean(session?.user?.id), userId: session?.user?.id ?? null };
}

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
  const protectedPath = PROTECTED_PATH.test(path);

  // One session read for the whole request: the protection gate, the
  // already-signed-in bounce and the workspace resolution all need it.
  const user = protectedPath || AUTH_PATH.test(path) ? await sessionUser(request) : { signedIn: false, userId: null };

  // Protected routes: must have an auth.js session, else redirect to sign-in
  if (protectedPath && !user.signedIn) {
    const locale = localeOf(path);
    const signInUrl = new URL(`/${locale ? `${locale}/` : ''}sign-in`, origin);
    // callbackUrl points back at the requested page on the PUBLIC origin.
    signInUrl.searchParams.set('callbackUrl', new URL(request.nextUrl.pathname + request.nextUrl.search, origin).toString());
    return NextResponse.redirect(signInUrl);
  }

  // Sign-in / sign-up pages: if already signed in, redirect to dashboard
  if (AUTH_PATH.test(path) && !path.includes('/setup') && !path.includes('/invite')) {
    if (user.signedIn) {
      const locale = localeOf(path);
      return NextResponse.redirect(new URL(`/${locale ? `${locale}/` : ''}dashboard`, origin));
    }
  }

  if (user.userId) {
    const routed = await routeWorkspace(request, { origin, userId: user.userId });
    if (routed) {
      return routed;
    }
  }

  // Everything else: hand to next-intl for i18n routing
  return handleI18nRouting(request);
}

/**
 * The canonical-URL half of the proxy: resolve `/w/<slug>/…`, or send a bare
 * `/dashboard/…` to its canonical spelling. Null means "not mine".
 *
 * A canonical URL is **rewritten**, not redirected: the address bar keeps
 * `/w/<slug>/…`, so a refresh, a second tab and a copy-pasted link all resolve
 * the same workspace no matter what the browser last switched to. The resolved
 * ids ride along as request headers that `resolveTenancyForUser`
 * (`libs/Auth.ts`) reads before the cookie — that is what makes the URL, not
 * session state, decide the workspace.
 * @param request - The incoming request.
 * @param ctx - Resolution context.
 * @param ctx.origin - The public origin to build URLs against.
 * @param ctx.userId - The signed-in user; workspaces are resolved within their account.
 */
async function routeWorkspace(request: NextRequest, ctx: { origin: string; userId: string }): Promise<NextResponse | null> {
  const path = request.nextUrl.pathname;
  const canonical = parseWorkspacePath(path);
  const { activeWorkspaceForUser, resolveProjectForUser } = await import('./services/ProjectService');

  if (canonical) {
    const project = await resolveProjectForUser(ctx.userId, { slug: canonical.slug });
    // Unknown slug and a slug on someone else's account are the same 404 on
    // purpose: the reader learns nothing about other tenants' workspaces.
    if (!project) {
      return new NextResponse('No such workspace', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    // The route tree is `app/[locale]/…`, so the rewrite carries the locale
    // next-intl would otherwise have added.
    const locale = canonical.locale || routing.defaultLocale;
    const target = new URL(`/${locale}${canonical.appPath}${request.nextUrl.search}`, ctx.origin);
    const headers = new Headers(request.headers);
    headers.set(WORKSPACE_HEADER.projectId, project.id);
    headers.set(WORKSPACE_HEADER.slug, project.slug);
    const response = NextResponse.rewrite(target, { request: { headers } });
    // Keep "last active" in step with the URL, so a bare link opened later in
    // this browser — and the next sign-in — land in the same workspace.
    if (request.cookies.get(ACTIVE_PROJECT_COOKIE)?.value !== project.id) {
      response.cookies.set(ACTIVE_PROJECT_COOKIE, project.id, ACTIVE_PROJECT_COOKIE_OPTIONS);
    }
    return response;
  }

  // A bare `/dashboard/…` — a bookmark, a legacy link, a `useRouter().push`
  // that did not go through the Link wrapper. Send it to its canonical
  // spelling so there is one URL per page per workspace, and so the reader can
  // see and share which workspace they are in.
  if (request.method !== 'GET' || !CANONICALISED_PATH.test(path)) {
    return null;
  }
  const workspace = await activeWorkspaceForUser(ctx.userId, request.cookies.get(ACTIVE_PROJECT_COOKIE)?.value);
  if (!workspace) {
    return null; // No workspace yet (onboarding) — leave the URL alone.
  }
  const locale = localeOf(path);
  const appPath = locale ? path.slice(locale.length + 1) : path;
  const target = new URL(`${locale ? `/${locale}` : ''}${workspaceUrl(workspace.slug, `${appPath}${request.nextUrl.search}`)}`, ctx.origin);
  return NextResponse.redirect(target, 307);
}

export const config = {
  matcher: [
    // Skip Next internals + assets + App Router metadata + API auth handler
    '/((?!_next|_vercel|monitoring|api/auth|icon|apple-icon|opengraph-image|twitter-image|manifest|robots|sitemap|.*\\..*).*)',
  ],
};
