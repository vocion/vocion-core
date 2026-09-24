/**
 * The one place the "active project" cookie is described.
 *
 * Tenancy is session state: `auth()` resolves the caller's project from the
 * `vocion_active_project` cookie on every read (`libs/Auth.ts`). Two things
 * write that cookie — the workspace switcher in the sidebar and the
 * `/w/[workspace]` entry route — and they must agree on the name, the path
 * and the lifetime, or a switch made one way is undone the other way. Keep
 * this module free of server imports: the switcher is a client component.
 */

export const ACTIVE_PROJECT_COOKIE = 'vocion_active_project';

/** One year, in seconds — the switch should outlive the session. */
export const ACTIVE_PROJECT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Attributes for `cookies().set()` / `response.cookies.set()` on the server.
 *
 * `httpOnly` because this cookie SELECTS A TENANT: `resolveTenancyForUser`
 * reads it as a candidate for the active project, so script that can write it
 * can move the session between workspaces. Only the server writes it (the
 * `/w/[workspace]` route); the switcher navigates through that route rather
 * than setting the cookie itself, so nothing client-side reads or writes it.
 */
export const ACTIVE_PROJECT_COOKIE_OPTIONS = {
  path: '/',
  maxAge: ACTIVE_PROJECT_COOKIE_MAX_AGE,
  sameSite: 'lax',
  httpOnly: true,
} as const;
