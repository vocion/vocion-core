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
