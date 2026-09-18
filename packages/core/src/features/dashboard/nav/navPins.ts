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

/**
 * Move a pin to a new index (drag-to-reorder); no-op for unknown urls.
 * @param pins
 * @param url
 * @param toIndex
 */
export function movePin(pins: string[], url: string, toIndex: number): string[] {
  const from = pins.indexOf(url);
  if (from === -1) {
    return pins;
  }
  const next = pins.filter(p => p !== url);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, url);
  return next;
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
