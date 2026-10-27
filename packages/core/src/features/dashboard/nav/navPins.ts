import type { LucideIcon } from 'lucide-react';

/**
 * Pure pin model for the sidebar: which items are pinned, in what order, and
 * what a toggle does. Kept away from React so ordering is unit-testable.
 */

export type PinnableItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Where the item came from — decides which group it sits in when unpinned. */
  origin: 'work' | 'page' | 'manage';
  /** `false` for a row that is the surface itself (Chat, Review): no pin affordance. */
  pinnable?: false;
  badge?: number;
  /**
   * The tabs of a combined page (Teams & agents → Agents). Shown as sub-rows
   * beneath the item while that page is open; each is pinnable on its own.
   */
  tabs?: PinnableItem[];
};

/**
 * Pinned items in pin order; pins whose item no longer exists are dropped.
 * @param items
 * @param pins
 */
export function applyPins<T extends { url: string }>(items: T[], pins: string[]): T[] {
  const byUrl = new Map(items.map(i => [i.url, i]));
  const out: T[] = [];
  for (const url of pins) {
    const item = byUrl.get(url);
    if (item && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Everything not pinned, original order preserved.
 * @param items
 * @param pins
 */
export function withoutPins<T extends { url: string }>(items: T[], pins: string[]): T[] {
  const set = new Set(pins);
  return items.filter(i => !set.has(i.url));
}

/**
 * One gesture: pinned → unpinned; unpinned → appended (pin order = pin time).
 * @param pins
 * @param url
 */
export function togglePin(pins: string[], url: string): string[] {
  return pins.includes(url) ? pins.filter(p => p !== url) : [...pins, url];
}

/** Where a dragged pin lands relative to the row it was dropped on. */
export type PinPlace = 'before' | 'after';

/**
 * Move a pin next to another one: the reorder a drop or a keystroke makes.
 *
 * It names the TARGET PIN, never an index, because a group shows only some of
 * the person's pins — the Pinned group holds pages and Manage rows, the main
 * list holds the work rows, and a pin whose page is gone is kept but drawn
 * nowhere. An index taken from what one group shows, applied to the whole
 * list, lands one or more places off whenever a pin it does not show sits
 * before it (a drag down by one did nothing at all). Moving next to a named
 * pin is right whatever else the list holds. No-op when either is unknown, or
 * when they are the same pin.
 * @param pins - The whole pin order.
 * @param url - The pin being moved.
 * @param target - The pin it was dropped on.
 * @param place - Before or after the target.
 */
export function movePinNear(pins: readonly string[], url: string, target: string, place: PinPlace): string[] {
  if (url === target || !pins.includes(url) || !pins.includes(target)) {
    return [...pins];
  }
  const next = pins.filter(p => p !== url);
  const at = next.indexOf(target) + (place === 'after' ? 1 : 0);
  next.splice(at, 0, url);
  return next;
}

/**
 * The move one step up or down a group makes (Alt+↑/↓, or Move up / Move down
 * on a phone's long-press menu): next to the neighbour the person can SEE, so
 * a pin the group does not show is never the thing it steps over. Null at
 * either end.
 * @param shown - The group's reorderable rows, in the order they are drawn.
 * @param url - The pin being moved.
 * @param delta - -1 up, +1 down.
 */
export function pinStep(shown: readonly string[], url: string, delta: -1 | 1): { target: string; place: PinPlace } | null {
  const i = shown.indexOf(url);
  const target = i === -1 ? undefined : shown[i + delta];
  return target === undefined ? null : { target, place: delta < 0 ? 'before' : 'after' };
}

/**
 * Which half of a row the pointer is over: the drop line goes there.
 * @param pointerY - The pointer's clientY.
 * @param rect - The row's box.
 * @param rect.top - Its top.
 * @param rect.height - Its height.
 */
export function dropPlace(pointerY: number, rect: { top: number; height: number }): PinPlace {
  return pointerY < rect.top + rect.height / 2 ? 'before' : 'after';
}

/**
 * Split a list into the first `max` and the overflow for a "More …" submenu.
 * @param items
 * @param max
 */
export function splitOverflow<T>(items: T[], max: number): { shown: T[]; more: T[] } {
  return items.length <= max ? { shown: items, more: [] } : { shown: items.slice(0, max), more: items.slice(max) };
}

/**
 * The dismissal id recorded when a person unpins a row that started pinned.
 * @param url
 */
export function defaultPinDismissal(url: string): string {
  return `nav:default-pin:${url}`;
}

/**
 * Which WORK rows are pinned right now: the defaults (Briefings) until a
 * person unpins them, then whatever they pinned themselves, in pin order.
 * A default they never touched sits first; one they unpinned is recorded as
 * a dismissal so it does not come back on the next load.
 * @param input
 * @param input.pins - The person's pins, in pin order.
 * @param input.dismissed - Their dismissed prompts (`defaultPinDismissal(url)` among them).
 * @param input.defaults - The rows that start pinned.
 */
export function resolveWorkPins(input: { pins: readonly string[]; dismissed: readonly string[]; defaults: readonly string[] }): string[] {
  const out: string[] = [];
  for (const url of input.defaults) {
    if (!input.dismissed.includes(defaultPinDismissal(url)) && !input.pins.includes(url)) {
      out.push(url);
    }
  }
  for (const url of input.pins) {
    if (!out.includes(url)) {
      out.push(url);
    }
  }
  return out;
}
