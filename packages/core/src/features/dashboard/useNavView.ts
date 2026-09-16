/**
 * The sidebar's WORK / MANAGE view, persisted per browser. Kept as plain
 * functions over a Storage-like object so the persistence contract is
 * unit-testable without a DOM.
 *
 * The manage view is a sidebar MODE, not a route, so anything outside the
 * sidebar that wants to open it (the header's avatar menu) asks for it with
 * an event rather than navigating — the same shape `WorkspaceSwitcher` uses
 * to be opened from the header.
 */

export const NAV_VIEW_KEY = 'vocion:nav:view';
export type NavView = 'work' | 'manage';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function readNavView(storage: StorageLike | null | undefined): NavView {
  try {
    return storage?.getItem(NAV_VIEW_KEY) === 'manage' ? 'manage' : 'work';
  } catch {
    return 'work';
  }
}

export function writeNavView(storage: StorageLike | null | undefined, view: NavView): void {
  try {
    storage?.setItem(NAV_VIEW_KEY, view);
  } catch {
    // private mode / quota — the view still switches for this page load
  }
}

/** Event asking the sidebar to show its MANAGE view. */
export const OPEN_MANAGE_VIEW = 'vocion:open-manage-view';

/**
 * Ask the sidebar to open the manage view (used by the header avatar menu's
 * "Workspace settings"). Also writes the choice, so a reload stays there.
 */
export function openManageView(): void {
  if (typeof window === 'undefined') {
    return;
  }
  writeNavView(globalThis.localStorage, 'manage');
  window.dispatchEvent(new Event(OPEN_MANAGE_VIEW));
}
