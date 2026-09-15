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
  origin: 'page' | 'canvas' | 'manage';
  badge?: number;
  /**
   * The tabs of a combined page (Teams & agents → Agents). Shown as sub-rows
   * beneath the item while that page is open; each is pinnable on its own.
   */
  tabs?: PinnableItem[];
};

/** Pinned items in pin order; pins whose item no longer exists are dropped. */
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

/** Everything not pinned, original order preserved. */
export function withoutPins<T extends { url: string }>(items: T[], pins: string[]): T[] {
  const set = new Set(pins);
  return items.filter(i => !set.has(i.url));
}

/** One gesture: pinned → unpinned; unpinned → appended (pin order = pin time). */
export function togglePin(pins: string[], url: string): string[] {
  return pins.includes(url) ? pins.filter(p => p !== url) : [...pins, url];
}

/** Move a pin to a new index (drag-to-reorder); no-op for unknown urls. */
export function movePin(pins: string[], url: string, toIndex: number): string[] {
  const from = pins.indexOf(url);
  if (from === -1) {
    return pins;
  }
  const next = pins.filter(p => p !== url);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, url);
  return next;
}

/** Split a list into the first `max` and the overflow for a "More …" submenu. */
export function splitOverflow<T>(items: T[], max: number): { shown: T[]; more: T[] } {
  return items.length <= max ? { shown: items, more: [] } : { shown: items.slice(0, max), more: items.slice(max) };
}
