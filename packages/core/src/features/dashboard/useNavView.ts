/**
 * The sidebar's WORK / MANAGE view, persisted per browser. Kept as plain
 * functions over a Storage-like object so the persistence contract is
 * unit-testable without a DOM.
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
