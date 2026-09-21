/**
 * Workspace-aware links — the Vercel model.
 *
 * `/w/<slug>/…` is the **canonical URL**: it is what the address bar shows,
 * what a copy-paste produces, and what decides which workspace the page is
 * about. The proxy (`src/proxy.ts`) resolves `<slug>` for the signed-in user
 * and *rewrites* to the page under `/dashboard`, forwarding the resolved ids
 * as request headers that `resolveTenancyForUser` (`libs/Auth.ts`) reads
 * before the cookie. The `vocion_active_project` cookie is demoted to "last
 * active": it only decides where a **bare** `/dashboard/…` URL is sent.
 *
 * Why: a URL that means a different thing for each reader — or for the same
 * reader in a second tab — is not a URL. Switch workspace in one tab, refresh
 * a record URL in another, and the id resolved against the newly-active
 * project, which does not have it: 404 (design principle 8 — "where am I"
 * must be obvious; principle 10 — a claim you can reach).
 *
 * This module is the ONE place the shape is written down. `workspaceUrl`
 * builds a canonical link; `parseWorkspacePath` reads one; `RESERVED_SEGMENTS`
 * says which first segments a workspace slug may never take. Keep it free of
 * server imports — the switcher and the client `Link` wrapper import it.
 */

import { SURFACE_PATH_SEGMENTS } from '@/features/navigation/surfaces';
import { routing } from '@/libs/I18nRouting';

/** Top-level segments a `/w/<slug>/…` path may name directly. Anything else is taken as a page under `/dashboard`. */
export const WORKSPACE_ROOT_SEGMENTS: readonly string[] = ['dashboard', ...SURFACE_PATH_SEGMENTS];

/** The segment the workspace entry route lives under. Reserved: no project slug may be `w`. */
export const WORKSPACE_ENTRY_SEGMENT = 'w';

/**
 * Request headers the proxy sets after resolving `/w/<slug>/…`.
 *
 * `resolveTenancyForUser` (`libs/Auth.ts`) reads `projectId` before the
 * cookie, which is what makes the URL — not the browser's last switch —
 * decide the workspace. The value is re-validated there against the caller's
 * own account membership, so a forged header buys nothing: the worst it can
 * name is a workspace the caller may already switch to with a cookie they
 * control. `slug` is read by the layout, to prefix the links it renders.
 */
export const WORKSPACE_HEADER = {
  projectId: 'x-vocion-project-id',
  slug: 'x-vocion-workspace-slug',
} as const;

/**
 * First path segments a workspace slug may never take, so a slug can never
 * shadow a real route (`/w/api/…` must not be resolvable as a workspace, and
 * a project called `dashboard` must never exist).
 *
 * One list, used by the resolver ({@link parseWorkspacePath}) and the
 * validator ({@link projectSlugProblem}). Surface segments come from the
 * registry and locales from the routing config, so registering a surface or
 * adding a locale cannot silently make an existing slug ambiguous.
 */
export const RESERVED_SEGMENTS: readonly string[] = [
  // API + transport surfaces
  'api',
  'rpc',
  'webhook',
  'webhooks',
  'share',
  'monitoring',
  // auth + onboarding
  'sign-in',
  'sign-up',
  'setup',
  'invite',
  'onboarding',
  // app surfaces
  WORKSPACE_ENTRY_SEGMENT,
  'dashboard',
  'api-docs',
  'docs',
  // framework + static
  '_next',
  '_vercel',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  ...SURFACE_PATH_SEGMENTS,
  ...routing.locales,
];

const RESERVED = new Set(RESERVED_SEGMENTS);

/**
 * Whether a path segment is reserved by the app and therefore unavailable as
 * a workspace slug. Case-insensitive: slugs resolve case-insensitively too.
 * @param segment - A single, already-decoded path segment.
 */
export function isReservedSegment(segment: string): boolean {
  return RESERVED.has(segment.trim().toLowerCase());
}

/** `[a-z0-9-]{2,40}`, no leading/trailing hyphen — the shape a slug may take before the reserved check. */
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/**
 * Why a project slug cannot be used in a URL, or null when it can.
 *
 * The message is written for whoever typed the slug, so it names the rule it
 * broke rather than restating the regex.
 * @param slug - Candidate `project.slug`.
 */
export function projectSlugProblem(slug: string): string | null {
  const s = slug.trim();
  if (s !== slug.trim().toLowerCase()) {
    return 'must be lowercase';
  }
  if (!SLUG_SHAPE.test(s)) {
    return 'must be 2–40 characters of a–z, 0–9 or "-", starting and ending with a letter or number';
  }
  if (isReservedSegment(s)) {
    return `is reserved by the app — "${s}" already names a route, a surface or a locale`;
  }
  return null;
}

/**
 * Base URL for absolute links: `NEXT_PUBLIC_APP_URL`, trailing slash trimmed;
 * empty when unset (a relative link is better than `undefined/dashboard`).
 *
 * Read from `process.env`, not `Env`, so the Temporal worker and scripts
 * (which do not always load the validated env) still produce a link.
 */
export function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? '';
  return raw.replace(/\/+$/, '');
}

/**
 * `/dashboard/inbox?x=1` → `dashboard/inbox?x=1`; `` → `dashboard`.
 * Strips leading slashes and collapses doubles so a caller's `/dashboard//inbox`
 * cannot produce a protocol-relative `//host` path.
 * @param path - App-relative path, with or without a leading slash.
 */
function normalisePath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  return trimmed === '' ? 'dashboard' : trimmed;
}

/**
 * The canonical link to a dashboard page in one workspace.
 *
 * `workspaceUrl('vocion-workforce', '/dashboard/inbox')` →
 * `/w/vocion-workforce/dashboard/inbox`; with `absolute: true` the
 * `NEXT_PUBLIC_APP_URL` origin is prefixed. Query strings and fragments on
 * `path` are kept. The slug is lower-cased: the resolver matches it
 * case-insensitively, so one spelling in every link.
 *
 * Idempotent — handing it a path that is already canonical returns it
 * unchanged for the same slug and re-points it for a different one, so the
 * `Link` wrapper can prefix blindly.
 * @param projectSlug - `project.slug` of the workspace the link is about.
 * @param path - App-relative path, e.g. `/dashboard/inbox` or `/dashboard/inbox/42`.
 * @param opts - `absolute`: prefix `NEXT_PUBLIC_APP_URL`.
 * @param opts.absolute - Prefix the public origin.
 */
export function workspaceUrl(projectSlug: string, path: string, opts: { absolute?: boolean } = {}): string {
  const slug = encodeURIComponent(projectSlug.trim().toLowerCase());
  const rel = `/${WORKSPACE_ENTRY_SEGMENT}/${slug}/${normalisePath(stripWorkspacePrefix(path))}`;
  return opts.absolute ? `${appBaseUrl()}${rel}` : rel;
}

/** What {@link parseWorkspacePath} returns for a canonical URL. */
export type WorkspacePath = {
  /** The `[locale]` prefix that was present, `''` when the path had none. */
  locale: string;
  /** The workspace slug, lower-cased and decoded. */
  slug: string;
  /**
   * The app path the canonical URL stands for, leading slash, no locale and
   * no `/w/<slug>`: what the proxy rewrites to and what the route tree holds.
   */
  appPath: string;
};

/**
 * Read a canonical `/{locale}?/w/<slug>/<path…>` pathname.
 *
 * Returns null for anything that is not canonical — a bare `/dashboard/…`, a
 * `/w` with no slug, or a `/w/<reserved>/…` — so the caller can fall through
 * to its normal handling rather than guessing.
 *
 * - `/w/northwind` → `{ locale: '', slug: 'northwind', appPath: '/dashboard' }`
 * - `/w/northwind/dashboard/inbox` → `appPath: '/dashboard/inbox'`
 * - `/w/northwind/inbox` → `appPath: '/dashboard/inbox'` (a bare page name is a dashboard page)
 * - `/w/northwind/gtm/discovery` → `appPath: '/gtm/discovery'` (a registered surface stands on its own)
 * - `/fr/w/northwind/inbox` → `{ locale: 'fr', … }`
 * A query string or fragment on `pathname` is ignored, so `usePathname()`
 * output and a full `href` both parse.
 * @param pathname - `request.nextUrl.pathname` or `usePathname()`, not URL-decoded beyond what the platform did.
 */
export function parseWorkspacePath(pathname: string): WorkspacePath | null {
  const [pathOnly] = splitQuery(pathname);
  const raw = pathOnly.split('/').filter(s => s !== '');
  const locale = raw[0] !== undefined && (routing.locales as readonly string[]).includes(raw[0]) ? raw[0] : '';
  const rest = locale ? raw.slice(1) : raw;
  if (rest[0] !== WORKSPACE_ENTRY_SEGMENT) {
    return null;
  }
  const slugRaw = rest[1];
  if (slugRaw === undefined || slugRaw === '') {
    return null;
  }
  const slug = safeDecode(slugRaw).trim().toLowerCase();
  if (slug === '' || isReservedSegment(slug)) {
    return null;
  }
  return { locale, slug, appPath: workspaceAppPath(rest.slice(2).map(safeDecode)) };
}

/**
 * The app path `/w/<slug>/<segments…>` stands for.
 *
 * - no segments → `/dashboard`
 * - `dashboard/inbox` → `/dashboard/inbox`
 * - `inbox` → `/dashboard/inbox` (a bare page name is a dashboard page)
 * - `gtm/discovery` → `/gtm/discovery` (a registered surface segment stands on its own)
 *
 * Segments are re-encoded individually, so nothing a caller puts in the path
 * can escape the app's own origin.
 * @param segments - The path after the slug, already decoded.
 */
export function workspaceAppPath(segments: readonly string[]): string {
  const clean = segments.filter(s => s !== '');
  const first = clean[0];
  const rooted = first !== undefined && WORKSPACE_ROOT_SEGMENTS.includes(first) ? clean : ['dashboard', ...clean];
  return `/${rooted.map(s => encodeURIComponent(s)).join('/')}`;
}

/**
 * Whether an app path belongs to a workspace, and so should carry one in the
 * URL: a `/dashboard/…` page or a registered surface (`/gtm/…`).
 *
 * The rest of the app is account-wide or has no workspace yet — `/rpc` is the
 * oRPC transport, `/onboarding` runs before a workspace exists, `/api-docs`
 * documents the account. One rule, read by the proxy (which redirects a bare
 * path to its canonical spelling) and by the `Link` wrapper (which prefixes
 * the hrefs it renders), so the two cannot disagree about which URLs carry a
 * workspace.
 * @param path - An app path, optionally locale-prefixed; query and fragment ignored.
 */
export function isWorkspacePath(path: string): boolean {
  const [pathOnly] = splitQuery(path);
  const segments = pathOnly.split('/').filter(s => s !== '');
  const first = (routing.locales as readonly string[]).includes(segments[0] ?? '') ? segments[1] : segments[0];
  return first !== undefined && WORKSPACE_ROOT_SEGMENTS.includes(first);
}

/**
 * The canonical spelling of an in-app href, or the href untouched.
 *
 * What every `Link` and `router.push` goes through (`libs/I18nNavigation.ts`),
 * so a click keeps the workspace in the address bar rather than bouncing off
 * the proxy's redirect.
 *
 * Left alone: anything that is not a rooted app path (external, `mailto:`, a
 * bare `#anchor`, a relative path, a protocol-relative `//host`), anything
 * already canonical, a locale-prefixed path (next-intl adds the locale
 * itself, after this), and any page that does not belong to a workspace
 * ({@link isWorkspacePath}). With no workspace in scope the href is returned
 * as written — a bare link still works, the proxy canonicalises it on arrival.
 * @param href - The href as the call site wrote it.
 * @param slug - The active workspace slug, or null when the page has none.
 */
export function canonicalise(href: string, slug: string | null): string {
  if (!slug || !href.startsWith('/') || href.startsWith('//')) {
    return href;
  }
  const first = href.split('/').filter(s => s !== '')[0];
  if (first !== undefined && (routing.locales as readonly string[]).includes(first)) {
    return href;
  }
  if (parseWorkspacePath(href) || !isWorkspacePath(href)) {
    return href;
  }
  return workspaceUrl(slug, href);
}

/**
 * Drop a leading `/{locale}?/w/<slug>` from a path, leaving the app path.
 *
 * The inverse of {@link workspaceUrl} for the part that matters: every
 * pathname consumer in the app (active-nav matching, the breadcrumb, the
 * switcher's "same page") wants the app path, not the canonical one, and
 * gets it from `usePathname()` in `libs/I18nNavigation.ts`, which calls this.
 * Paths that are not canonical come back unchanged.
 * @param pathname - Any app pathname.
 */
export function stripWorkspacePrefix(pathname: string): string {
  const parsed = parseWorkspacePath(pathname);
  if (!parsed) {
    return pathname;
  }
  const [, query = ''] = splitQuery(pathname);
  return `${parsed.appPath}${query}`;
}

/**
 * `/a/b?x=1#y` → `['/a/b', '?x=1#y']`.
 * @param path - Any path, with or without a query or fragment.
 */
function splitQuery(path: string): [string, string] {
  const at = path.search(/[?#]/);
  return at === -1 ? [path, ''] : [path.slice(0, at), path.slice(at)];
}

/**
 * `decodeURIComponent` that returns the input rather than throwing on `%`.
 * @param segment - One path segment, possibly percent-encoded.
 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Where `/w/<slug>/<segments…>` lands once the workspace is active.
 *
 * Kept for the entry route's legacy shape and for tests; the proxy rewrites
 * rather than redirects now, so the app path is what it needs.
 * @param opts - The request's route params and query.
 * @param opts.segments - The `[[...path]]` catch-all, already decoded by Next.
 * @param opts.search - `request.nextUrl.search`, `?`-prefixed or empty.
 * @param opts.locale - The `[locale]` param.
 */
export function workspaceRedirectPath(opts: { segments?: string[]; search?: string; locale?: string }): string {
  const path = workspaceAppPath(opts.segments ?? []);
  const localePrefix = opts.locale && opts.locale !== routing.defaultLocale && (routing.locales as readonly string[]).includes(opts.locale)
    ? `/${opts.locale}`
    : '';
  const search = opts.search && opts.search !== '?' ? (opts.search.startsWith('?') ? opts.search : `?${opts.search}`) : '';
  return `${localePrefix}${path}${search}`;
}
