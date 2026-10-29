/**
 * Where a person was in each workspace — the app and the page — kept per
 * browser and keyed by the workspace's slug, so a switch back opens where
 * they left it, and a shared page (Chat, Review, a record) stays in the app
 * they were last in THERE.
 *
 * Founder, 2026-10-23: "I constantly find myself on the wrong app inside of
 * the Finance team." One memory per browser (the old `vocion:nav:app`) meant
 * the app of the last workspace bled into the next one. A switch still never
 * carries the CURRENT page across (`workspaceLanding`, the 2026-10-09 rule):
 * what it restores is the target's own last page.
 *
 * Plain functions over a Storage-like object, so the contract is tested
 * without a DOM. Every read and write survives a storage that throws
 * (private mode, quota): the nav then works for the page load, unremembered.
 */

export const NAV_WHERE_KEY = 'vocion:nav:where';

/** The person's last place in one workspace. */
export type WorkspacePlace = { app: string; path: string; at: number };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** How many workspaces are remembered; the oldest falls off. */
export const MAX_REMEMBERED = 50;

function isPlace(v: unknown): v is WorkspacePlace {
  const p = v as Partial<WorkspacePlace> | null;
  return typeof p?.app === 'string' && p.app !== '' && typeof p.path === 'string' && p.path.startsWith('/') && typeof p.at === 'number';
}

/**
 * Every remembered place, by workspace slug. Anything unreadable reads as nothing.
 * @param storage - `localStorage`, or a stand-in.
 */
export function readPlaces(storage: StorageLike | null | undefined): Record<string, WorkspacePlace> {
  try {
    const raw = storage?.getItem(NAV_WHERE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isPlace(v))) as Record<string, WorkspacePlace>;
  } catch {
    return {};
  }
}

/**
 * The person's last place in one workspace, or null.
 * @param storage - `localStorage`, or a stand-in.
 * @param slug - The workspace's slug.
 */
export function placeIn(storage: StorageLike | null | undefined, slug: string | null | undefined): WorkspacePlace | null {
  return slug ? readPlaces(storage)[slug] ?? null : null;
}

/**
 * Remember where the person is in a workspace. Keeps the newest
 * {@link MAX_REMEMBERED} workspaces.
 * @param storage - `localStorage`, or a stand-in.
 * @param slug - The workspace's slug.
 * @param place - The app and the page (an app path, `/dashboard/…`).
 * @param place.app - The app the nav shows.
 * @param place.path - The page.
 * @param now - The clock.
 */
export function rememberPlace(storage: StorageLike | null | undefined, slug: string, place: { app: string; path: string }, now: number = Date.now()): void {
  try {
    const places = readPlaces(storage);
    const current = places[slug];
    if (current && current.app === place.app && current.path === place.path) {
      return;
    }
    places[slug] = { app: place.app, path: place.path, at: now };
    const kept = Object.entries(places).sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_REMEMBERED);
    storage?.setItem(NAV_WHERE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // private mode / quota — the nav still works for this page load
  }
}

/**
 * Said in this tab whenever the remembered app changes: `storage` events
 * fire only in OTHER tabs, so a reader in this one (an app's Chat page,
 * `chat/useAppFront.ts`) listens for this as well.
 */
export const NAV_PLACE_EVENT = 'vocion:nav-place';

/**
 * The app the person is in, per workspace, for the server: the Chat page is
 * shared by every app and reads it to load only that app's front
 * (`services/chat/appFront.ts`). `<slug>:<app>`, one workspace at a time.
 */
export const NAV_APP_COOKIE = 'vocion_nav_app';

/**
 * The cookie's value for one workspace's app.
 * @param slug - The workspace's slug.
 * @param app - The app the nav shows.
 */
export function navAppCookieValue(slug: string, app: string): string {
  return `${encodeURIComponent(slug)}:${encodeURIComponent(app)}`;
}

/**
 * The app the cookie names for this workspace, or null when it names another
 * workspace, or nothing readable.
 * @param value - The cookie's value.
 * @param slug - This workspace's slug.
 */
export function appFromNavCookie(value: string | null | undefined, slug: string | null | undefined): string | null {
  if (!value || !slug) {
    return null;
  }
  const at = value.lastIndexOf(':');
  if (at <= 0) {
    return null;
  }
  try {
    return decodeURIComponent(value.slice(0, at)) === slug ? decodeURIComponent(value.slice(at + 1)) || null : null;
  } catch {
    return null;
  }
}

/**
 * Tell this tab and the server which app the person is in here: the cookie
 * for the next render, the event for a reader already on the page. Called
 * after `rememberPlace`. Survives a document without cookies.
 * @param slug - The workspace's slug.
 * @param app - The app the nav shows.
 */
export function announcePlace(slug: string, app: string): void {
  try {
    document.cookie = `${NAV_APP_COOKIE}=${navAppCookieValue(slug, app)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // no document (a test) or cookies blocked: the page still reads storage
  }
  globalThis.dispatchEvent?.(new Event(NAV_PLACE_EVENT));
}
