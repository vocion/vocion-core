/**
 * Workspace-aware links — the Vercel model, phase 1.
 *
 * Every dashboard page lives at `/dashboard/...` and the workspace (project)
 * it shows is session state: whatever `vocion_active_project` names. A link
 * mailed or posted to the outside world therefore opened whichever workspace
 * the reader's browser last had active, not the one the mail was about.
 *
 * `/w/<slug>/<path>` fixes that: the entry route
 * (`app/[locale]/(auth)/w/[workspace]/[[...path]]/route.ts`) resolves the
 * slug within the signed-in user's account, makes it the active project the
 * same way the switcher does, and 302s to `/<path>`. Build every outbound
 * link — mail, Slack, ask deep links, API responses — with {@link workspaceUrl}
 * so the workspace travels with the URL. Phase 2 (`docs/routing.md`) makes
 * the workspace a real path segment; the helper is the seam that lets the
 * shape change once, here.
 */

import { SURFACE_PATH_SEGMENTS } from '@/features/navigation/surfaces';
import { routing } from '@/libs/I18nRouting';

/** Top-level segments a `/w/<slug>/…` path may name directly. Anything else is taken as a page under `/dashboard`. */
export const WORKSPACE_ROOT_SEGMENTS: readonly string[] = ['dashboard', ...SURFACE_PATH_SEGMENTS];

/** The segment the workspace entry route lives under. Reserved: no project slug may be `w`. */
export const WORKSPACE_ENTRY_SEGMENT = 'w';

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
 * `path` are kept. The slug is lower-cased: the entry route resolves it
 * case-insensitively, so one spelling in every link.
 * @param projectSlug - `project.slug` of the workspace the link is about.
 * @param path - App-relative path, e.g. `/dashboard/inbox` or `/dashboard/inbox/42`.
 * @param opts - `absolute`: prefix `NEXT_PUBLIC_APP_URL`.
 * @param opts.absolute - Prefix the public origin.
 */
export function workspaceUrl(projectSlug: string, path: string, opts: { absolute?: boolean } = {}): string {
  const slug = encodeURIComponent(projectSlug.trim().toLowerCase());
  const rel = `/${WORKSPACE_ENTRY_SEGMENT}/${slug}/${normalisePath(path)}`;
  return opts.absolute ? `${appBaseUrl()}${rel}` : rel;
}

/**
 * Where `/w/<slug>/<segments…>` lands once the workspace is active.
 *
 * - no segments → `/dashboard`
 * - `dashboard/inbox` → `/dashboard/inbox`
 * - `inbox` → `/dashboard/inbox` (a bare page name is a dashboard page)
 * - `gtm/discovery` → `/gtm/discovery` (a registered surface segment stands on its own)
 *
 * The query string is appended unchanged; a non-default locale is prefixed
 * the way `as-needed` routing expects (`/fr/dashboard/inbox`). Segments are
 * URL-encoded individually, so nothing a caller puts in the path can escape
 * the app's own origin.
 * @param opts - The request's route params and query.
 * @param opts.segments - The `[[...path]]` catch-all, already decoded by Next.
 * @param opts.search - `request.nextUrl.search`, `?`-prefixed or empty.
 * @param opts.locale - The `[locale]` param.
 */
export function workspaceRedirectPath(opts: { segments?: string[]; search?: string; locale?: string }): string {
  const segments = (opts.segments ?? []).filter(s => s !== '');
  const first = segments[0];
  const rooted = first !== undefined && WORKSPACE_ROOT_SEGMENTS.includes(first) ? segments : ['dashboard', ...segments];
  const path = `/${rooted.map(s => encodeURIComponent(s)).join('/')}`;
  const localePrefix = opts.locale && opts.locale !== routing.defaultLocale && (routing.locales as readonly string[]).includes(opts.locale)
    ? `/${opts.locale}`
    : '';
  const search = opts.search && opts.search !== '?' ? (opts.search.startsWith('?') ? opts.search : `?${opts.search}`) : '';
  return `${localePrefix}${path}${search}`;
}
